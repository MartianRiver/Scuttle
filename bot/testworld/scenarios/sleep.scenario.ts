// At night, idle and near home, the body walks to its bed and sleeps; orders wake it, a task running at
// nightfall is left alone, too far from home it only says so, and by day nothing happens. The world
// runs advance_time false, so the clock only moves when a scenario sets it; every scenario puts it back.
import { home } from "../../src/lib/home";
import { HOME_RANGE } from "../../src/behaviors/night";
import { arena, leave } from "./arena";
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";

const START = "0.5 68 -10";
const NIGHT = 13000;
const bed: Pos = home.bed[0];
const NATURAL = [[12, 4], [17, -3], [20, 5], [-14, 3]] as const; // the grove build_home.py grows

const bedTaken = (c: Ctx) => c.world.passes(`execute if block ${bed.x} ${bed.y} ${bed.z} #minecraft:beds[occupied=true]`);

async function untilTrue(f: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await f()) return true;
  return false;
}

async function reset(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await c.world.run("time set day");
  await sleep(1500);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`tp ${c.bot} ${START}`);
  await sleep(2500);
}

// earlier runs leave stumps; put the four trees back so a task has wood to fetch
async function grow(c: Ctx) {
  for (const [tx, tz] of NATURAL) {
    await c.world.run(`fill ${tx - 2} 70 ${tz - 2} ${tx + 2} 71 ${tz + 2} oak_leaves`);
    await c.world.run(`fill ${tx - 1} 72 ${tz - 1} ${tx + 1} 73 ${tz + 1} oak_leaves`);
    await c.world.run(`fill ${tx} 68 ${tz} ${tx} 72 ${tz} oak_log`);
  }
}

async function wake(c: Ctx) {
  await c.world.run("time set day");
  await c.body.send({ intent: "stop" });
  await sleep(1500);
}

async function toBed(c: Ctx): Promise<boolean> {
  const from = c.body.mark();
  await c.world.run(`time set ${NIGHT}`);
  return (await c.body.waitEvent("sleeping", from, 60_000)) !== null;
}

const goesToBed: Scenario = {
  name: "sleep: idle at night goes to bed",
  timeoutMs: 120_000,
  setup: reset,
  async act(c) {
    const from = c.body.mark();
    await c.world.run(`time set ${NIGHT}`);
    const slept = await c.body.waitEvent("sleeping", from, 60_000);
    c.check(slept !== null, "a sleeping event within 60 s");
    c.check(await untilTrue(() => bedTaken(c), 5000), "the server has the bed occupied");
    c.check(await c.world.nearBlock(c.bot, bed, 3), "the body is at the bed");
    c.check(!c.body.events.slice(from).some((e) => e.event === "cant_sleep"), "no cant_sleep on the way");
  },
  async verify(c) {
    const from = c.body.mark();
    await c.world.run("time set day");
    c.check((await c.body.waitEvent("woke", from, 15_000)) !== null, "woke when morning came");
    c.check(await untilTrue(async () => !(await bedTaken(c)), 5000), "the bed is free again");
  },
  cleanup: async (c) => {
    await wake(c);
    await c.world.run(`tp ${c.bot} ${START}`);
  },
};

const ordersWin: Scenario = {
  name: "sleep: an order wakes it and runs",
  timeoutMs: 180_000,
  async setup(c) {
    await reset(c);
    await grow(c);
  },
  async act(c) {
    c.check(await toBed(c), "asleep first");
    c.check(await untilTrue(() => bedTaken(c), 5000), "the server has the bed occupied");
  },
  async verify(c) {
    const from = c.body.mark();
    const reply = await c.body.send({ intent: "task", name: "get_wood" });
    c.check(reply.type === "accepted", `task accepted while asleep (got ${reply.type} ${reply.reason ?? ""})`);
    c.check((await c.body.waitEvent("woke", from, 6000)) !== null, "a woke event");
    c.check(await untilTrue(async () => !(await bedTaken(c)), 4000), "the bed is free");
    c.check((await c.body.waitEvent("task_started", from, 3000)) !== null, "the task started");
    await sleep(5000);
    const seen = c.body.events.slice(from).map((e) => e.event);
    c.check(!seen.includes("task_failed") && !seen.includes("task_finished"), `the task is still running (saw ${seen.join(",")})`);
    const stopped = c.body.mark();
    await c.body.send({ intent: "stop" });
    c.check((await c.body.waitEvent("task_stopped", stopped, 3000)) !== null, "task_stopped");
  },
  cleanup: async (c) => {
    await wake(c);
    await grow(c);
    await c.world.run(`tp ${c.bot} ${START}`);
  },
};

