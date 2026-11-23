# Body control API

A small WebSocket API that lets one trusted outside process give the ScuttleMC body
bounded orders and watch what happens. Generic on purpose: the bot doesn't know or care
what is on the other end, only that it holds a valid token. Planned for the desk-robot
adapter and, later, the mobile app.

Off unless `API_PORT` and `API_TOKENS` are set. Binds `API_HOST` (default `127.0.0.1`);
reach it from another machine through an SSH tunnel or Tailscale, never by opening the port.

`API_TOKENS=label:token,label2:token2` — the label is only for logs. Tokens are never logged.

## Wire format

JSON text frames, max 4 KB. Unknown fields are rejected. One connection per consumer is
expected, several are allowed.

Client → bot:

```
{"type":"auth","token":"…","since":42,"epoch":"a1b2"}   first frame, within 5s; `since`/`epoch` optional
{"type":"intent","id":"c1","intent":"come_to","player":"Sam"}
{"type":"intent","id":"c2","intent":"follow","player":"Sam"}
{"type":"intent","id":"c2g","intent":"guard","player":"Sam"}
{"type":"intent","id":"c7","intent":"give","player":"Sam","item":"oak_log","count":12}
{"type":"intent","id":"c3","intent":"task","name":"get_wood"}
{"type":"intent","id":"c3n","intent":"task","name":"get_wood","near":"b7kq"}
{"type":"intent","id":"c3s","intent":"task","name":"get_stone"}
{"type":"intent","id":"c3i","intent":"task","name":"get_iron"}
{"type":"intent","id":"c6","intent":"say","text":"Can't do that yet, want me to tell you how?"}
{"type":"intent","id":"c4","intent":"stop"}
{"type":"intent","id":"c5","intent":"status"}
{"type":"intent","id":"c8","intent":"observe"}
{"type":"intent","id":"c9","intent":"go_to","handle":"b3kq"}
{"type":"intent","id":"d1","intent":"recipe","item":"crafting_table"}
{"type":"intent","id":"d2","intent":"craft","item":"oak_planks","count":16}
{"type":"intent","id":"d3","intent":"collect","handle":"b7kq","count":3}
{"type":"intent","id":"d4","intent":"equip","item":"iron_chestplate"}
{"type":"intent","id":"d5","intent":"store"}                       or "item":"oak_log","count":20
{"type":"intent","id":"d6","intent":"take","item":"oak_log","count":8}
{"type":"intent","id":"d7","intent":"stash"}
{"type":"intent","id":"d8","intent":"explore","dir":"north-east","far":"a fair way"}
```

`player` is a Minecraft username (`^[A-Za-z0-9_.]{1,17}$`, the dot being Floodgate's prefix).
`handle` is what `observe` handed out: `e` or `b` and a number, then two lowercase letters (`e4kq`, `b17kq`), or a known place
by name (`home`, `table`, `stash`, `furnace`, `bed`); anything else is `bad_intent`.
A task's optional `near` is a block handle or a known place by name (not a mob's handle, which moves: `bad_intent`),
see Rules.
`item` is a Minecraft item name (`^[a-z_]{1,48}$`, no namespace) and `count` an integer 1 to 64, optional (`collect`: 1 to 16, and its
`handle` must be a block handle, `b` and a number, never a mob or a place). `dir` is one of the eight compass points (`north`,
`north-east`... `north-west`) and `far` one of `near`, `a short walk` (the default), `a fair way`, `far`. `store` takes a `count` only with an `item`.
There is no coordinate or command field anywhere, and there won't be one. `say` is the one
free-text field (so the consumer can talk through the body): one public chat
line, 1 to 100 characters, printable ASCII only (so no newline, control or format character, no section sign `§`, which the server kicks a client for, no look-alike letters), no leading `/`, at most one line per
2 s (`rate_limited` otherwise). It is accepted at once with no `taskId`, is allowed mid-fight, and
never touches the running action. Rejected with `not_in_game` when the body is offline.

Bot → client:

