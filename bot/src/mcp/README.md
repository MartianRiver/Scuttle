# MCP adapter

Lets an LLM session play through the body API (`../../API.md`) with these tools: `status`, `act`,
`wait`, `events`, `observe`, `recipe`, `stash`, `say`, `skills`. It adds nothing the API doesn't have: no coordinates, no commands.
`rationale` on `act` is logged by the adapter and never sent to the body.

Run it from the mind's own directory, not the repo. In that directory's `.mcp.json`, with the
absolute path to this checkout. `tsx` is called by path: `npx tsx` from another directory runs whatever
tsx it finds there or on PATH, not the one this checkout pins, and may stop to ask about downloading one:

```json
{
  "mcpServers": {
    "scuttle": {
      "command": "/abs/path/to/Scuttle/bot/node_modules/.bin/tsx",
      "args": ["/abs/path/to/Scuttle/bot/src/mcp/index.ts"],
      "env": {
        "BOT_ENV": "/abs/path/to/the/bot.env",
        "MIND_AUDIT_DIR": "./mind-audit"
      }
    }
  }
}
```

`BOT_ENV` is the bot's own env file; only `API_HOST` (default 127.0.0.1), `API_PORT` and the first
token in `API_TOKENS` are read. Real environment variables win over the file. Without them the
adapter still starts and every tool but `skills` answers `not_configured`.

Audit: one JSONL file per day in `MIND_AUDIT_DIR` (default `./mind-audit` in the cwd): time, tool,
args, outcome. Outcomes hold event names and counts, never chat text or speaker names.

## Notes

- It reconnects by itself (0.5 s doubling to 10 s) and resumes with the last `seq` and `epoch`. A bad
  token stops it instead of retrying. It exits when its client closes stdin.
- `status` is cached for 2 s because the body allows 10 intents per 10 s; `wait` on a timeout asks fresh.
- `events` and `wait` share one read cursor. Both mark what they return as read.
- `task_progress` lines are commentary: `wait` never wakes for them, `events` shows only the newest per task, and a
  `wait` that times out carries the last one as `progress`. `task_failed` and `task_finished` lines show `detail=` (words)
  and `got=` (items gained, `oak_log:4`).
- `recipe` and `stash` are read-only answers like `observe`; `act` craft, collect, equip, store, take and explore are the hands (`skills` says what each ends with).
- `act` task takes `near` (a block handle or a place) to aim a task at a tree, ore or chest seen in `observe`.
- Adding an intent (observe, go_to): its entry in `ACTIONS` in `skills.ts` (and its task or argument names
  there), the argument in the `act` schema in `tools.ts`, a line in `TASK_SKILLS` if it is a task. The
  skills test fails for a task in `TASKS` without a line. A new tool is one more entry in `TOOLS`.
- Smoke check against a running bot: `BOT_ENV=... npx tsx testworld/mcp_smoke.ts` from `bot/`.