const notInterrupted: Scenario = {
  name: "sleep: a task at nightfall is not interrupted",
  timeoutMs: 330_000,
  async setup(c) {
    await reset(c);
    await grow(c);
  },
  async act(c) {
    const from = c.body.mark();
    c.check(await c.body.startTask(), "task accepted by day");
    await sleep(8000);
    await c.world.run(`time set ${NIGHT}`);
    const ended = await Promise.race([
      c.body.waitEvent("task_finished", from, 240_000),
      c.body.waitEvent("task_failed", from, 240_000),
    ]);
    c.check(ended?.event === "task_finished", `the task finished (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
    const before = c.body.events.slice(from, ended ? c.body.events.indexOf(ended) : undefined).map((e) => e.event);
    c.check(!before.includes("sleeping") && !before.includes("cant_sleep"), `no bed business during the task (saw ${before.join(",")})`);
  },
  async verify(c) {
    const from = c.body.mark();
    c.check((await c.body.waitEvent("sleeping", from, 60_000)) !== null, "it goes to bed once the task is done");
  },
  cleanup: async (c) => {
    await wake(c);
    await grow(c);
    await c.world.run(`tp ${c.bot} ${START}`);
  },
};

let tooFarFrom = 0;
const tooFar: Scenario = {
  name: "sleep: too far from home it says so and stays",
  timeoutMs: 90_000,
  async setup(c) {
    await reset(c);
    tooFarFrom = c.body.mark(); // arena() makes it midnight, so the event can come before act
    await arena(c); // midnight, bot at its centre, about 100 blocks from the bed
  },
  async act(c) {
    const from = tooFarFrom;
    const said = await c.body.waitEvent("cant_sleep", from, 15_000);
    c.check(said?.reason === "too_far", `cant_sleep too_far (saw ${said?.reason ?? "nothing"})`);
    const [x0, , z0] = await c.world.pos(c.bot);
    await sleep(12_000);
    const [x1, , z1] = await c.world.pos(c.bot);
    c.check(Math.hypot(x1 - x0, z1 - z0) < 2, `it did not walk (moved ${Math.hypot(x1 - x0, z1 - z0).toFixed(1)})`);
    const seen = c.body.events.slice(from).filter((e) => ["cant_sleep", "sleeping"].includes(e.event));
    c.check(seen.length === 1, `once per night, nothing else (saw ${seen.map((e) => e.event + ":" + e.reason).join(",")})`);
    c.check(Math.hypot(x1 - bed.x, z1 - bed.z) > HOME_RANGE, "it is beyond the range");
  },
  async verify() {},
  cleanup: async (c) => {
    await leave(c);
    await wake(c);
  },
};

const byDay: Scenario = {
  name: "sleep: by day nothing happens",
  timeoutMs: 60_000,
  setup: reset,
  async act(c) {
    const [x0, , z0] = await c.world.pos(c.bot);
    const from = c.body.mark();
    await sleep(15_000);
    const seen = c.body.events.slice(from).map((e) => e.event);
    c.check(seen.length === 0, `no events (saw ${seen.join(",")})`);
    const [x1, , z1] = await c.world.pos(c.bot);
    c.check(Math.hypot(x1 - x0, z1 - z0) < 1.5, "it stayed put");
  },
  async verify() {},
};

export default [goesToBed, ordersWin, notInterrupted, tooFar, byDay];
