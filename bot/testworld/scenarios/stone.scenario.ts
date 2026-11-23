// get_stone: cobblestone from natural stone, nothing the look-before-you-dig rule forbids, stone
// tools at the table, the surplus in the stash. The test world's own stone is swapped for a marker
// block first (and put back after), so the only stone to find is the outcrop built here inside the
// grove, the one place the bot may dig. The outcrop is 5 by 5 by 3, about 18 blocks from the table.
import { home } from "../../src/lib/home";
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";

const chest = home.stashChests[0];
const MARK = "light_gray_glazed_terracotta"; // never generated in the overworld
const OUT = { x1: -5, x2: -1, y1: 68, y2: 70, z1: -6, z2: -2 };
const LAVA: Pos = { x: -3, y: 69, z: -5 }; // inside the outcrop, every side stone
const BEHIND: Pos = { x: -3, y: 69, z: -6 }; // the north face block in front of it, within the bot's reach from the grass
const NORTH_AIR: Pos = { x: -3, y: 69, z: -7 };
const START = "-2.5 68 -9.5";
const BACK = "0.5 68 -10";

// every stone within 40 of the table and above y 30, in slabs under the fill limit
async function swapStone(c: Ctx, from: string, to: string) {
  for (const [x0, x1] of [[-40, -9], [-8, 23], [24, 40]]) {
    for (const [z0, z1] of [[-63, -37], [-36, -10], [-9, 17]]) {
      for (let y = 31; y < 151; y += 30) await c.world.run(`fill ${x0} ${y} ${z0} ${x1} ${y + 29} ${z1} ${to} replace ${from}`);
    }
  }
}

const outcrop = (c: Ctx, block: string) => c.world.run(`fill ${OUT.x1} ${OUT.y1} ${OUT.z1} ${OUT.x2} ${OUT.y2} ${OUT.z2} ${block}`);
const outcropStone = (c: Ctx) => c.world.countBlocks({ x: OUT.x1, y: OUT.y1, z: OUT.z1 }, { x: OUT.x2, y: OUT.y2, z: OUT.z2 }, "stone");

async function prepare(c: Ctx, o: { outcrop: boolean; lava?: boolean; swap?: boolean; give: string[] }) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`clear ${c.bot}`);
  await c.world.trackDeaths(c.bot);
  await c.world.run(`data modify block ${chest.x} ${chest.y} ${chest.z} Items set value []`);
  if (o.swap !== false) await swapStone(c, "stone", MARK);
  await outcrop(c, "air");
  if (o.outcrop) {
    await outcrop(c, "stone");
    if (o.lava) await c.world.run(`setblock ${LAVA.x} ${LAVA.y} ${LAVA.z} lava`);
  }
  await c.world.run(`tp ${c.bot} ${START}`);
  for (const g of o.give) await c.world.run(`give ${c.bot} ${g}`);
  await sleep(2000); // block updates settle before the task looks
}

async function restore(c: Ctx) {
  await c.body.send({ intent: "stop" }).catch(() => {});
  await sleep(1500);
  await outcrop(c, "air");
  await swapStone(c, MARK, "stone");
  await c.world.run(`kill @e[type=item,x=-3,y=68,z=-5,distance=..30]`);
  await c.world.run(`data modify block ${chest.x} ${chest.y} ${chest.z} Items set value []`);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`tp ${c.bot} ${BACK}`);
}

async function runToEnd(c: Ctx, ms: number) {
  const from = c.body.mark();
  c.check(await c.body.startTask("get_stone"), "task accepted");
  return Promise.race([c.body.waitEvent("task_finished", from, ms), c.body.waitEvent("task_failed", from, ms)]);
}

const where = (e: { event?: string; reason?: string } | null) => `${e?.event ?? "nothing"} ${e?.reason ?? ""}`;

