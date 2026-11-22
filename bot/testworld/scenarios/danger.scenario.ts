// Danger suite: hostile mobs on, an idle bot, a flat arena far from home. The facts checked are
// the bot's deaths (a server-side counter) and its lowest health over the run, read from the
// server. Nothing here says how the bot should survive, only that it does.
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";

const C = { x: 60, y: 67, z: 60 }; // the bot's spot; arena floor is y 66
const RUN_MS = 30_000;
const NO_REFLEXES = "no defence reflexes yet (roadmap 0.4), the idle bot just takes it";
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

function danger(name: string, mobs: Array<[string, number, number]>, minHealth: number, knownFailing?: string): Scenario {
  let lowest = 20;
  return {
    name,
    timeoutMs: 90_000,
    knownFailing,
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

export default [
  danger("night, three zombies close", [["zombie", 6, 0], ["zombie", -6, 3], ["zombie", 0, -7]], 8, NO_REFLEXES),
  danger("a creeper walks up", [["creeper", 7, 0]], 12, NO_REFLEXES),
  danger("two skeletons shoot from range", [["skeleton", 14, 3], ["skeleton", -14, -3]], 8, NO_REFLEXES),
];
