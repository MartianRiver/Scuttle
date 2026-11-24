#!/bin/bash
# Runs the bot against the local test world as ScuttleTest (ScuttleTestN in slot N), never the live account.
# Needs start.sh running.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/slot.sh"
run="$RUN_DIR"
[[ -f "$run/.rcon" ]] || { echo "run start.sh first" >&2; exit 1; }
if [[ ! -f "$run/bot.env" ]]; then
  cat > "$run/bot.env" <<ENV
MC_HOST=127.0.0.1
MC_PORT=$MC_PORT
MC_USERNAME=$BOT_NAME
MC_AUTH=offline
API_HOST=127.0.0.1
API_PORT=$API_PORT
API_TOKENS=local:$(openssl rand -hex 24)
PLACEMENT=on
ENV
fi
cd "$here/.."
BOT_ENV="$run/bot.env" exec npx tsx src/index.ts "${BOT_MARKER[@]}" # the marker restarts match on, so they never hit a live bot
