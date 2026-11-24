// Joins the test server as ScuttleTest (the grove region only lets that name dig, so stop bot.sh
// first) and checks collectLog on three trunks beside a pillar, plus the control that was the bug:
//  1. a drop out of reach (bot perched 5 blocks above it): mineflayer-collectblock's collect() is still pending after 20 s (nothing
//     can reject it, and every later collect() queues behind it); collectLog finishes, the log is gone
//  2. a log the bot can't get within reach of: collectLog returns false and never starts a dig
//  3. a drop on the ground: collectLog breaks it and picks it up
// Builds inside the grove and clears what it built. Run from bot/: npx tsx testworld/check_collect.ts
import { execFileSync } from "node:child_process";
import { format } from "node:util";
import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { collectLog } from "../src/lib/collect";
import { gatherMovements } from "../src/lib/movement";
import { botName, mcPort } from "./slot";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");
const NAME = botName;
const rcon = (cmd: string) => execFileSync("python3", ["testworld/rcon.py", cmd], { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [X, Y, Z] = [8, 68, 1]; // inside scuttle-grove, away from the scenario trees and decoys

const bot = mineflayer.createBot({ host: "127.0.0.1", port: mcPort, username: NAME, auth: "offline" });
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);
const fail = (msg: string) => {
  say("FAIL", msg);
  process.exit(1);
};
setTimeout(() => fail("timed out"), 240_000);
bot.on("kicked", (r) => fail(`kicked: ${JSON.stringify(r)} (is bot.sh still running?)`));

// a trunk of `height` logs standing on a stone pillar of `pillar` blocks, one leaf for the natural check;
// `perch` puts the bot on a stone pillar that high two blocks from the trunk: every step down is more than the
// planner takes, so its own cell is the nearest reachable one to anything below, which is what made goto
// resolve with an empty path, and a drop at the foot lies out of reach
async function build(pillar: number, height: number, perch = 0) {
  rcon(`kill @e[type=item,x=${X},y=${Y},z=${Z},distance=..12]`);
  rcon(`fill ${X - 4} ${Y - 5} ${Z - 4} ${X + 4} ${Y - 1} ${Z + 4} dirt`); // also heals what a failed run left
  rcon(`fill ${X - 4} ${Y - 1} ${Z - 4} ${X + 4} ${Y - 1} ${Z + 4} grass_block`);
  rcon(`fill ${X - 4} ${Y} ${Z - 4} ${X + 4} ${Y + 14} ${Z + 4} air`);
  if (perch > 0) rcon(`fill ${X + 2} ${Y} ${Z} ${X + 2} ${Y + perch - 1} ${Z} stone`);
  if (pillar > 0) rcon(`fill ${X} ${Y} ${Z} ${X} ${Y + pillar - 1} ${Z} stone`);
  rcon(`fill ${X} ${Y + pillar} ${Z} ${X} ${Y + pillar + height - 1} ${Z} oak_log`);
  rcon(`setblock ${X} ${Y + pillar + height + 1} ${Z} oak_leaves`);
  rcon(`clear ${NAME}`);
  rcon(`tp ${NAME} ${X + (perch ? 2 : 1)}.5 ${Y + perch} ${Z}.5`);
  await bot.waitForChunksToLoad();
  await sleep(1500);
}

const logCount = () => bot.inventory.items().filter((i) => i.name === "oak_log").reduce((n, i) => n + i.count, 0);
const spot = (dy: number) => new Vec3(X, Y + dy, Z);
const logAt = (dy: number) => bot.blockAt(spot(dy))?.name === "oak_log";

async function strandedDrop() {
  const dy = 2; // the log on a 2-high base, the bot perched 5 above the ground, 2 blocks aside
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);

  await build(dy, 1, 5); // pillar = dy
  const t0 = Date.now();
  const done = await collectLog(bot, bot.blockAt(spot(dy))!, movements, () => false);
  const took = Date.now() - t0;
  if (!done || logAt(dy)) fail(`collectLog left the log or returned ${done}; bot at ${bot.entity.position}`);
  if (logCount() > 0) fail("premise: the drop was picked up, so it was not out of reach");
  if (took > 25_000) fail(`collectLog took ${took} ms`);
  say(`stranded drop ok: broken, finished in ${took} ms, drop left lying`);

  // the control, as in the stall that was seen: an item on a ceiling slab four blocks straight above
  // the bot, so the bot's own cell is the nearest reachable one, the path comes back empty and goto
  // resolves while the goal is still set. collect() then waits for an item that never goes away
  await build(0, 1);
  bot.pathfinder.setMovements(gatherMovements(bot));
  rcon(`setblock ${X} ${Y} ${Z} air`);
  rcon(`setblock ${X + 1} ${Y + 3} ${Z} stone`);
  rcon(`summon item ${X + 1}.5 ${Y + 4}.2 ${Z}.5 {Item:{id:"oak_log",count:1},PickupDelay:0s,Motion:[0.0,0.0,0.0]}`);
  await sleep(1500);
  const drop = Object.values(bot.entities).find((e) => e.name === "item" && e.position.y > Y + 3);
  if (!drop) fail("control: the summoned item is not there");
  let finished = false;
  void bot.collectBlock.collect(drop!).then(
    () => (finished = true),
    () => (finished = true)
  );
  await sleep(20_000);
  if (finished) fail("control: collect() finished, so the hang this guards against did not happen");
  say("control ok: collect() still pending after 20 s");
  bot.pathfinder.setGoal(null);
}

async function outOfReach() {
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);
  await build(9, 1);
  let digs = 0;
  const count = () => void digs++;
  bot.on("diggingCompleted", count);
  bot.on("diggingAborted", count);
  const done = await collectLog(bot, bot.blockAt(spot(9))!, movements, () => false);
  bot.removeListener("diggingCompleted", count);
  bot.removeListener("diggingAborted", count);
  if (done || !logAt(9)) fail(`out of reach: returned ${done}, log still there ${logAt(9)}`);
  if (digs > 0) fail(`out of reach: ${digs} dig events, a dig must not start from out of reach`);
  say("out of reach ok: false, no dig started");
}

async function groundDrop() {
  const movements = gatherMovements(bot);
  bot.pathfinder.setMovements(movements);
  await build(0, 1);
  const done = await collectLog(bot, bot.blockAt(spot(0))!, movements, () => false);
  if (!done || logAt(0)) fail(`ground drop: returned ${done}, log ${bot.blockAt(spot(0))?.name}, bot at ${bot.entity.position}`);
  if (logCount() < 1) {
    const items = Object.values(bot.entities).filter((e) => e.name === "item").map((e) => `${e.position} ${e.isValid}`);
    fail(`ground drop: the log was broken but not picked up; bot at ${bot.entity.position}, items ${JSON.stringify(items)}`);
  }
  say(`ground drop ok: ${logCount()} log picked up`);
}

bot.once("spawn", async () => {
  bot.collectBlock.movements = undefined; // as index.ts does: collectblock's own movements dig and tower
  await sleep(2000);
  rcon(`gamemode survival ${NAME}`);
  try {
    await groundDrop();
    await outOfReach();
    await strandedDrop();
    say("PASS");
  } finally {
    rcon(`fill ${X - 4} ${Y} ${Z - 4} ${X + 4} ${Y + 14} ${Z + 4} air`);
    rcon(`kill @e[type=item,x=${X},y=${Y},z=${Z},distance=..12]`);
  }
  process.exit(0);
});
