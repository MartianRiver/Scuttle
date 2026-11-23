// A walk that goes nowhere ends as `stuck` instead of hanging, and a walk that is slow but real does
// not. Facts from the server: how the action ended, that the bot is alive and where it stood.
// The frozen bot is the one the watchdog is for: a bot the server keeps putting back can't get anywhere, so the
// pathfinder holds a path it can never follow. The pit is the boxed-in case from the roadmap, where the planner
// has no path at all.
import { arena, C, tidy } from "./arena";
import { get_wood } from "./get_wood.scenario";
import { sleep, type Ctx, type Scenario } from "./lib";

const START = "0.5 68 -10"; // the usual start
const GIVE = ["oak_log 16", "oak_planks 12", "stick 4", "wooden_pickaxe 1", "wooden_axe 1"];

async function endOf(c: Ctx, from: number, ms: number) {
  return Promise.race([c.body.waitEvent("task_finished", from, ms), c.body.waitEvent("task_failed", from, ms)]);
}

async function calm(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`gamemode survival ${c.bot}`);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
}

// the server puts the body back on its spot every 100 ms (a mounted bot would do, but `ride` refuses
// the bot on 26.3): it keeps pathing and never gets anywhere
function pin(c: Ctx): () => void {
  let on = true;
  void (async () => {
    while (on) {
      await c.world.run(`tp ${c.bot} ${START}`).catch(() => {});
      await sleep(100);
    }
  })();
  return () => {
    on = false;
  };
}

const alive = async (c: Ctx) => (await c.world.health(c.bot)) > 0;

const frozen: Scenario = {
  name: "unstuck: a frozen bot's walk ends stuck",
  timeoutMs: 90_000,
  async setup(c) {
    await calm(c);
    for (const give of GIVE) await c.world.run(`give ${c.bot} ${give}`);
    await c.world.run(`tp ${c.bot} ${START}`);
    await sleep(1500);
  },
  async act(c) {
    const from = c.body.mark();
    const t0 = Date.now();
    const unpin = pin(c);
    try {
      c.check(await c.body.startTask(), "task accepted");
      const ended = await endOf(c, from, 60_000);
      c.check(ended?.event === "task_failed" && ended.reason === "stuck", `task_failed stuck (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
      c.check(Date.now() - t0 < 60_000, `ended within 60 s (${Math.round((Date.now() - t0) / 1000)} s)`);
    } finally {
      unpin();
    }
  },
  async verify(c) {
    await sleep(500);
    c.check(await alive(c), "the bot is alive");
    // free again: a second run is accepted and the body takes orders
    await c.body.send({ intent: "stop" });
    await sleep(1000);
    const again = c.body.mark();
    c.check(await c.body.startTask(), "task accepted again after the failure");
    c.check((await endOf(c, again, 90_000))?.event === "task_finished", "and the second run finishes");
  },
};

// a 1x1 pit two deep in the arena floor and sixteen logs in the pocket: gathering is skipped, so the
// first thing the task does is walk to the crafting table, and there is no way out of the pit. The
// planner answers with an empty path, which goto reports as arrival; the walk has to end `stuck`
const sealed: Scenario = {
  name: "unstuck: boxed in a pit, the walk to the table ends stuck",
  timeoutMs: 120_000,
  view: { x: C.x - 8, y: C.y + 3, z: C.z },
  async setup(c) {
    await arena(c);
    await c.world.run(`fill ${C.x} 65 ${C.z} ${C.x} 66 ${C.z} air`);
    await c.world.run(`give ${c.bot} oak_log 16`);
    await c.world.run(`tp ${c.bot} ${C.x}.5 65 ${C.z}.5`);
    await sleep(1500);
  },
  async act(c) {
    const from = c.body.mark();
    const t0 = Date.now();
    c.check(await c.body.startTask(), "task accepted");
    const ended = await endOf(c, from, 60_000);
    c.check(ended?.event === "task_failed" && ended.reason === "stuck", `task_failed stuck (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
    c.check(Date.now() - t0 < 60_000, `ended within 60 s (${Math.round((Date.now() - t0) / 1000)} s)`);
  },
  async verify(c) {
    c.check(await alive(c), "the bot is alive");
    const [x, y, z] = await c.world.pos(c.bot);
    c.check(Math.abs(x - C.x - 0.5) < 1 && Math.abs(z - C.z - 0.5) < 1 && y < 67, `still in the pit (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
  },
  cleanup: tidy,
};

// the quiet half: a whole get_wood, with walks, digs and a craft, must finish with the watchdog on
const quiet: Scenario = {
  ...get_wood,
  name: "unstuck: a normal wood run still finishes",
  async act(c) {
    const from = c.body.mark();
    c.check(await c.body.startTask(), "task accepted");
    const ended = await endOf(c, from, 240_000);
    c.check(ended?.event === "task_finished", `task finished (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "pickaxe made");
    c.check((await c.world.count(c.bot, "wooden_axe")) >= 1, "axe made");
  },
};

export default [frozen, sealed, quiet];
