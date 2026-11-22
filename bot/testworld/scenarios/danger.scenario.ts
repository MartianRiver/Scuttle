// Danger suite: hostile mobs on, a bot with bare hands, a flat arena far from home. The facts checked are
// the bot's deaths (a server-side counter) and its lowest health over the run, read from the
// server. Nothing here says how the bot should survive, only that it does.
import { arena, C, leave, onPlatform, rel } from "./arena";
import { sleep, type Scenario } from "./lib";

const RUN_MS = 30_000;

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
      c.check(await onPlatform(c), "the bot is still on the platform");
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
  timeoutMs: 330_000,
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
      c.body.waitEvent("task_finished", from, 280_000),
      c.body.waitEvent("task_failed", from, 280_000),
    ]);
    // collection stalls now and then (QUIRKS), which ends a run as `stuck`; that is not this scenario's
    // question. Its question is whether the sealed zombie took the body, and that shows as `interrupted`.
    c.check(ended !== null, "the task ended");
    c.check(ended?.reason !== "interrupted", `the zombie underground did not interrupt the task (saw ${ended?.event} ${ended?.reason ?? ""})`);
  },
  async verify(c) {
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
