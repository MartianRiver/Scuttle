// Falls, in the night arena with bare hands. A drop from 15 up costs 12 health on stone; with a pool
// two blocks aside the body should steer into it, and with nothing in reach it should leave the fall
// alone (the control, which also proves the drop is worth steering for). A short drop beside water
// must not move it at all. The last one is the walk out of fire: dry floor behind, water across a
// trench too wide to jump, and the way out must not be through the trench.
import { arena, C, tidy } from "./arena";
import { sleep, type Ctx, type Scenario } from "./lib";

const HIGH = 15;

async function watch(c: Ctx, ms: number): Promise<{ lowest: number; lowY: number }> {
  let lowest = 20;
  let lowY = Infinity;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    lowest = Math.min(lowest, await c.world.health(c.bot));
    lowY = Math.min(lowY, (await c.world.pos(c.bot))[1]);
  }
  return { lowest, lowY };
}

// one deep water in the floor, stone under it
async function pool(c: Ctx, x0: number, x1: number) {
  await c.world.run(`fill ${x0} 65 ${C.z - 1} ${x1} 65 ${C.z + 1} stone`);
  await c.world.run(`fill ${x0} 66 ${C.z - 1} ${x1} 66 ${C.z + 1} water`);
}

const drop = (c: Ctx, height: number) => c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y + height} ${C.z}.5`);

// how far from under the drop point it ended
async function drift(c: Ctx): Promise<number> {
  const [x, , z] = await c.world.pos(c.bot);
  return Math.hypot(x - (C.x + 0.5), z - (C.z + 0.5));
}

const steers: Scenario = (() => {
  let lowest = 20;
  return {
    name: "falling 15 blocks beside a pool steers into it",
    timeoutMs: 60_000,
    view: { x: C.x - 8, y: C.y + 6, z: C.z },
    setup: arena,
    async act(c) {
      await pool(c, C.x + 2, C.x + 3);
      await drop(c, HIGH);
      lowest = (await watch(c, 5000)).lowest;
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(lowest >= 19, `the fall cost at most 1 health (lowest ${lowest})`);
    },
    cleanup: tidy,
  };
})();

const control: Scenario = (() => {
  let lowest = 20;
  return {
    name: "falling 15 blocks with water out of reach is left alone",
    timeoutMs: 60_000,
    view: { x: C.x - 8, y: C.y + 6, z: C.z },
    setup: arena,
    async act(c) {
      await pool(c, C.x + 8, C.x + 9);
      await drop(c, HIGH);
      lowest = (await watch(c, 5000)).lowest;
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(lowest <= 20 - (HIGH - 3) + 1, `the fall hurt as a 15-block fall does (lowest ${lowest})`);
      c.check((await drift(c)) < 1, "it landed under the drop point");
    },
    cleanup: tidy,
  };
})();

const short: Scenario = (() => {
  let lowest = 20;
  return {
    name: "a 3-block fall beside water is not steered",
    timeoutMs: 60_000,
    view: { x: C.x - 8, y: C.y + 3, z: C.z },
    setup: arena,
    async act(c) {
      await pool(c, C.x + 1, C.x + 2);
      await drop(c, 3);
      lowest = (await watch(c, 3000)).lowest;
    },
    async verify(c) {
      c.check(lowest === 20, `no damage (lowest ${lowest})`);
      c.check((await drift(c)) < 0.5, "it landed under the drop point");
    },
    cleanup: tidy,
  };
})();

const trench: Scenario = (() => {
  let seen = { lowest: 20, lowY: Infinity };
  return {
    name: "out of fire beside a trench, no fall into it",
    timeoutMs: 90_000,
    view: { x: C.x - 8, y: C.y + 3, z: C.z },
    setup: arena,
    async act(c) {
      // a trench two wide and eight deep along x+1..x+2, a lip of floor so the water can't flow in, the
      // pool past it, fire on netherrack at the edge
      await c.world.run(`fill ${C.x + 1} 58 ${C.z - 3} ${C.x + 2} 58 ${C.z + 3} stone`);
      await c.world.run(`fill ${C.x + 1} 59 ${C.z - 3} ${C.x + 2} 66 ${C.z + 3} air`);
      await c.world.run(`fill ${C.x + 4} 65 ${C.z - 3} ${C.x + 5} 65 ${C.z + 3} stone`);
      await c.world.run(`fill ${C.x + 4} 66 ${C.z - 3} ${C.x + 5} 66 ${C.z + 3} water`);
      await c.world.run(`setblock ${C.x} 66 ${C.z} netherrack`);
      await c.world.run(`setblock ${C.x} ${C.y} ${C.z} fire`);
      await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y} ${C.z}.5`);
      seen = await watch(c, 15_000);
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(seen.lowY >= C.y - 1.5, `it never went into the trench (lowest y ${seen.lowY.toFixed(1)})`);
      c.check(seen.lowest >= 10, `health stayed at 10 or more (lowest ${seen.lowest})`);
    },
    cleanup: tidy,
  };
})();

export default [steers, control, short, trench];