```
{"type":"hello","epoch":"a1b2","seq":57,"snapshot":{…}}  after a good auth
{"type":"gap","oldest":40}                               `since` older than the buffer, or wrong epoch
{"type":"accepted","id":"c1","taskId":"t8"}              intent taken, taskId on later events
                                                         (for `stop`, the id of what was stopped, if any)
{"type":"rejected","id":"c1","reason":"busy"}            busy | in_fight | not_in_game |
                                                         unknown_player | in_danger | bad_intent | rate_limited |
                                                         stale_handle | unknown_item | none_held | too_far
{"type":"status","id":"c5","snapshot":{…}}               reply to `status`
{"type":"observation","id":"c8","observation":{…}}       reply to `observe`
{"type":"recipe","id":"d1","recipe":{…}}                 reply to `recipe`
{"type":"stash","id":"d7","stash":{…}}                   reply to `stash`
{"type":"event","seq":58,"ts":1767225600000,"event":"…", …}
```

Snapshot: `{inGame, task, taskId, health, food}`. No position.

## Observation

`observe` is read-only and answers at once: like `status` it is allowed mid-fight and while in danger, never touches the
running action, counts toward the rate limit, and is `not_in_game` only while the body is offline. The answer is one compact
JSON object, at most 1,200 characters (about 300 tokens). **No coordinate and no exact distance is in it**: places are a
distance band (`here` up to 3 blocks, `close` 8, `near` 16, `a short walk` 32, `a fair way` 48, `far` 128, `a long way` 320,
then `very far`; the words climb, so each is farther than the one before; the `died` event's place uses the same scale),
one of eight compass points (north is -z, east is +x) with `above` or `below` when it is 2.5 or more blocks up
or down, and a handle to point at it with.

```
{"health":20,"food":20,"armor":7?,"time":"day|dusk|night|dawn","weather":"clear|rain|thunder",
 "where":"at home, on the surface|underground|in the Nether...","in":"water|deep_water|lava"?,
 "held":"iron_pickaxe"|null,
 "inv":{"oak_log":42,"cobblestone":40},            counts per item, biggest first
 "tools":["iron_pickaxe 87%"],                       anything with durability, share left
 "near":[{"h":"e4kq","what":"cow","k":"hostile|player"?,"d":"close","dir":"east","hp":"hurt|low"?}],
 "blocks":[{"h":"b7kq","what":"chest","d":"near","dir":"north-west above"},
          {"h":"b9kq","what":"oak_log","d":"close","dir":"east"},   a tree: its base log
          {"h":"b4kq","what":"stone","d":"close","dir":"north"}],    the nearest natural stone it may dig (see `stone`)
 "stone":"close north"?,                             the nearest natural stone it may dig, in view
 "places":{"home":"close north","table":"here","stash":"near north-west","furnace":"…","bed":"…"},
 "refused":[{"d":"a short walk","dir":"north-east"}]?,  places where the server undid its digs; no handle
 "more":{"near":3,"blocks":5}?}                      how many were left off each list to fit the budget
```

- **Line of sight only.** `near` (players and mobs within 32 blocks) and `blocks` (within 16) hold only what a ray from the
  body's eyes reaches: a mob behind a wall, or ore with no open face, or one whose open face is out of view, is not
  listed. Blocks also need an open face toward the body. (Mineflayer itself sees through walls; this is the fix.)
  Unloaded chunks block the view.
- `near` lists players first, then hostile mobs (`k`), then the rest, each nearest first; `what` is a player's name or a mob's
  type (never a custom name). `hp` appears for mobs it knows the full health of, and only when below full.
- `blocks` lists the nearest 3 of each kind (2 of water and lava): chests, barrels, crafting tables, furnaces, beds, doors,
  ores, water, lava, spawners, and trees. A tree is one entry, its base log (`what` is the log, `oak_log`), and only
  one `get_wood` would cut: a plain log with natural leaves near it, so a log cabin or a trunk under placed leaves is not
  one. A thick trunk (2 by 2) is one tree. Aim a task at one with `near`. A block that is a known place's spot (the table, the first stash chest and furnace, the
  bed) is left out, since it is in `places`.
