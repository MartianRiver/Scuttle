# Chat lab

Talk to Scuttle in a browser, without a Minecraft server.

```
python3 chatlab/server.py
```

Then open <http://localhost:8765>. Python 3 stdlib only — nothing to install.
The OpenRouter key comes from `.env` at the repo root, same as the plugin's.

## What it's for

Tuning the character and the lore file, and seeing what a turn costs, without
rebuilding a jar and restarting a server. It reads
`src/main/resources/persona.txt` — the same file the plugin reads — so the voice
you tune here is the voice that ships.

The right-hand panel fakes everything the plugin injects at §8: who's talking,
where they're standing, time, weather, held item, nearby blocks, recent chat.
Change any of it and ask again to see how much the context actually moves the
answer.

## What it is not

**The recipe book here is a stub.** `recipes.json` holds about ten items so you
can see both paths — the book answering, and the book coming up empty. The real
`lookup_recipe` reads the server's own recipe registry, which is the entire
point of that tool. Do not trust a recipe you saw in here.

Also missing, deliberately: rate limits, the budget ceiling, permission tiers,
the audit log. Those are enforced in Java and there's nothing to learn about
them from a browser.

## Files

- `server.py` — HTTP server, prompt assembly, the OpenRouter call, the tool loop
- `index.html` — the whole UI, no build step
- `recipes.json` — the stub book
- `lore.txt` — what you type in the lore panel and hit save on (gitignored)
