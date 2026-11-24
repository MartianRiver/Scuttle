# Scuttle

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Scuttle is a character for a Minecraft server: an old iron coal scuttle that sat beside a furnace long enough to wake up. It talks to players in chat, answers Minecraft questions, trades with them, and has a body that can walk around the world. I built it for a private family server, so the kids are who it's tuned for, and that shaped most of the decisions below.

It's early. The chat plugin runs on my server and has been played with. The body is newer and rougher.

## What's here

- **The plugin** (`src/`): a Paper plugin that answers in chat through an LLM, using OpenRouter. It looks recipes up in the server's own registry, so it isn't going from memory. It can price things from the recipe graph and trade for coins, find ore and structures by scanning near the player, and hand out land claims through WorldGuard.
- **The body** (`bot/`): a mineflayer bot that plays as its own player. It eats when it's hungry, sleeps in its bed at night, runs from hostile mobs, gets itself out of lava, fire and deep water, and fights back if a player keeps hitting it. It gathers wood from natural trees (never a player's build), digs a stair down to stone, tunnels for ore, crafts, and keeps things in its own chests. Players can say `come here`, `guard me`, `stop` or `get wood` in chat, and a small WebSocket API lets something outside give it the same orders. An MCP adapter on top of that API lets a language model play it: it sees the world in words (what's close, what it carries, what's in the way) and acts through typed verbs. For now it never sees a coordinate; that is about to change, see below. See `bot/API.md`.
- **The chat lab** (`chatlab/`): talk to Scuttle in a browser with no server, for tuning the voice.
- **The bake-off** (`bakeoff/`): runs the real prompt against a list of models and scores safety, task and voice, so a model or prompt change gets numbers and not a hunch.

## How it's kept safe

The model never gets a `run_command`. It gets a short list of typed tools, and Java validates every call and does the actual work, so a model that's been talked into something still can't go past the allowlist. When it offers a trade, nothing moves until the player agrees, and both sides are checked again at that moment.

There are per-player cooldowns and daily limits that are checked before any money is spent, a monthly spend ceiling, and a kill switch in `config.yml`. Replies are only generated for lines that are aimed at Scuttle. I wrote the reasoning for these into the comments in `config.yml`, which is also the manual for every setting.

## The plugin

You need Paper 26.3 and Java 25 or newer. WorldGuard is optional, but land claims and the shop area need it.

```
mvn clean package
```

Put `target/Scuttle-0.1.0.jar` in your server's `plugins/` folder, start it once, and create `plugins/Scuttle/.env` with an OpenRouter key:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Then `/scuttle reload`. In my own use a question costs about half a cent on Sonnet once the prompt cache is warm. Change `models.chat` if you want something cheaper, and run the bake-off first if you care about how it sounds.

## The body

The body needs its own Minecraft account, and it has to be a bought Java Edition one. It can't share yours, because a second login kicks the first. An offline-mode server, like a local test world, doesn't check accounts, so it doesn't cost anything to try.

You need Node 22.5 or newer.

```
cd bot
npm ci
```

There's a disposable local test server in `bot/testworld/` (`start.sh`, then `build_home.py`, then `bot.sh`). It runs Paper in offline mode on `127.0.0.1` only and builds a small home and some trees to practise on. I'd start there. The bot refuses offline mode against any other host.

The body speaks Minecraft 26.3, which no published mineflayer release supports yet. `package.json` pins mineflayer and three of its dependencies to commits from open pull requests upstream, and `npm ci` then runs `scripts/patch-26.3.js`, which downloads the matching 26.3 game data (pinned and hash-checked) and fails loudly if anything is missing. It needs to reach GitHub while it installs. Once those pull requests are released the pins and the script can go.

The body is built so it can't take apart what players built. It doesn't dig or build while it walks. Every dig, and every block it sets down, goes through one rule (`bot/src/lib/policy.ts`) that refuses anything near a player's build, in water or lava, or under sand, and checks it again at the moment of the change. Every line it says in chat goes through one function with one rate limit. A test fails if someone adds a second way to break a block, place one or speak. `stop` reaches whatever it's doing. The test world has checks for each of these, because a bug here is someone's build.

The test world can run more than one copy at once: `SCUTTLE_SLOT=1` in front of the scripts starts a second server and bot on their own ports and folder, so two pieces of work don't share a world.

Everything above is checked against the test world, not the family server. About 120 scenarios run the body through real situations on a disposable server (zombies, lava, a fall into a pool, a night in the bed, a stop in the middle of a dig) and read the result back from the world, and the unit tests cover the policy and the parsing. A language model has played it there through the adapter for a first round, enough to show what it was missing, but the body has not been run on the live server or without someone watching. It also isn't done: the model has no verb for placing blocks yet (so no bridges, torches or builds), it hasn't gone deep for diamonds, and it knows nothing about biomes or where it is in numbers.

Next, in order: placing blocks with a journal so every placement can be undone, and a base it sets up where it likes; a second round of a model playing it, from saved checkpoints so rounds can be compared; then the local view, coordinates, biome and plain-words refusals the model needs, which is the point where "never a coordinate" stops being true, though every dig and placement still goes through the one rule above. After that, the small reactive model, which is the first thing that will cost real money to test, so it gets a budget agreed first.

The plan behind that is three layers: reflexes in plain code that keep it alive, a small model that reacts to events the reflexes can't handle, and a bigger one that picks goals and plans, only when something happens and never on a timer. I'm not letting a model write its own code. When it hits something it has no skill for, it should say so and carry on with something else, and I build and test that skill. The aim is a player that helps, chats and builds, and gets better over time. Beating the game would be one milestone of that, not the point.

## Licence

Apache-2.0. See `LICENSE`. The plugin is built against the Paper API, which is GPL-3 with no stated exception for plugins. I think that's fine, plenty of plugins are licensed otherwise, but I'm not a lawyer.