- `in` is there only when the body stands in something other than plain ground: `water` (feet in water), `deep_water`
  (head under too: 2 or more deep, no way to touch the bottom and breathe) or `lava`.
- `stone` is the nearest natural stone `get_stone` would take that is in view: within 40 blocks of home, above y 30, not in a
  refused place, passing the look-before-you-dig rule, with an open face. A band and a compass point. That one block is also
  listed once in `blocks` as `stone` with a handle (the only way to point at stone, for `collect`), the same spot as `stone` says.
- `refused` lists up to 3 places where the server undid a dig, nearest first, from the digs the body itself saw undone
  (it never reads the server's regions): kept for the bot's life, fading after 30 minutes, shared by `get_wood`,
  `get_stone` and `get_iron`. `d` is the distance to the place's edge (`here` inside it), `dir` the way to its middle.
  Nearby refusals merge into one bigger place. No handle: the body does not go there. Unlike `places` it is trimmed by the budget.
- `where` is the body's level (`on the surface`, `underground`, `deep underground`, `high up`), with `at home, ` in front
  within 16 blocks of the bed, or the dimension (`in the Nether`) away from the overworld. How far and which way home is
  comes from `places.home`, on the same scale as everything else.
- `places` is always listed, in view or not (overworld only; absent elsewhere along with `time`), and never trimmed.
  `home` and `bed` are the same spot.
- When the object is over budget the last item of the longest list among `near`, `blocks`, `tools`, `inv` and `refused` goes, until it fits;
  `more` says how many of each went (nearest first, so far animals and the smallest stacks go first).
- Handles are minted by the body per process: `e` for an entity, `b` for a block, a counter, then two letters that are new
  on every start, so a handle from before a restart never matches a new one. The same entity or block keeps its handle while it
  keeps being observed, and seeing it again keeps it fresh. A handle not seen for 10 minutes, or one of the 256 newest in the
  table pushed out, is gone. Fixed place names never expire.

`go_to {handle}` walks to what the handle points at, a movement action like `come_to`: `busy` while a task runs, `in_fight`,
`in_danger`, `not_in_game`, and it replaces a running `come_to`/`follow`/`guard`/`give`/`go_to`. A handle the body no longer has (a place name away from the overworld, unknown,
from before a restart, expired, an entity that is gone or out of its loaded view, a block that has been mined or replaced) is
answered with `rejected` `stale_handle` and nothing starts; no event is sent. A mob that wanders off or despawns during the walk ends it
`task_failed` `stale_handle`. Walking is `walkTo`, so a stuck body ends it `stuck`. A block or place: it stops within about 2 blocks (home within 4).
An entity: it re-walks up to five times as the target moves and finishes within 3 blocks of it. At most 90 s.
Other endings: `interrupted`, `died`. Status text: `walking to the cow`, `walking to the crafting table`, `walking to home`. No chat phrase: only the API sends it.

## Recipe and stash

Both are read-only and answer at once, like `observe`: allowed mid-fight and in danger, counted toward the rate limit, `not_in_game`
only while the body is offline.

`recipe {item}` answers from the server's own recipes: `{"item","makes","needs":{…},"table","have":{…},"missing":{…}}`. The registry has one
recipe per kind of wood for everything made of planks, so the answer is the first recipe the inventory covers (one that needs no
table first), else the one it is least short of, with the plain materials (oak, cobblestone, coal) before the exotic. When nothing
it holds covers it and the recipe is made of planks, the ingredient is told as `planks` (any wood; `have` is the most it holds of
one kind, since a recipe takes one kind), otherwise by name (`birch_planks`). `needs` is for one craft, `makes` what one craft
yields, `table` whether it needs a crafting table, `missing` what one craft lacks. An item nothing crafts answers
`{"item","craftable":false}`; a name the game does not have is `rejected` `unknown_item`.

`stash` answers `{"items":{…},"fresh","looked","unseen"?}` from the body's memory of its own stash chests (the home chests, the two halves of a
double chest counting as one place): counts per item as of its last look, `looked` (`just now`, `minutes ago`, `a while ago`, `never`),
`fresh` (every chest looked at within 10 minutes) and `unseen` (chests never opened). Every chest it opens, for these or for a
task, updates it. It may be out of date: somebody else can take things out.

