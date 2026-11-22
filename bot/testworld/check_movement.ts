// Joins the test server as MoveCheck and checks the movement and natural-log rules against real
// server data, each with a control that has to behave the opposite way:
//  1. sealed in a cobble box, default movements plan a dig out and safeMovements find no path
//  2. collectblock swaps in default movements on collect() unless its own are removed
//  3. in an arena of two grown trees and three decoys, isNaturalLog accepts every grown log and no decoy
// Builds far from home (tp via spreadplayers) and clears what it built. Run from bot/: npx tsx testworld/check_movement.ts
import { execFileSync } from "node:child_process";
import { format } from "node:util";
import mineflayer from "mineflayer";
import type { Block } from "prismarine-block";
import { goals, Movements, pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { gatherMovements, isNaturalLog, isPlainLogName, safeMovements } from "../src/lib/movement";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");
const NAME = "MoveCheck";
const rcon = (cmd: string) => execFileSync("python3", ["testworld/rcon.py", cmd], { encoding: "utf8" }).trim();
const at = (cmd: string) => rcon(`execute at ${NAME} run ${cmd}`);
// the pathfinder types want its own block shape; real blocks work
const canBreak = (m: Movements, b: Block) => m.safeToBreak(b as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bot = mineflayer.createBot({ host: "127.0.0.1", port: 25566, username: NAME, auth: "offline" });
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);
const fail = (msg: string) => {
  say("FAIL", msg);
  process.exit(1);
};
setTimeout(() => fail("timed out"), 120_000);

async function sealedBox() {
  at("fill ~-2 ~-1 ~-2 ~2 ~3 ~2 minecraft:cobblestone hollow");
  await sleep(1000);
  const goal = new goals.GoalNear(bot.entity.position.x + 8, bot.entity.position.y, bot.entity.position.z, 1);
  const dig = bot.pathfinder.getPathTo(new Movements(bot), goal, 3000);
  const breaks = dig.path.some((node) => node.toBreak.length > 0);
  if (!breaks) fail(`control: default movements gave ${dig.status}, digs ${breaks}`);
  const safe = bot.pathfinder.getPathTo(safeMovements(bot), goal, 3000);
  if (safe.path.some((node) => node.toBreak.length > 0 || node.toPlace.length > 0)) fail("safeMovements plans a dig or a block");
  if (safe.status === "success") fail("safeMovements found a way out of a sealed box");
  say(`box ok: default movements ${dig.status} with digs, safe movements ${safe.status}`);
  at("fill ~-2 ~-1 ~-2 ~2 ~3 ~2 minecraft:air");
}

async function collectSwap() {
  const mine = safeMovements(bot);
  bot.pathfinder.setMovements(mine);
  await bot.collectBlock.collect([]);
  if (bot.pathfinder.movements === mine) fail("control: collect() left our movements alone, nothing to guard against");
  say("collect swap control ok: default collectblock replaced our movements, canDig", bot.pathfinder.movements.canDig);

  bot.collectBlock.movements = undefined;
  bot.pathfinder.setMovements(mine);
  await bot.collectBlock.collect([]);
  if (bot.pathfinder.movements !== mine || mine.canDig) fail("collect() still swapped the movements after removing collectblock's own");
  say("collect swap ok: our movements stay");
}

async function arena() {
  at("fill ~-10 ~-1 ~-10 ~10 ~-1 ~10 minecraft:grass_block");
  at("fill ~-10 ~ ~-10 ~10 ~14 ~10 minecraft:air");
  for (const [dx, dz] of [[6, 6], [-6, 6]]) {
    if (!/Placed/i.test(at(`place feature minecraft:oak ~${dx} ~ ~${dz}`))) fail(`no oak grew at ${dx},${dz}`);
  }
  at("fill ~6 ~ ~-6 ~6 ~3 ~-6 minecraft:stripped_oak_log");
  at("fill ~-6 ~ ~-6 ~-6 ~3 ~-6 minecraft:oak_log");
  at("fill ~-1 ~3 ~7 ~1 ~5 ~9 minecraft:oak_leaves[persistent=true]");
  at("fill ~0 ~ ~8 ~0 ~4 ~8 minecraft:oak_log");
  await sleep(1500);

  const base = bot.entity.position.floored();
  const decoys = new Set(
    [[6, -6, 4], [-6, -6, 4], [0, 8, 5]].flatMap(([dx, dz, h]) =>
      Array.from({ length: h }, (_, dy) => base.offset(dx, dy, dz).toString())
    )
  );
  let grown = 0;
  for (let dx = -10; dx <= 10; dx++)
    for (let dy = 0; dy <= 14; dy++)
      for (let dz = -10; dz <= 10; dz++) {
        const pos = base.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (!block || !/_log$/.test(block.name)) continue;
        const natural = isNaturalLog(bot, block);
        if (decoys.has(pos.toString())) {
          if (natural) fail(`decoy ${block.name} at ${pos} counted as natural`);
        } else {
          if (!natural) fail(`grown ${block.name} at ${pos} not counted as natural`);
          grown++;
        }
      }
  if (grown < 6) fail(`only ${grown} grown logs found, trees did not grow`);

  const gather = gatherMovements(bot);
  const stripped = bot.blockAt(base.offset(6, 0, -6))!;
  const bare = bot.blockAt(base.offset(-6, 0, -6))!;
  const fake = bot.blockAt(base.offset(0, 0, 8))!;
  if (!isPlainLogName(bare.name) || canBreak(gather, stripped) || canBreak(gather, bare) || canBreak(gather, fake)) {
    fail("gather movements would break a decoy");
  }
  const trunk = [...Array(8).keys()].map((n) => bot.blockAt(base.offset(6, n, 6))).find((b) => b && isPlainLogName(b.name));
  if (!trunk || !canBreak(gather, trunk)) fail("gather movements would not break a grown log");
  if (canBreak(gather, bot.blockAt(base.offset(0, -1, 0))!)) fail("gather movements would break the ground");
  say(`arena ok: ${grown} grown logs natural, 3 decoys refused, ground refused`);
  at("fill ~-10 ~ ~-10 ~10 ~14 ~10 minecraft:air");
}

bot.once("spawn", async () => {
  await sleep(1000);
  rcon(`spreadplayers 1500 -1500 0 20 false ${NAME}`);
  await sleep(2500);
  await sealedBox();
  await collectSwap();
  await arena();
  say("PASS");
  bot.quit();
  setTimeout(() => process.exit(0), 500);
});
bot.on("kicked", (r) => fail(`kicked ${JSON.stringify(r)}`));
