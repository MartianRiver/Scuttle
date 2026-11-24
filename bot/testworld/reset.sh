#!/bin/bash
# Deletes the test worlds so the next start generates a fresh one from the seed. Keeps jars and plugin configs.
# SCUTTLE_SLOT=N for slot N's run-N.
set -euo pipefail
source "$(dirname "$0")/slot.sh"
if nc -z 127.0.0.1 "$MC_PORT" 2>/dev/null; then echo "server is running, stop it first" >&2; exit 1; fi
rm -rf "$RUN_DIR"/world "$RUN_DIR"/world_nether "$RUN_DIR"/world_the_end "$RUN_DIR"/plugins/WorldGuard/worlds
echo "worlds removed"