## Events

Every event has a monotonically increasing `seq`. After a reconnect send `auth` with the last
`seq` and `epoch` you saw and everything after it is replayed (buffer of 500; older than that, or
an `epoch` from before a bot restart, gets `gap` and no replay).

| event | fields |
|---|---|
| `body_connected` / `body_disconnected` | `reason` on disconnect |
| `task_started` | `taskId`, `kind` |
| `task_progress` | `taskId`, `step` (the status text: `gathering wood`, `crafting tools`, `mining stone`, `smelting`, `stashing ore`...), `got`? (items gained so far). Only for a `task`, on a change of step and at most one every 15 s, never closer than 2 s: a 2-minute task makes a handful. It is only a commentary: a client that waits for a task's end has no reason to wake for it |
| `task_finished` | `taskId`, `got`? (items gained in the run, net of what it used, counting what it stashed: `{"oak_log":11}`, the 4 biggest; for a `task` and the long actions below), `stored`? (a `store`: what went into the stash, up to 8 items), `saw`? (an `explore`: kinds newly in view, in words, no digit) |
| `task_failed` | `taskId`, `reason`, `detail`?, `got`?, `missing`? (a `craft` that was short: item counts, for the whole count). `detail` is a short line of words (no digit, 120 characters at most) about the cause: `three digs undone near the trees, a fair way south-west`, `in deep water while walking to home, no way out found`, `no natural trees it may cut in range`, `no progress while stashing wood`; `got` as for `task_finished`, what it had when it failed. `reason`: `protected` (the server undid the digs three times in the run, or the only trees or ore left are in places where it did; the places are kept, see `refused`), `no_trees`, `no_stone` (a `get_stone` found no natural stone it may dig within 40 blocks of home and above y 30, or none it could take), `no_pickaxe` (a `get_stone` while holding no pickaxe, a `get_iron` while holding none at stone level or better), `no_ore` (a `get_iron` found no iron ore with a face in the open, or none it could take), `no_fuel` (a `get_iron` with no coal to smelt on, held or found), `smelt_failed` (a `get_iron` that found no furnace it may use, or got no ingot out), `none_held` (a `give` with nothing of that item to spare, see Rules), `stale_handle` (a `go_to` whose mob was gone mid-walk), `no_tool` (a `collect` of a block that needs a pickaxe it does not carry; `detail` says which), `refused` (a `collect` of a block that is not natural, has a player's build too near it, is not safe to dig, or sits in a place where digs were undone; `detail` says which), `missing` (a `craft` short of ingredients, `missing` says what), `no_table` (a `craft` needing a table with none in reach and none at home), `no_recipe` (a `craft` of something nothing crafts), `craft_failed`, `none_stashed` (a `take` of what its chests do not hold), `stash_full` (a `store` with no room), `inventory_full` (a `take` with no room), `no_stash` (no stash in this world, or no chest where one should be), `blocked` (an `explore` stopped by water, lava, a cliff or a drop; `detail` says which way), `stuck` (a walk made no progress: under a block in 8 s, even after two nudges, and in water it swims to the nearest bank once and walks on, ending `stuck` with a `detail` saying water if it can't get out or is stuck in water again; also ends a `come_to`, a `go_to` or a `give`, a `get_wood` that got no wood, a `get_stone` whose attempts got no stone, and a `get_iron` whose attempts got no coal or iron), `interrupted` (hostile mobs, a hazard or a fall took the body; never for a `guard`; a hazard adds a `detail`: `in lava`, `in fire`, `on fire`, `in deep water, swimming for the bank`), `lost_ward` (a `guard` whose player was out of view or over 48 blocks away for 15 s), `disconnected`, `died`, or a short message |
| `task_stopped` | `taskId` |
| `died` | `place`, `cause`: the body died (idle or not; a running action first ends with `task_failed` `died`) and respawns by itself. `place` is words only, never coordinates: how far and which way from home, surface or underground, the dimension if not the overworld ("a short walk to the north-east of home, on the surface"). `cause` is `mob`, `fall`, `lava`, `fire`, `drowning` or `other`. Nothing is carried over: the task is over, the inventory is what the respawn left, and fetching drops is not automatic |
| `no_food` | `food` (the level, 0 to 14). The body is hungry (food below 15) and carries nothing it will eat: no rotten flesh above food 6, nothing poisonous, no golden apples unless hurt. Sent once per hunger episode; the next one needs it to have eaten or its food to have come back to 15 or more. No position. The body never walks to the stash for food by itself; a `get_wood` that stands at the stash takes some |
| `chat` | `uuid`, `name`, `message` — every public chat line the bot sees, not only ones aimed at it |

