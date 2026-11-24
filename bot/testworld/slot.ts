// The values of one test world slot; slot.sh and slot.py say the same in their languages.
// SCUTTLE_SLOT unset or 0 is the original world, 1-9 is a second server with its own run-N directory.
import path from "node:path";

const raw = process.env.SCUTTLE_SLOT ?? "0";
if (!/^[0-9]$/.test(raw)) throw new Error("SCUTTLE_SLOT must be 0-9");
export const slot = Number(raw);
export const runDir = path.join(__dirname, "..", "..", slot ? `run-${slot}` : "run");
export const mcPort = 25566 + slot;
export const rconPort = 25576 + slot;
export const apiPort = 8787 + slot;
export const botName = slot ? `ScuttleTest${slot}` : "ScuttleTest";
// what restartBot's pkill -f matches, and what bot.sh puts on the command line; "--slot=1 --testworld"
// is not matched by slot 0's pattern, nor slot 1's by slot 2's
export const botPattern = slot ? `tsx src/index.ts --slot=${slot} --testworld` : "tsx src/index.ts --testworld";
