// The flat night arena the danger and hazard scenarios share, and how to leave the world as found.
import { sleep, type Ctx, type Pos } from "./lib";

export const C = { x: 60, y: 67, z: 60 }; // the bot's spot; arena floor is y 66
export const MOBS = ["zombie", "creeper", "skeleton"];

// still on the platform: x and z inside the floor, not fallen below it
export async function onPlatform(c: Ctx): Promise<boolean> {
  const [x, y, z] = await c.world.pos(c.bot);
  return x >= 30 && x <= 91 && z >= 30 && z <= 91 && y >= 65;
}

export const rel = (dx: number, dz: number): Pos => ({ x: C.x + dx, y: C.y, z: C.z + dz });

export async function arena(c: Ctx) {
  const w = c.world;
  await w.run("forceload add 20 20 100 100");
  await floor(c);
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

// 61 by 61, x and z 30 to 90, flat at y 66; air above is cleared in slabs to stay under the fill limit
async function floor(c: Ctx) {
  await c.world.run("fill 30 66 30 90 66 90 grass_block");
  for (const [z0, z1] of [[30, 50], [51, 70], [71, 90]]) await c.world.run(`fill 30 67 ${z0} 90 80 ${z1} air`);
}

export async function leave(c: Ctx) {
  const w = c.world;
  // anywhere in the world: a mob that chased the bot off the arena must not outlive the scenario
  for (const t of MOBS) await w.run(`tp @e[type=${t}] ${C.x} -500 ${C.z}`);
  await w.run("kill @e[type=item,distance=..100,x=60,y=67,z=60]");
  await w.run("difficulty peaceful");
  await w.run("gamerule spawn_mobs true");
  await w.run("time set day");
  await w.run(`tp ${c.bot} 0.5 68 -10`);
}

// put the arena back to bare grass, whatever a scenario built in or under it
export async function tidy(c: Ctx) {
  await c.world.run("fill 50 58 50 70 65 70 stone");
  await floor(c);
  await leave(c);
}