## Rules

- `stop` is handled before anything else and works whatever the bot is doing. While a real fight
  is on, the plugin's fight state re-asserts the chase within one poll (3s).
- One action at a time. A second `come_to`/`follow` replaces the first (the first ends with
  `task_stopped`); a `task` while anything runs, or any movement while a task runs, is `busy`.
  `come_to`/`follow` need the player in the bot's own loaded view, else `unknown_player`.
  While the plugin has the bot in a real fight,
  everything except `stop` and `status` is `in_fight`.
- `give` walks to the player (within about 2 blocks), faces them and throws the item at them, one stack at a
  time, up to `count` (default: all it holds, at most 64). It is a movement action like `come_to`: `busy`
  while a task runs, `in_fight`, `in_danger`, `not_in_game`, `unknown_player` when the player is not in
  its own loaded view, and it replaces a running `come_to`/`follow`/`guard`. `task_finished` once everything
  is thrown, which is when the items are on the ground, not in the player's hands: they pick them up. It
  never throws a held tool, weapon or shield (anything that does not stack; a stack of logs or bread that
  happens to be in its hand goes like any other); armour on its body and the off hand are not in
  its inventory list and stay too. Asking for more than the other stacks hold throws what they hold. If
  there is nothing to throw, the task ends `task_failed` `none_held` (checked at once, before walking, and
  again on arrival, since it may have eaten or swapped its held item on the way). Other endings: `stuck`,
  `interrupted`, `died`, a short "lost sight of them". Status text: `bringing <item> to <name>`. No chat
  phrase: only the API sends it.
- `task` takes an optional `near`: a block handle (a tree, a chest, an ore) or a known place by name. The search is then
  centred on that spot instead of home (for `get_wood`, instead of the body), with the same radius; crafting, stashing and
  smelting still happen at the home table, stash and furnace, and every dig rule still applies (dig-safety, the
  no-dig places, the refused places). A handle the body no longer has is `rejected` `stale_handle` and nothing starts; a block
  that goes between the order and the start ends it `task_failed` `stale_handle`. A refused place has no handle, so it can't be aimed at.
- `task get_stone` mines natural `stone` (not cobblestone, deepslate or the andesite, diorite and granite that drop
  themselves) within 40 blocks of home and above y 30, until it holds 16 cobblestone more than it started with, then
  makes a stone pickaxe and a stone sword at the home table if it holds none at stone level or better (sticks from planks,
  planks from a log it carries; no sticks to be had means no tools, quietly), keeps 4 cobblestone and stashes the rest.
  It needs a pickaxe in the inventory (any that mines stone), else `no_pickaxe` at once. Each block is dug by hand and
  only when it passes the look-before-you-dig rule: no lava or water against any face, nothing falling (sand, gravel)
  over it, nothing a player makes (planks, torches, chests, glass, cobblestone, walls, concrete...) within 3 blocks or
  up to 12 above it (never under a build), and the body beside it at its level or one below, never above or under.
  A target it has no walking route to (a pit wall, a ledge) is skipped, and a build it runs into is kept clear of for
  the rest of that run. It ends `no_stone` when there is nothing it may dig,
  `protected` when the server undoes the digs, `stuck`, `interrupted`, `died`; if it got some stone but not 16 before it
  ran out of places, it finishes with that. Status text: `looking for stone`, `mining stone`, `crafting stone tools`,
  `stashing stone`.
