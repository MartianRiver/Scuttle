# Scuttle

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Scuttle is a character for a Minecraft server: an old iron coal scuttle that sat beside a furnace long enough to wake up. It talks to players in chat, answers Minecraft questions, trades with them, and has a body that can walk around the world. I built it for a private family server, so the kids are who it's tuned for, and that shaped most of the decisions below.

It's early. The chat plugin runs on my server and has been played with. The body is newer and rougher.

## What's here

- **The plugin** (`src/`): a Paper plugin that answers in chat through an LLM, using OpenRouter. It looks recipes up in the server's own registry, so it isn't going from memory. It can price things from the recipe graph and trade for coins, find ore and structures by scanning near the player, and hand out land claims through WorldGuard.
- **The body** (`bot/`): a mineflayer bot that plays as its own player. It eats when it's hungry, gathers wood from natural trees (never a player's build), runs from hostile mobs, and fights back if a player keeps hitting it. Players can say `come here`, `stop` or `get wood` in chat, and a small WebSocket API lets something outside give it the same orders. See `bot/API.md`.
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

The body has been through a round of making it safe: it doesn't dig or build while it walks, it only breaks natural logs and leaves for wood, chat and the API go through the same path, and `stop` reaches whatever it's doing. The test world has checks for each of those, because a bug here is someone's build.

What I'm working on now is making it capable without making it reckless. The plan is three layers: reflexes in plain code that keep it alive, a small model that reacts to events the reflexes can't handle, and a bigger one that picks goals and plans, only when something happens and never on a timer. I'm not letting a model write its own code. When it hits something it has no skill for, it should say so and carry on with something else, and I build and test that skill. The aim is a player that helps, chats and builds, and gets better over time. Beating the game would be one milestone of that, not the point.

## Licence

Apache-2.0. See `LICENSE`. The plugin is built against the Paper API, which is GPL-3 with no stated exception for plugins. I think that's fine, plenty of plugins are licensed otherwise, but I'm not a lawyer.
