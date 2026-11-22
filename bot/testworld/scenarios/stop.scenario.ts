// `stop` reaches whatever get_wood is doing: walking, digging, crafting, depositing. After it the
// body is still, nothing is lost, and the task can start again. (Was check_stop.ts.)
import { home } from "../../src/lib/home";
import { sleep, type Ctx, type Scenario } from "./lib";

const chest = home.stashChests[0];
const START = "0.5 68 -10"; // world spawn, well away from the chest and the table

async function reset(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`tp ${c.bot} ${START}`);
  await sleep(1000);
}

async function stopAndCheck(c: Ctx) {
  const from = c.body.mark();
  await c.body.send({ intent: "stop" });
  c.check((await c.body.waitEvent("task_stopped", from, 3000)) !== null, "task_stopped within 3 s");
}

async function steady(c: Ctx, what: () => Promise<string>) {
  await sleep(500);
  const before = await what();
  await sleep(3000);
  const after = await what();
  c.check(before === after, `still for 3 s after stop (${before} -> ${after})`);
}

const rounded = async (c: Ctx) => (await c.world.pos(c.bot)).map((n) => Math.round(n)).join(",");

const midWalk: Scenario = {
  name: "stop mid-walk",
  setup: reset,
  async act(c) {
    await c.body.startTask();
    await sleep(1000);
  },
  async verify(c) {
    await stopAndCheck(c);
    await steady(c, () => rounded(c));
    c.check((await c.world.count(c.bot, "oak_log")) === 0, "no oak_log taken");
  },
};

const midDig: Scenario = {
  name: "stop mid-dig",
  setup: reset,
  async act(c) {
    await c.body.startTask();
    for (let i = 0; i < 400 && (await c.world.count(c.bot, "#minecraft:logs")) < 1; i++) await sleep(150);
    await sleep(800);
  },
  async verify(c) {
    await stopAndCheck(c);
    await steady(c, async () => `${await c.world.count(c.bot, "#minecraft:logs")} logs at ${await rounded(c)}`);
  },
};

const midCraft: Scenario = {
  name: "stop mid-craft, then run again",
  setup: async (c) => {
    await reset(c);
    await c.world.run(`give ${c.bot} oak_log 16`);
  },
  async act(c) {
    await c.body.startTask();
    for (let i = 0; i < 400 && (await c.world.count(c.bot, "#minecraft:planks")) < 1; i++) await sleep(100);
  },
  async verify(c) {
    await stopAndCheck(c);
    const again = c.body.mark();
    c.check(await c.body.startTask(), "task accepted again");
    c.check((await c.body.waitEvent("task_finished", again, 120_000)) !== null, "second run finishes");
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1 && (await c.world.count(c.bot, "wooden_axe")) >= 1, "pickaxe and axe made");
  },
};

const total = async (c: Ctx) => (await c.world.count(c.bot, "oak_log")) + (await c.world.chestCount(chest, "oak_log"));

const midDeposit: Scenario = {
  name: "stop mid-deposit loses no logs",
  setup: async (c) => {
    await reset(c);
    await c.world.run(`data modify block ${chest.x} ${chest.y} ${chest.z} Items set value []`);
    for (const give of ["oak_log 16", "oak_planks 12", "stick 4", "wooden_pickaxe 1", "wooden_axe 1"]) {
      await c.world.run(`give ${c.bot} ${give}`);
    }
  },
  async act(c) {
    await c.body.startTask();
    for (let i = 0; i < 300; i++) {
      if ((await c.world.nearBlock(c.bot, chest, 3)) || (await c.world.chestHasAny(chest))) break;
      await sleep(50);
    }
  },
  async verify(c) {
    c.check((await total(c)) === 16, "setup holds 16 logs");
    const from = c.body.mark();
    await c.body.send({ intent: "stop" });
    c.check((await c.body.waitEvent("task_stopped", from, 3000)) !== null, "task_stopped within 3 s");
    await sleep(1500);
    c.check((await total(c)) === 16, `16 logs after stop, saw ${await total(c)}`);
    const again = c.body.mark();
    c.check(await c.body.startTask(), "task accepted again");
    c.check((await c.body.waitEvent("task_finished", again, 60_000)) !== null, "second run finishes");
    c.check((await total(c)) === 16, `16 logs after finish, saw ${await total(c)}`);
  },
};

export default [midWalk, midDig, midCraft, midDeposit];
