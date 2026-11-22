// Lava, fire and drowning, in the night arena with bare hands. Facts from the server: the death
// counter, lowest health, whether the bot is still in the hazard at the end. The last scenario is
// the quiet half: standing in shallow water is not a hazard and must not take the body's orders.
import { arena, C, tidy } from "./arena";
import { sleep, type Ctx, type Scenario } from "./lib";

const RUN_MS = 20_000;
const at = (x: number, y: number, z: number) => `${x} ${y} ${z}`;

// a water pool nearby, floored with stone so it holds
async function pool(c: Ctx) {
  await c.world.run("fill 63 65 58 66 65 62 stone");
  await c.world.run("fill 63 66 58 66 66 62 water");
}

async function watch(c: Ctx): Promise<{ lowest: number }> {
  let lowest = 20;
  for (const end = Date.now() + RUN_MS; Date.now() < end; await sleep(250)) {
    lowest = Math.min(lowest, await c.world.health(c.bot));
  }
  return { lowest };
}

// the hazards are over when the head is out of water and the body is out of lava and fire
const out = (c: Ctx) =>
  c.world.passes(`execute as ${c.bot} at @s unless block ~ ~1 ~ water unless block ~ ~ ~ lava unless block ~ ~ ~ fire unless block ~ ~1 ~ fire`);

async function burning(c: Ctx): Promise<boolean> {
  const fire = (await c.world.run(`data get entity ${c.bot} Fire`)).match(/(-?\d+)s?\s*$/)?.[1];
  return Number(fire ?? -1) > 0;
}

function hazard(name: string, minHealth: number, build: (c: Ctx) => Promise<void>, ends?: (c: Ctx) => Promise<void>): Scenario {
  let lowest = 20;
  return {
    name,
    timeoutMs: 90_000,
    view: { x: C.x - 10, y: C.y + 3, z: C.z },
    setup: arena,
    async act(c) {
      await build(c);
      lowest = (await watch(c)).lowest;
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(lowest >= minHealth, `health stayed at ${minHealth} or more (lowest ${lowest})`);
      c.check(await out(c), "head out of water, clear of lava and fire at the end");
      await ends?.(c);
    },
    cleanup: tidy,
  };
}

// a one-block pit of lava in the floor: its sides are solid, so it does not flow, and the way out is
// one jump up over the rim
const lava = hazard("dropped into a lava pit beside a pool", 2, async (c) => {
  await pool(c);
  await c.world.run(`setblock ${at(C.x, C.y - 1, C.z)} lava`);
  await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y - 1} ${C.z}.5`);
}, async (c) => c.check(!(await burning(c)), "the fire is out"));

const fire = hazard("standing in fire on netherrack", 8, async (c) => {
  await pool(c);
  await c.world.run(`setblock ${at(C.x, C.y - 1, C.z)} netherrack`);
  await c.world.run(`setblock ${at(C.x, C.y, C.z)} fire`);
  await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y} ${C.z}.5`);
}, async (c) => c.check(!(await burning(c)), "the fire is out"));

const drowning = hazard("on the bottom of a deep pool", 8, async (c) => {
  await c.world.run("fill 54 58 56 62 58 64 stone");
  await c.world.run("fill 55 59 57 61 66 63 water");
  await c.world.run(`tp ${c.bot} 58.5 59 60.5`);
});

const shallow: Scenario = {
  name: "wading in shallow water does not take the body",
  timeoutMs: 60_000,
  view: { x: C.x - 8, y: C.y + 3, z: C.z },
  setup: arena,
  async act(c) {
    await c.world.run(`setblock ${at(C.x, C.y, C.z)} water`);
    await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y} ${C.z}.5`);
    await sleep(8000);
  },
  async verify(c) {
    const reply = await c.body.send({ intent: "task", name: "get_wood" });
    c.check(reply.type === "accepted", `an order is accepted, not ${reply.reason ?? reply.type}`);
    await c.body.send({ intent: "stop" });
  },
  cleanup: tidy,
};

export default [lava, fire, drowning, shallow];
