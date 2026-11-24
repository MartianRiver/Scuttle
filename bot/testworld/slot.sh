# Sourced by the test world scripts: the values of one slot. Slot 0 is the original test world;
# slot N (1-9) is a second, independent server: own run-N directory, ports and bot name.
# SCUTTLE_SLOT=N bash testworld/start.sh. Keep in step with slot.ts and slot.py.
SLOT="${SCUTTLE_SLOT:-0}"
[[ "$SLOT" =~ ^[0-9]$ ]] || { echo "SCUTTLE_SLOT must be 0-9" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MC_PORT=$((25566 + SLOT))
RCON_PORT=$((25576 + SLOT))
API_PORT=$((8787 + SLOT))
if [[ "$SLOT" == 0 ]]; then
  RUN_DIR="$ROOT/run"
  BOT_NAME=ScuttleTest
  BOT_MARKER=(--testworld)
else
  RUN_DIR="$ROOT/run-$SLOT"
  BOT_NAME="ScuttleTest$SLOT"
  # the restart's pkill pattern is "tsx src/index.ts <marker>"; slot 0's has no --slot, so it can't match this
  BOT_MARKER=("--slot=$SLOT" --testworld)
fi
