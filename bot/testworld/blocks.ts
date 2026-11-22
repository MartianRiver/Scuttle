// Joins as Watcher and snapshots every block around home and the grove, or diffs against an
// earlier snapshot, so a task's effect on the world can be checked block by block.
// Run from bot/: npx tsx testworld/blocks.ts save before.json | diff before.json
import { format } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import mineflayer from "mineflayer";
import { Vec3 } from "vec3";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");

const BOX = { x: [-20, 28], y: [60, 100], z: [-34, 12] };
const [mode, file] = process.argv.slice(2);
if (!file || !["save", "diff"].includes(mode)) throw new Error("usage: blocks.ts save|diff <file>");

const bot = mineflayer.createBot({ host: "127.0.0.1", port: 25566, username: "Watcher", auth: "offline" });

function snapshot(): Record<string, string> {
  const blocks: Record<string, string> = {};
  for (let x = BOX.x[0]; x <= BOX.x[1]; x++)
    for (let y = BOX.y[0]; y <= BOX.y[1]; y++)
      for (let z = BOX.z[0]; z <= BOX.z[1]; z++) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b) throw new Error(`chunk not loaded at ${x},${z}`);
        if (b.name !== "air") blocks[`${x},${y},${z}`] = b.name;
      }
  return blocks;
}

bot.once("spawn", async () => {
  await bot.waitForChunksToLoad();
  const now = snapshot();
  if (mode === "save") {
    writeFileSync(file, JSON.stringify(now));
    say(`saved ${Object.keys(now).length} blocks`);
  } else {
    const before: Record<string, string> = JSON.parse(readFileSync(file, "utf8"));
    const keys = new Set([...Object.keys(before), ...Object.keys(now)]);
    const changes: Record<string, number> = {};
    for (const k of keys) {
      if (before[k] === now[k]) continue;
      const change = `${before[k] ?? "air"} -> ${now[k] ?? "air"}`;
      changes[change] = (changes[change] ?? 0) + 1;
    }
    say(Object.keys(changes).length ? changes : "no changes");
  }
  bot.quit();
  process.exit(0);
});
bot.on("kicked", (r) => {
  say("kicked", r);
  process.exit(1);
});
