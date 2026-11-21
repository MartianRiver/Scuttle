#!/bin/bash
# Deletes the test worlds so the next start generates a fresh one from the seed. Keeps jars and plugin configs.
set -euo pipefail
run="$(cd "$(dirname "$0")" && pwd)/../../run"
if nc -z 127.0.0.1 25566 2>/dev/null; then echo "server is running, stop it first" >&2; exit 1; fi
rm -rf "$run"/world "$run"/world_nether "$run"/world_the_end "$run"/plugins/WorldGuard/worlds
echo "worlds removed"