- `task get_iron` needs a stone pickaxe or better in the inventory (else `no_pickaxe` at once) and does nothing when
  it already holds an iron pickaxe and sword. It mines coal ore until it holds 8 coal (`no_fuel` if it holds none after
  that, before any iron is touched), then iron ore until the iron tools still missing are covered (5 raw iron for a
  pickaxe and a sword, less what it already holds as raw iron or ingots), within 64 blocks of home and above y 8. It only
  goes for ore with a face in the open (a surface outcrop, a cave wall), never ore buried in rock, and digs each block by
  hand under the same look-before-you-dig rule as `get_stone` (nothing with lava or water against it, nothing a player
  made within 3 blocks or above it, no target it has no route to). It then smelts the raw iron at a home furnace on that coal (a furnace holding anything but
  coal in its fuel slot is left alone), makes an iron pickaxe and sword at the home table (sticks as for `get_stone`),
  keeps 4 coal and stashes the rest of the coal and any raw iron. `no_ore` when it got no iron; if iron ran out
  before the tools were covered it makes what it can and finishes. A `stop` mid-smelt closes the furnace and leaves
  what is in it there. Status text: `looking for ore`, `mining ore`, `smelting`, `crafting iron tools`, `stashing ore`.
- The hands, which a mind uses for what the three tasks do not cover. `craft`, `collect`, `store`, `take` and `explore` run like a
  `task`: `busy` while anything runs (even a `follow`), `in_fight`, `in_danger`, `not_in_game`, one at a time, stoppable with
  `stop`, a `task_progress` line on each change of step (`walking to the crafting table`, `crafting stick`, `digging 2 of 3`, `cutting the tree`,
  `taking from the stash`, `exploring east`), `task_finished` with `got` (and `stored` or `saw`) or `task_failed` with `detail`, `got`, `missing`. Rejected
  at once: `unknown_item` (`craft`, `take`, `recipe`), `stale_handle` (`collect`), `too_far` (`explore`). All of them keep every dig rule of the tasks: dig-safety,
  the made-block no-dig zones, natural blocks only (nothing a player placed), and the places the server undid digs in.
  - `craft {item, count?}` makes `count` of the item (default 1, max 64, rounded up to whole recipe batches) with `recipe`'s choice of recipe.
    It checks the whole count first (`missing`, before any walking) and again at the table. A recipe that fits 2x2 is made in the
    inventory; otherwise at a crafting table: the nearest within 16 blocks, else the home table (not past 160 blocks), else `no_table`. It never
    makes ingredients for another craft: planks from logs, sticks from planks are separate calls. Clicks are paced (see QUIRKS).
  - `collect {handle, count?}` digs what a block handle points at, with the best tool carried, and picks up the drops. A tree handle (the base log)
    takes the logs of that trunk, bottom first, those within reach (a 2 by 2 trunk is one tree; a post or wall touching the trunk is not part of it).
    A stone, ore or soft block (dirt, sand, gravel, clay, grass) takes that block and up to `count` (default 1, max 16) of the same kind touching it
    within 5 blocks. Stone and ores need a pickaxe that can harvest them, else `no_tool` at once; the dig is under the look-before-you-dig rule and
    the run's no-dig zones, and a refusal that comes before any dig is `refused`. A dig the server undoes ends `protected` and keeps the place (see `refused`).
  - `equip {item}`: armour to its slot, a shield to the off hand, anything else to the hand. Taken at once and accepted with no `taskId` (like `say`; not a
    task), `none_held` if it carries none, `busy` while a task or action runs. The swap is made a moment later. Nothing idle takes it back (a meal puts back
    the item held before it, which is this one); a fight chooses its own weapon.
  - `store {item?, count?}` walks to its own stash chests and puts items in. No item: everything except what it works with: tools, weapons and armour it
    carries, food up to 16 (the best first), 4 cobblestone and 4 coal. With an item it stores that, up to `count` (all by default), a tool too. Ends
    `task_finished` with `stored`; `none_held` when there is nothing to put, `stash_full` when nothing fit.
  - `take {item, count?}` takes up to `count` (default a stack) from the chests that may hold it. Ends `task_finished` with `got` (maybe less than asked), or
    `none_stashed`, `inventory_full`.
  - `explore {dir, far?}` walks in a compass direction from where it stands, in legs of up to 14 blocks toward a point just inside the band's upper edge
    (`near` 16, `a short walk` 32, `a fair way` 48, `far` 128 blocks), turned aside by 45 or 90 degrees when a leg is stuck, with the swim rescue of any walk.
    It never goes past 160 blocks (flat) from the bed: an end point past it is `rejected` `too_far` before anything moves (and so is any `explore` outside the
    overworld). At each stop it looks around; `task_finished` carries `saw`, the kinds in view on the way that were not in view at the start (`trees`,
    `stone`, ore names like `iron ore`, `water`, `lava`, `doors`, `players`), words only, no handle: `observe` for those. When a whole run of legs brings it no nearer it
    ends `blocked` (water, lava, a cliff or a drop ahead, in `detail`: `a cliff to the north`, `the sea to the east`) or `stuck`. At most about 40 s plus 2.5 s per block of the band.