const mines: Scenario = {
  name: "stone: mines 16, makes stone tools, stashes the rest",
  timeoutMs: 360_000,
  view: { x: -3, y: 70, z: -12 },
  setup: (c) => prepare(c, { outcrop: true, give: ["wooden_pickaxe 1", "stick 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 300_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    const left = await outcropStone(c);
    c.check(left <= 75 - 16, `at least 16 stone blocks gone, ${left} of 75 left`);
    const held = await c.world.count(c.bot, "cobblestone");
    const stashed = await c.world.chestCount(chest, "cobblestone");
    c.check(held + stashed + 5 >= 16, `16 cobblestone gathered (held ${held}, stashed ${stashed}, 5 made into tools)`);
    c.check(held === 4, `4 spare cobblestone kept, held ${held}`);
    c.check(stashed >= 7, `the rest stashed, ${stashed} in the chest`);
    c.check((await c.world.count(c.bot, "stone_pickaxe")) >= 1, "stone pickaxe made");
    c.check((await c.world.count(c.bot, "stone_sword")) >= 1, "stone sword made");
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "wooden pickaxe still held");
    c.check((await c.world.deaths(c.bot)) === 0, "no deaths");
  },
};

const fromLog: Scenario = {
  name: "stone: makes its sticks from a log when it holds none",
  timeoutMs: 360_000,
  setup: (c) => prepare(c, { outcrop: true, give: ["wooden_pickaxe 1", "oak_log 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 300_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "stone_pickaxe")) >= 1, "stone pickaxe made");
    c.check((await c.world.count(c.bot, "stone_sword")) >= 1, "stone sword made");
    c.check((await c.world.count(c.bot, "oak_log")) === 3, "one log used for planks");
  },
};

const lava: Scenario = {
  name: "stone: leaves a block with lava behind it standing",
  timeoutMs: 360_000,
  setup: (c) => prepare(c, { outcrop: true, lava: true, give: ["wooden_pickaxe 1", "stick 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 300_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check(await c.world.blockIs(BEHIND, "stone"), "the stone in front of the lava is still there");
    c.check(await c.world.blockIs(LAVA, "lava"), "the lava is still where it was");
    c.check(await c.world.blockIs(NORTH_AIR, "air"), "no lava ran out of the face");
    c.check((await c.world.deaths(c.bot)) === 0, "no deaths");
    const left = await outcropStone(c);
    c.check(left <= 74 - 16, `other stone was mined, ${left} of 74 left`);
    c.check((await c.world.count(c.bot, "stone_pickaxe")) >= 1, "stone pickaxe made");
  },
};

const none: Scenario = {
  name: "stone: no stone in range fails as no_stone",
  timeoutMs: 240_000,
  setup: (c) => prepare(c, { outcrop: false, give: ["wooden_pickaxe 1", "stick 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 180_000);
    c.check(ended?.event === "task_failed" && ended.reason === "no_stone", `task failed no_stone (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "cobblestone")) === 0, "no cobblestone");
  },
};

const bare: Scenario = {
  name: "stone: no pickaxe fails as no_pickaxe",
  timeoutMs: 60_000,
  setup: (c) => prepare(c, { outcrop: true, swap: false, give: ["stick 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 30_000);
    c.check(ended?.event === "task_failed" && ended.reason === "no_pickaxe", `task failed no_pickaxe (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await outcropStone(c)) === 75, "outcrop untouched");
  },
};

const stopped: Scenario = {
  name: "stone: stop mid-mine ends it and digs nothing further",
  timeoutMs: 240_000,
  setup: (c) => prepare(c, { outcrop: true, give: ["wooden_pickaxe 1", "stick 4"] }),
  cleanup: restore,
  async act(c) {
    c.check(await c.body.startTask("get_stone"), "task accepted");
    let mined = 0;
    for (let i = 0; i < 400 && mined < 2; i++) {
      mined = await c.world.count(c.bot, "cobblestone");
      await sleep(150);
    }
    c.check(mined >= 2, "it was mining before the stop");
    await sleep(300);
  },
  async verify(c) {
    const from = c.body.mark();
    await c.body.send({ intent: "stop" });
    c.check((await c.body.waitEvent("task_stopped", from, 3000)) !== null, "task_stopped within 3 s");
    await sleep(1500);
    const state = async () => `${await outcropStone(c)} stone left, ${await c.world.count(c.bot, "cobblestone")} held`;
    const before = await state();
    await sleep(3000);
    const after = await state();
    c.check(before === after, `nothing dug after the stop (${before} -> ${after})`);
    c.check((await c.world.count(c.bot, "stone_pickaxe")) === 0, "no stone tools made after the stop");
  },
};

export default [mines, fromLog, lava, none, bare, stopped];
