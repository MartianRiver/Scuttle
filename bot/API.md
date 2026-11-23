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
{"type":"intent","id":"c3","intent":"task","name":"get_wood"}
{"type":"intent","id":"c6","intent":"say","text":"Can't do that yet, want me to tell you how?"}
{"type":"intent","id":"c4","intent":"stop"}
{"type":"intent","id":"c5","intent":"status"}
```

`player` is a Minecraft username (`^[A-Za-z0-9_.]{1,17}$`, the dot being Floodgate's prefix).
There is no coordinate or command field anywhere, and there won't be one. `say` is the one
free-text field (so the consumer can talk through the body): one public chat
line, 1 to 100 characters, no leading `/`, no newline or control character, at most one line per
2 s (`rate_limited` otherwise). It is accepted at once with no `taskId`, is allowed mid-fight, and
never touches the running action. Rejected with `not_in_game` when the body is offline.

Bot → client:

```
{"type":"hello","epoch":"a1b2","seq":57,"snapshot":{…}}  after a good auth
{"type":"gap","oldest":40}                               `since` older than the buffer, or wrong epoch
{"type":"accepted","id":"c1","taskId":"t8"}              intent taken, taskId on later events
                                                         (for `stop`, the id of what was stopped, if any)
{"type":"rejected","id":"c1","reason":"busy"}            busy | in_fight | not_in_game |
                                                         unknown_player | in_danger | bad_intent | rate_limited
{"type":"status","id":"c5","snapshot":{…}}               reply to `status`
{"type":"event","seq":58,"ts":1767225600000,"event":"…", …}
```

Snapshot: `{inGame, task, taskId, health, food}`. No position.

## Events

Every event has a monotonically increasing `seq`. After a reconnect send `auth` with the last
`seq` and `epoch` you saw and everything after it is replayed (buffer of 500; older than that, or
an `epoch` from before a bot restart, gets `gap` and no replay).

| event | fields |
|---|---|
| `body_connected` / `body_disconnected` | `reason` on disconnect |
| `task_started` | `taskId`, `kind` |
| `task_finished` | `taskId` |
| `task_failed` | `taskId`, `reason`: `protected` (the server undid the digs), `no_trees`, `stuck` (a walk made no progress: under a block in 8 s, even after two nudges; also ends a `come_to`, and a `get_wood` that got no wood), `interrupted` (hostile mobs, a hazard or a fall took the body; never for a `guard`), `lost_ward` (a `guard` whose player was out of view or over 48 blocks away for 15 s), `disconnected`, `died`, or a short message |
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
- While hostile mobs have the body (it fights them or runs, by its health and gear) it ends the current
  action as `task_failed` `interrupted` and answers everything except `stop`, `status` and `guard` with
  `in_danger`. `stop` wins, but the body fights or runs again after its reaction delay if the mobs are
  still there, so a stopped bot is not frozen for good.
- Public chat goes through the same path: `come here` becomes `come_to` (the speaker), `guard me` becomes
  `guard` (the speaker), `stop` becomes `stop`, `get wood` becomes `task get_wood`, spelled exactly. Actions started that way are ordinary
  tasks with ordinary events, and get the same `busy` / `in_fight` / `unknown_player` checks. This works with
  the WebSocket server off; it is the only optional part.
- The bot validates every intent against this list itself. Nothing upstream is trusted to have.
- 10 intents per 10s per connection, then `rate_limited`.
- Chat lines carry the full public chat. The consumer is responsible for what it forwards onward.