- `guard` is `follow` that also protects: the body keeps near the player, counts hostile mobs within
  10 blocks of the player as threats as well as the ones near itself, and fights them (creepers and
  skeletons too, bare-handed if it has to; it still backs off below 8 health and from anything that
  isn't a fighter or a creeper). It says a fixed line in chat per mob and once more when the fight is
  over (`Zombie near you, Sam!`, `All clear, Sam.`). Like `follow` it needs the player in view
  (`unknown_player`), runs until `stop` or a newer `come_to`/`follow`/`guard` replaces it, and is
  `busy` while a task runs. Unlike everything else it is taken while the body is in danger (no
  `in_danger`); it is still `in_fight` while the plugin's fight state has the body. Reflexes
  (hazards, falls, fighting or running from mobs) take the body from it without ending it: no
  `interrupted`, the guard follows the player again when the reflex lets go. Only `stop`, a newer
  order, `lost_ward`, `died` or `disconnected` end it. Status text: `guarding <name>` and
  `fighting for <name>`.
- Water: a body that is deep in water with its air running low gets itself out by hand, to the nearest bank it can reach
  by swimming (searching up to 24 blocks out, through the water; a shore flush with the surface or one block above it,
  with 2 air over it), ending whatever it was doing as `interrupted` (`detail` `in deep water, swimming for the bank`). A
  walk that makes no progress while in water does the same swim once on its own and walks on; if it is stuck in water
  again, or there is no bank to swim to (a pit with walls), the walk ends `stuck` with a `detail` saying water.
- While hostile mobs have the body (it fights them or runs, by its health and gear) it ends the current
  action as `task_failed` `interrupted` and answers everything except `stop`, `status` and `guard` with
  `in_danger`. `stop` wins, but the body fights or runs again after its reaction delay if the mobs are
  still there, so a stopped bot is not frozen for good.
- Public chat goes through the same path: `come here` becomes `come_to` (the speaker), `guard me` becomes
  `guard` (the speaker), `stop` becomes `stop`, `get wood` becomes `task get_wood`, `get stone` becomes `task get_stone`, `get iron` becomes `task get_iron`, spelled exactly. Actions started that way are ordinary
  tasks with ordinary events, and get the same `busy` / `in_fight` / `unknown_player` checks. This works with
  the WebSocket server off; it is the only optional part.
- The bot validates every intent against this list itself. Nothing upstream is trusted to have.
- 10 intents per 10s per connection, then `rate_limited`.
- Chat lines carry the full public chat. The consumer is responsible for what it forwards onward.
