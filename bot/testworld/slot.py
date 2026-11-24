# The values of one test world slot; slot.sh and slot.ts say the same in their languages.
import os
from pathlib import Path

_raw = os.environ.get("SCUTTLE_SLOT", "0")
if len(_raw) != 1 or not _raw.isdigit():
    raise SystemExit("SCUTTLE_SLOT must be 0-9")
SLOT = int(_raw)
RUN = Path(__file__).resolve().parents[2] / (f"run-{SLOT}" if SLOT else "run")
MC_PORT = 25566 + SLOT
RCON_PORT = 25576 + SLOT
BOT = f"ScuttleTest{SLOT}" if SLOT else "ScuttleTest"
