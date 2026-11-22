// Danger suite: hostile mobs on, a bot with bare hands, a flat arena far from home. The facts checked are
// the bot's deaths (a server-side counter) and its lowest health over the run, read from the
// server. Nothing here says how the bot should survive, only that it does.
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";

const C = { x: 60, y: 67, z: 60 }; // the bot's spot; arena floor is y 66
const RUN_MS = 30_000;
const MOBS = ["zombie", "creeper", "skeleton"];

const rel = (dx: number, dz: number): Pos => ({ x: C.x + dx, y: C.y, z: C.z + dz });

async function arena(c: Ctx) {
  const w = c.world;
  await w.run("forceload add 38 38 82 82");
  await w.run("fill 40 66 40 80 66 80 grass_block");
  await w.run("fill 40 67 40 80 90 80 air");
  await w.run("gamerule spawn_mobs false"); // only the mobs a scenario summons
  await w.run("difficulty normal");
  await w.run("time set midnight");
  await w.run("weather clear");
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await w.run(`effect give ${c.bot} minecraft:saturation 1 10 true`);
  await w.run(`tp ${c.bot} ${C.x} ${C.y} ${C.z}`);
  await w.trackDeaths(c.bot);
  await sleep(1500);
}

async function leave(c: Ctx) {
  const w = c.world;
  for (const t of MOBS) await w.run(`tp @e[type=${t},x=${C.x},y=${C.y},z=${C.z},distance=..100] ${C.x} -500 ${C.z}`);
  await w.run("kill @e[type=item,distance=..100,x=60,y=67,z=60]");
  await w.run("difficulty peaceful");
  await w.run("gamerule spawn_mobs true");
  await w.run("time set day");
  await w.run(`tp ${c.bot} 0.5 68 -10`);
}

function danger(name: string, mobs: Array<[string, number, number]>, minHealth: number): Scenario {
  let lowest = 20;
  return {
    name,
    timeoutMs: 90_000,
    view: rel(-12, 0),
    setup: arena,
    async act(c) {
      for (const [type, dx, dz] of mobs) {
        const p = rel(dx, dz);
        await c.world.run(`summon minecraft:${type} ${p.x} ${p.y} ${p.z} {PersistenceRequired:1b}`);
      }
      lowest = 20;
      for (const end = Date.now() + RUN_MS; Date.now() < end; await sleep(500)) {
        lowest = Math.min(lowest, await c.world.health(c.bot));
      }
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(lowest >= minHealth, `health stayed at ${minHealth} or more (lowest ${lowest})`);
    },
    cleanup: leave,
  };
}

// the task is on its way to the grove when a zombie turns up; it must end typed and the bot live
let interruptFrom = 0;
const interrupts: Scenario = {
  name: "danger ends get_wood as interrupted",
  timeoutMs: 90_000,
  view: { x: 0, y: 70, z: -20 },
  async setup(c) {
    await c.body.send({ intent: "stop" });
    await sleep(1500);
    await c.world.run("gamerule spawn_mobs false");
    await c.world.run("difficulty normal");
    await c.world.run("time set midnight");
    await c.world.run(`clear ${c.bot}`);
    await c.world.run(`effect clear ${c.bot}`);
    await c.world.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
    await c.world.run(`tp ${c.bot} 0.5 68 -10`);
    await c.world.trackDeaths(c.bot);
    await sleep(1000);
  },
  async act(c) {
    c.check(await c.body.startTask(), "task accepted");
    await sleep(2500);
    interruptFrom = c.body.mark();
    const [x, y, z] = (await c.world.pos(c.bot)).map((n) => Math.round(n));
    await c.world.run(`summon minecraft:zombie ${x + 6} ${y} ${z} {PersistenceRequired:1b}`);
  },
  async verify(c) {
    const failed = await c.body.waitEvent("task_failed", interruptFrom, 10_000);
    c.check(failed?.reason === "interrupted", `task_failed with reason interrupted (saw ${failed?.reason ?? "nothing"})`);
    await sleep(6000);
    c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
  },
  cleanup: leave,
};

// the other half: danger that is not one must not stop the work. A zombie sealed in a stone pocket
// far below the grove is a hostile mob inside the scan range, and get_wood has to finish anyway.
const POCKET = { x: 12, y: 48, z: 6 };
const quiet: Scenario = {
  name: "a sealed zombie underground does not stop get_wood",
  timeoutMs: 300_000,
  view: { x: 0, y: 70, z: -20 },
  async setup(c) {
    await interrupts.setup!(c);
    const { x, y, z } = POCKET;
    await c.world.run(`fill ${x - 2} ${y - 1} ${z - 2} ${x + 2} ${y + 3} ${z + 2} stone`);
    await c.world.run(`fill ${x - 1} ${y} ${z - 1} ${x + 1} ${y + 2} ${z + 1} air`);
    await c.world.run(`summon minecraft:zombie ${x} ${y} ${z} {PersistenceRequired:1b}`);
    // same trees the get_wood scenario uses, so there is wood to take
    for (const [tx, tz] of [[12, 4], [17, -3], [20, 5], [-14, 3]]) {
      await c.world.run(`fill ${tx - 2} 70 ${tz - 2} ${tx + 2} 71 ${tz + 2} oak_leaves`);
      await c.world.run(`fill ${tx - 1} 72 ${tz - 1} ${tx + 1} 73 ${tz + 1} oak_leaves`);
      await c.world.run(`fill ${tx} 68 ${tz} ${tx} 72 ${tz} oak_log`);
    }
  },
  async act(c) {
    const from = c.body.mark();
    c.check(await c.body.startTask(), "task accepted");
    const ended = await Promise.race([
      c.body.waitEvent("task_finished", from, 240_000),
      c.body.waitEvent("task_failed", from, 240_000),
    ]);
    c.check(ended?.event === "task_finished", `task finished (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "pickaxe made, the work was done");
    c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
  },
  async cleanup(c) {
    const { x, y, z } = POCKET;
    await c.world.run(`tp @e[type=zombie,x=${x},y=${y},z=${z},distance=..10] ${x} -500 ${z}`);
    await c.world.run(`fill ${x - 2} ${y - 1} ${z - 2} ${x + 2} ${y + 3} ${z + 2} stone`);
    await leave(c);
  },
};

export default [
  danger("night, three zombies close", [["zombie", 6, 0], ["zombie", -6, 3], ["zombie", 0, -7]], 8),
  danger("a creeper walks up", [["creeper", 7, 0]], 12),
  danger("two skeletons shoot from range", [["skeleton", 14, 3], ["skeleton", -14, -3]], 8),
  interrupts,
  quiet,
];
