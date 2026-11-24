// Joins the test server as CraftCheck, runs repeated 2x2 planks/sticks crafts through the bot's own
// craftItem, and compares the bot's inventory with the server's after each round (upstream
// mineflayer #4196 reports a desync here). Run from bot/: npx tsx testworld/check_craft.ts
import { format } from "node:util";
import { execFileSync } from "node:child_process";
import mineflayer from "mineflayer";
import { craftItem, itemCount } from "../src/lib/inventory";
import { botName, mcPort } from "./slot";

const say = (...parts: unknown[]) => process.stdout.write(format(...parts) + "\n");

const ROUNDS = 12;
const NAME = "CraftCheck";
const rcon = (cmd: string) =>
  execFileSync("python3", ["testworld/rcon.py", cmd], { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// one stack per item is enough here (at most 16 logs), and the full Inventory dump gets truncated over RCON
function serverCount(item: string): number {
  const out = rcon(`data get entity ${NAME} Inventory[{id:"minecraft:${item}"}].count`);
  const m = out.match(/data: (\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

// what the bot believes sits in the 2x2 grid (slots 1-4) and on the cursor
const grid = () =>
  `grid ${JSON.stringify([1, 2, 3, 4].map((s) => bot.inventory.slots[s]?.name ?? null))} cursor ${bot.inventory.selectedItem?.name ?? null}`;

const bot = mineflayer.createBot({ host: "127.0.0.1", port: mcPort, username: NAME, auth: "offline" });
const fail = (msg: string) => {
  say("FAIL", msg);
  process.exit(1);
};
setTimeout(() => fail("timed out"), 90_000);

bot.once("spawn", async () => {
  await sleep(1500);
  rcon(`clear ${NAME}`);
  rcon(`give ${NAME} oak_log 16`);
  await sleep(1000);
  if (itemCount(bot, "oak_log") !== 16) fail(`gave oak_log, bot sees ${JSON.stringify(bot.inventory.items().map((i) => i.name))}`);

  for (let round = 1; round <= ROUNDS; round++) {
    if (!(await craftItem(bot, "oak_planks", 1))) fail(`round ${round}: no planks recipe`);
    if (!(await craftItem(bot, "stick", 1))) fail(`round ${round}: no stick recipe`);
    await sleep(300);
    const want = { oak_log: 16 - round, oak_planks: 2 * round, stick: 4 * round };
    for (const [item, n] of Object.entries(want)) {
      const mine = itemCount(bot, item);
      const theirs = serverCount(item);
      if (mine !== n || theirs !== n) fail(`round ${round}: ${item} expected ${n}, bot ${mine}, server ${theirs}; ${grid()}`);
    }
    say(`round ${round} ok`, JSON.stringify(want));
  }
  say("PASS");
  process.exit(0);
});
bot.on("error", (e) => fail(String(e)));
bot.on("kicked", (r) => fail(`kicked: ${JSON.stringify(r)}`));
