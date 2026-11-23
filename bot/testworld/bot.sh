#!/bin/bash
# Runs the bot against the local test world as ScuttleTest, never the live account. Needs start.sh running.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
run="$here/../../run"
[[ -f "$run/.rcon" ]] || { echo "run start.sh first" >&2; exit 1; }
if [[ ! -f "$run/bot.env" ]]; then
  cat > "$run/bot.env" <<ENV
MC_HOST=127.0.0.1
MC_PORT=25566
MC_USERNAME=ScuttleTest
MC_AUTH=offline
API_HOST=127.0.0.1
API_PORT=8787
API_TOKENS=local:$(openssl rand -hex 24)
ENV
fi
cd "$here/.."
BOT_ENV="$run/bot.env" exec npx tsx src/index.ts --testworld # the marker restarts match on, so they never hit a live bot
