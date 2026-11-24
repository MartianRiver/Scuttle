// get_iron: coal and iron from ore with a face in the open, the iron smelted at a home furnace, iron
// tools at the table, the surplus in the stash. The test world's own coal and iron ore (within 64 of
// the table, above y 8) is swapped for marker blocks first and put back after, so the only ore to
// find is what is built here in the grove, the one place the bot may dig. The outcrop is the stone
// scenario's: 5 by 5 by 3, about 18 blocks from the table, with the ore set into its faces.
// After a killed runner: fill the box x -64..64, z -87..41, y 9..160 back with
// `replace gray_glazed_terracotta` -> coal_ore and `replace black_glazed_terracotta` -> iron_ore.
import { home } from "../../src/lib/home";
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";

const chest = home.stashChests[0];
const furnace = home.furnaces[0];
const COAL_MARK = "gray_glazed_terracotta"; // never generated in the overworld
const IRON_MARK = "black_glazed_terracotta";
const OUT = { x1: -5, x2: -1, y1: 68, y2: 70, z1: -6, z2: -2 };
const START = "-2.5 68 -9.5";
const BACK = "0.5 68 -10";

// the ore is in the faces: coal on the west and south sides, iron on the north
const COAL: Pos[] = [
  { x: -5, y: 68, z: -5 }, { x: -5, y: 68, z: -4 }, { x: -5, y: 68, z: -3 }, { x: -5, y: 69, z: -4 },
  { x: -4, y: 68, z: -2 }, { x: -3, y: 68, z: -2 }, { x: -2, y: 68, z: -2 }, { x: -3, y: 69, z: -2 },
];
const IRON: Pos[] = [
  { x: -4, y: 68, z: -6 }, { x: -3, y: 68, z: -6 }, { x: -2, y: 68, z: -6 }, { x: -4, y: 69, z: -6 }, { x: -2, y: 69, z: -6 },
];
const LAVA: Pos = { x: -3, y: 69, z: -5 };
const BESIDE_LAVA: Pos = { x: -3, y: 69, z: -6 }; // an iron on the north face with the lava right behind it
const BURIED: Pos = { x: -3, y: 69, z: -4 }; // the middle of the outcrop

// a pit open to the sky in a stone mass beside the grove's east end, deeper than the body steps down,
// with iron in its east wall: a stand cell exists at the bottom and no path leads there
const MASS = { x1: 8, x2: 14, y1: 68, y2: 71, z1: -5, z2: -1 };
const PIT = { x1: 10, x2: 12, y1: 68, y2: 71, z1: -4, z2: -2 };
const PIT_IRON: Pos[] = [
  { x: 13, y: 68, z: -4 }, { x: 13, y: 68, z: -3 }, { x: 13, y: 68, z: -2 }, { x: 13, y: 69, z: -4 }, { x: 13, y: 69, z: -3 },
];
const PIT_START = "16.5 68 -3";

// 43 by 43 by 17 is under the fill limit; every ore above y 8 within 64 of the table
async function swapOre(c: Ctx, from: string, to: string) {
  for (const [x0, x1] of [[-64, -22], [-21, 21], [22, 64]]) {
    for (const [z0, z1] of [[-87, -45], [-44, -2], [-1, 41]]) {
      for (let y = 9; y < 160; y += 17) await c.world.run(`fill ${x0} ${y} ${z0} ${x1} ${y + 16} ${z1} ${to} replace ${from}`);
    }
  }
}
const swapAll = async (c: Ctx, back: boolean) => {
  await swapOre(c, back ? COAL_MARK : "coal_ore", back ? "coal_ore" : COAL_MARK);
  await swapOre(c, back ? IRON_MARK : "iron_ore", back ? "iron_ore" : IRON_MARK);
};

const box = (c: Ctx, b: typeof OUT, block: string) => c.world.run(`fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} ${block}`);
const put = (c: Ctx, ps: Pos[], block: string) => Promise.all(ps.map((p) => c.world.run(`setblock ${p.x} ${p.y} ${p.z} ${block}`)));
const count = (c: Ctx, b: typeof OUT, block: string) => c.world.countBlocks({ x: b.x1, y: b.y1, z: b.z1 }, { x: b.x2, y: b.y2, z: b.z2 }, block);
const clearFurnaces = (c: Ctx) => Promise.all(home.furnaces.map((f) => c.world.run(`data modify block ${f.x} ${f.y} ${f.z} Items set value []`)));

