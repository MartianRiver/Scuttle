// Joins the test server as BodyCheck and checks the 26.3 basics the patched libraries could break:
// teleports (including straight after join), eating while holding a tool, and a minute of passive mob
// positions. Flips the world to easy for the eating part and back to peaceful after.
// Run from bot/: npx tsx testworld/check_body.ts
import { format } from "node:util";
import { execFileSync } from "node:child_process";
import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { itemCount } from "../src/lib/inventory";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");

const NAME = "BodyCheck";
const MOBS = ["cow", "sheep", "pig", "chicken"];
const rcon = (cmd: string) =>
  execFileSync("python3", ["testworld/rcon.py", cmd], { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let done = false;
const bot = mineflayer.createBot({ host: "127.0.0.1", port: 25566, username: NAME, auth: "offline" });
const fail = (msg: string) => {
  say("FAIL", msg);
  cleanup();
  process.exit(1);
};
const cleanup = () => {
  rcon("difficulty peaceful");
  // into the void, so they drop no loot around home
  rcon("execute as @e[tag=bodycheck] at @s run tp @s ~ -300 ~");
};
bot.on("kicked", (reason) => fail(`kicked: ${JSON.stringify(reason)}`));
bot.on("end", (reason) => {
  if (!done) fail(`connection ended: ${reason}`);
});
setTimeout(() => fail("timed out"), 180_000);

function serverPos(selector: string): number[] | null {
  const nums = rcon(`data get entity ${selector} Pos`).match(/-?[\d.]+(?:E-?\d+)?(?=d)/g);
  return nums ? nums.map(Number) : null;
}

// a failed execute-if prints nothing over RCON
const itemsNearBot = () =>
  Number(rcon(`execute at ${NAME} if entity @e[type=item,distance=..8]`).match(/Count: (\d+)/)?.[1] ?? 0);

function serverCount(item: string): number {
  const m = rcon(`data get entity ${NAME} Inventory[{id:"minecraft:${item}"}].count`).match(/data: (\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

async function teleport(label: string, cmd: string) {
  const moved = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    bot.once("forcedMove", () => (clearTimeout(t), resolve(true)));
  });
  rcon(cmd);
  if (!(await moved)) fail(`tp ${label}: no position packet within 5 s`);
  await sleep(1500);
  const theirs = serverPos(NAME);
  const mine = bot.entity.position;
  if (!theirs) fail(`tp ${label}: no server position`);
  const off = Math.hypot(mine.x - theirs![0], mine.y - theirs![1], mine.z - theirs![2]);
  if (off > 1) fail(`tp ${label}: bot at ${mine}, server at ${theirs}`);
  say(`tp ${label} ok`, mine.floored().toString());
}

async function checkEating() {
  rcon(`clear ${NAME}`);
  rcon(`give ${NAME} wooden_pickaxe 1`);
  rcon(`give ${NAME} bread 3`);
  await sleep(1000);
  const pick = bot.inventory.items().find((i) => i.name === "wooden_pickaxe");
  if (!pick) fail("no pickaxe after give");
  await bot.equip(pick!, "hand");

  rcon("difficulty easy");
  rcon(`effect give ${NAME} minecraft:hunger 10 255`);
  for (let i = 0; i < 40 && bot.food >= 15; i++) await sleep(250);
  rcon(`effect clear ${NAME}`);
  if (bot.food >= 15) fail(`hunger never dropped, food ${bot.food}`);
  const before = bot.food;
  const lying = itemsNearBot();

  // same calls as behaviors/survival.ts
  const bread = bot.inventory.items().find((i) => bot.registry.foodsByName[i.name]);
  await bot.equip(bread!.type, "hand");
  const stuck = setTimeout(() => fail("consume never finished"), 10_000);
  await bot.consume();
  clearTimeout(stuck);
  await sleep(1000);

  const serverFood = Number(rcon(`data get entity ${NAME} foodLevel`).match(/(\d+)\s*$/)?.[1]);
  if (bot.food <= before || bot.food !== serverFood) fail(`food before ${before}, bot ${bot.food}, server ${serverFood}`);
  for (const [item, n] of [["bread", 2], ["wooden_pickaxe", 1]] as const) {
    const mine = itemCount(bot, item);
    const theirs = serverCount(item);
    if (mine !== n || theirs !== n) fail(`${item}: expected ${n}, bot ${mine}, server ${theirs}`);
  }
  if (itemsNearBot() > lying) fail(`items near the bot went from ${lying} to ${itemsNearBot()} while eating`);
  rcon("difficulty peaceful");
  say(`eat ok, food ${before} -> ${bot.food}, bread 2, pickaxe kept, nothing dropped`);
}

async function checkEntities() {
  for (const mob of MOBS) {
    for (let k = 0; k < 3; k++) {
      rcon(`execute at ${NAME} run summon minecraft:${mob} ~ ~ ~ {Tags:["bodycheck"]}`);
    }
  }
  await sleep(2000);
  const ours = () =>
    Object.values(bot.entities).filter(
      (e) => MOBS.includes(e.name ?? "") && e.position.distanceTo(bot.entity.position) < 24
    );
  if (ours().length < MOBS.length * 3) fail(`bot sees ${ours().length} of ${MOBS.length * 3} summoned mobs`);

  for (let t = 0; t < 120; t++) {
    for (const e of Object.values(bot.entities)) {
      const { x, y, z } = e.position;
      if (![x, y, z].every(Number.isFinite)) fail(`entity ${e.id} ${e.name} at ${e.position}`);
    }
    await sleep(500);
  }
  for (const mob of MOBS) {
    const theirs = serverPos(`@e[type=${mob},tag=bodycheck,limit=1]`);
    const near = theirs && Object.values(bot.entities).some((e) => e.name === mob && e.position.distanceTo(new Vec3(theirs[0], theirs[1], theirs[2])) < 1.5);
    if (!near) fail(`no ${mob} in bot.entities near server position ${theirs}`);
  }
  say(`entities ok, ${Object.keys(bot.entities).length} tracked for 60 s, all finite, positions match`);
}

bot.once("spawn", async () => {
  await teleport("on join", `tp ${NAME} ~ ~ ~`);
  await sleep(1000);
  await teleport("up 2", `execute as ${NAME} at @s run tp @s ~ ~2 ~`);
  await teleport("to ScuttleTest", `tp ${NAME} ScuttleTest`);
  await teleport("far", `spreadplayers 1200 1200 0 20 false ${NAME}`);
  await teleport("back", `tp ${NAME} ScuttleTest`);
  await checkEating();
  // well away from home, so nothing the mobs do lands there
  await teleport("far again", `spreadplayers -1200 1200 0 20 false ${NAME}`);
  await checkEntities();
  say("PASS");
  done = true;
  cleanup();
  bot.quit();
  setTimeout(() => process.exit(0), 500);
});