interface Setup {
  ore: "plain" | "lava" | "buried" | "none"; // the outcrop: faces with ore, one iron against lava, iron in the middle only, nothing
  pit?: boolean;
  swap?: boolean;
  give: string[];
}

async function prepare(c: Ctx, o: Setup) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`clear ${c.bot}`);
  await c.world.trackDeaths(c.bot);
  await c.world.run(`data modify block ${chest.x} ${chest.y} ${chest.z} Items set value []`);
  await clearFurnaces(c);
  if (o.swap !== false) await swapAll(c, false);
  await box(c, OUT, "air");
  if (o.ore !== "none") {
    await box(c, OUT, "stone");
    if (o.ore === "buried") await put(c, [BURIED], "iron_ore");
    else {
      await put(c, COAL, "coal_ore");
      await put(c, IRON, "iron_ore");
      if (o.ore === "lava") {
        await put(c, [BESIDE_LAVA], "iron_ore");
        await put(c, [LAVA], "lava");
      }
    }
  }
  if (o.pit) {
    await box(c, MASS, "stone");
    await box(c, PIT, "air");
    await put(c, PIT_IRON, "iron_ore");
  }
  await c.world.run(`tp ${c.bot} ${o.pit ? PIT_START : START}`);
  for (const g of o.give) await c.world.run(`give ${c.bot} ${g}`);
  await sleep(2000); // block updates settle before the task looks
}

async function restore(c: Ctx) {
  await c.body.send({ intent: "stop" }).catch(() => {});
  await sleep(1500);
  await box(c, OUT, "air");
  await box(c, MASS, "air");
  await swapAll(c, true);
  await c.world.run(`kill @e[type=item,x=-3,y=68,z=-5,distance=..40]`);
  await c.world.run(`data modify block ${chest.x} ${chest.y} ${chest.z} Items set value []`);
  await clearFurnaces(c);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`tp ${c.bot} ${BACK}`);
}

async function runToEnd(c: Ctx, ms: number) {
  const from = c.body.mark();
  c.check(await c.body.startTask("get_iron"), "task accepted");
  return Promise.race([c.body.waitEvent("task_finished", from, ms), c.body.waitEvent("task_failed", from, ms)]);
}

const where = (e: { event?: string; reason?: string } | null) => `${e?.event ?? "nothing"} ${e?.reason ?? ""}`;
const KIT = ["stone_pickaxe 1", "stick 4"];

const makes: Scenario = {
  name: "ore: mines coal and iron, smelts, makes iron tools, stashes the rest",
  timeoutMs: 600_000,
  view: { x: -3, y: 70, z: -12 },
  setup: (c) => prepare(c, { ore: "plain", give: KIT }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 540_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await count(c, OUT, "coal_ore")) === 0, "the outcrop's coal is gone");
    c.check((await count(c, OUT, "iron_ore")) === 0, "the outcrop's iron is gone");
    c.check((await c.world.count(c.bot, "iron_pickaxe")) === 1, "iron pickaxe made");
    c.check((await c.world.count(c.bot, "iron_sword")) === 1, "iron sword made");
    c.check((await c.world.count(c.bot, "stone_pickaxe")) === 1, "stone pickaxe still held");
    const coal = await c.world.count(c.bot, "coal");
    const stashed = await c.world.chestCount(chest, "coal");
    c.check(coal === 4, `4 coal kept, held ${coal}`);
    c.check(stashed >= 2, `the rest of the coal stashed, ${stashed} in the chest`);
    c.check((await c.world.count(c.bot, "raw_iron")) === 0, "no raw iron left held");
    c.check((await c.world.count(c.bot, "iron_ingot")) === 0, "no ingots left over");
    c.check((await c.world.deaths(c.bot)) === 0, "no deaths");
  },
};

const lava: Scenario = {
  name: "ore: leaves an iron with lava against it standing",
  timeoutMs: 600_000,
  setup: (c) => prepare(c, { ore: "lava", give: KIT }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 540_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check(await c.world.blockIs(BESIDE_LAVA, "iron_ore"), "the iron in front of the lava is still there");
    c.check(await c.world.blockIs(LAVA, "lava"), "the lava is still where it was");
    c.check(await c.world.blockIs({ x: -3, y: 69, z: -7 }, "air"), "no lava ran out of the face");
    c.check((await c.world.deaths(c.bot)) === 0, "no deaths");
    c.check((await count(c, OUT, "iron_ore")) === 1, "the other iron was mined");
    c.check((await c.world.count(c.bot, "iron_pickaxe")) === 1, "iron pickaxe made");
  },
};

const buried: Scenario = {
  name: "ore: iron buried in rock with no face in the open fails as no_ore",
  timeoutMs: 240_000,
  setup: (c) => prepare(c, { ore: "buried", give: [...KIT, "coal 8"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 180_000);
    c.check(ended?.event === "task_failed" && ended.reason === "no_ore", `task failed no_ore (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check(await c.world.blockIs(BURIED, "iron_ore"), "the buried iron is untouched");
    c.check((await c.world.count(c.bot, "raw_iron")) === 0, "no raw iron");
    c.check((await c.world.count(c.bot, "coal")) === 8, "the coal is still held");
  },
};

const noCoal: Scenario = {
  name: "ore: no coal anywhere fails as no_fuel before any iron is mined",
  timeoutMs: 240_000,
  setup: (c) => prepare(c, { ore: "none", give: KIT }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 180_000);
    c.check(ended?.event === "task_failed" && ended.reason === "no_fuel", `task failed no_fuel (saw ${where(ended)})`);
  },
  async verify() {},
};

const bare: Scenario = {
  name: "ore: a wooden pickaxe is not enough for iron, no_pickaxe",
  timeoutMs: 60_000,
  setup: (c) => prepare(c, { ore: "plain", swap: false, give: ["wooden_pickaxe 1", "stick 4"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 30_000);
    c.check(ended?.event === "task_failed" && ended.reason === "no_pickaxe", `task failed no_pickaxe (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await count(c, OUT, "iron_ore")) === 5, "outcrop iron untouched");
    c.check((await count(c, OUT, "coal_ore")) === 8, "outcrop coal untouched");
  },
};

// raw iron and coal given, so it goes straight to the furnace
const stopped: Scenario = {
  name: "ore: stop mid-smelt ends it and loses no iron",
  timeoutMs: 240_000,
  setup: (c) => prepare(c, { ore: "none", give: [...KIT, "coal 8", "raw_iron 5"] }),
  cleanup: restore,
  async act(c) {
    c.check(await c.body.startTask("get_iron"), "task accepted");
    let loaded = 0;
    for (let i = 0; i < 400 && loaded === 0; i++) {
      loaded = (await c.world.chestCount(furnace, "raw_iron")) + (await c.world.chestCount(furnace, "iron_ingot"));
      await sleep(150);
    }
    c.check(loaded > 0, "iron went into the furnace before the stop");
    await sleep(500);
  },
  async verify(c) {
    const total = async () => {
      const held = (await c.world.count(c.bot, "raw_iron")) + (await c.world.count(c.bot, "iron_ingot"));
      const cooking = (await c.world.chestCount(furnace, "raw_iron")) + (await c.world.chestCount(furnace, "iron_ingot"));
      return { held, cooking, all: held + cooking };
    };
    const from = c.body.mark();
    await c.body.send({ intent: "stop" });
    c.check((await c.body.waitEvent("task_stopped", from, 3000)) !== null, "task_stopped within 3 s");
    await sleep(1500);
    const a = await total();
    await sleep(3000);
    const b = await total();
    c.check(a.all === 5 && b.all === 5, `5 iron accounted for after the stop (${JSON.stringify(a)} then ${JSON.stringify(b)})`);
    c.check((await c.world.count(c.bot, "iron_pickaxe")) === 0, "no iron tools made after the stop");
  },
};

// Ore on the wall of a pit it can't climb down, nearer than the outcrop's reachable iron: the route
// check drops it and the outcrop's iron is mined.
const pit: Scenario = {
  name: "ore: iron on a wall it can't reach is skipped for iron it can",
  timeoutMs: 420_000,
  setup: (c) => prepare(c, { ore: "plain", pit: true, give: [...KIT, "coal 8"] }),
  cleanup: restore,
  async act(c) {
    const ended = await runToEnd(c, 360_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${where(ended)})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "iron_pickaxe")) === 1, "iron pickaxe made");
    c.check((await count(c, OUT, "iron_ore")) === 0, "the reachable iron was mined");
  },
};

export default [makes, lava, buried, noCoal, bare, stopped, pit];
