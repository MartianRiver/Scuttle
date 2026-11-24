// Death: /kill over RCON, then what the body API says and what the body does. The `died` event is the
// contract; the bot's own state is read from the server. The test world has keep_inventory off, so what
// the bot carries is dropped where it dies.
import { arena, C, leave } from "./arena";
import { sleep, type Ctx, type Scenario } from "./lib";

const START = "0.5 68 -10";

async function clearDrops(c: Ctx) {
  await c.world.run("kill @e[type=item]");
}

async function alive(c: Ctx, ms = 10_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    if ((await c.world.health(c.bot)) === 20) return true;
  }
  return false;
}

const dist = (a: number[], b: { x: number; z: number }) => Math.hypot(a[0] - b.x, a[2] - b.z);

let taskId: string | undefined;
let from = 0;
const midTask: Scenario = {
  name: "death mid get_wood: task_failed died, then died with a place, and the body takes a new task",
  timeoutMs: 90_000,
  view: { x: 0, y: 70, z: -20 },
  async setup(c) {
    await c.body.send({ intent: "stop" });
    await sleep(1500);
    await c.world.run("difficulty peaceful");
    await c.world.run(`clear ${c.bot}`);
    await c.world.run(`tp ${c.bot} ${START}`);
    await clearDrops(c);
    await c.world.trackDeaths(c.bot);
    await sleep(1000);
  },
  async act(c) {
    const reply = await c.body.send({ intent: "task", name: "get_wood" });
    c.check(reply.type === "accepted", "task accepted");
    taskId = reply.taskId;
    await sleep(3000);
    from = c.body.mark();
    await c.world.run(`kill ${c.bot}`);
  },
  async verify(c) {
    const failed = await c.body.waitEvent("task_failed", from, 5000);
    c.check(failed?.reason === "died" && failed.taskId === taskId, `task_failed died for that task (saw ${failed?.reason ?? "nothing"})`);
    const died = await c.body.waitEvent("died", from, 5000);
    c.check(died !== null, "a died event");
    const place = String(died?.place ?? "");
    c.check(place.length > 0, `died has a place (${place})`);
    c.check(!/\d/.test(place), "the place has no digits");
    c.check(typeof died?.cause === "string", `died has a cause (${died?.cause})`);
    const order = c.body.events.slice(from).map((e) => e.event);
    c.check(order.indexOf("task_failed") < order.indexOf("died"), "task_failed comes before died");

    c.check(await alive(c), "the bot is alive with 20 health");
    c.check((await c.world.deaths(c.bot)) === 1, "one death on the server");
    // busy while the old task winds down, as after a stop; startTask allows it 8 s
    c.check(await c.body.startTask(), "a new task is accepted once the old one has wound down");
    await c.body.send({ intent: "stop" });
  },
  cleanup: async (c) => {
    await c.body.send({ intent: "stop" });
    await sleep(1500);
    await clearDrops(c);
    await c.world.run(`tp ${c.bot} ${START}`);
  },
};

// dies far from where it respawns, carrying things: the drops stay where they fell
let diedAt = { x: C.x, z: C.z };
const idle: Scenario = {
  name: "death while idle: died arrives, the body stays where it respawned and leaves its drops",
  timeoutMs: 90_000,
  view: { x: C.x - 12, y: 70, z: C.z },
  async setup(c) {
    await c.body.send({ intent: "stop" });
    await sleep(1000);
    await arena(c);
    await clearDrops(c);
    await c.world.run(`give ${c.bot} oak_log 5`);
    await c.world.run(`give ${c.bot} dirt 7`);
    await sleep(500);
  },
  async act(c) {
    diedAt = { x: (await c.world.pos(c.bot))[0], z: (await c.world.pos(c.bot))[2] };
    from = c.body.mark();
    await c.world.run(`kill ${c.bot}`);
  },
  async verify(c) {
    const died = await c.body.waitEvent("died", from, 5000);
    c.check(died !== null, "a died event while idle");
    const place = String(died?.place ?? "");
    c.check(place.length > 0 && !/\d/.test(place), `a place in words (${place})`);
    c.check(!c.body.events.slice(from).some((e) => e.event === "task_failed"), "no task_failed: nothing was running");
    c.check(await alive(c), "the bot is alive with 20 health");

    await sleep(2000);
    const start = await c.world.pos(c.bot);
    c.check(dist(start, diedAt) > 30, `it respawned away from where it died (${dist(start, diedAt).toFixed(0)} blocks)`);
    let worst = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const now = await c.world.pos(c.bot);
      worst = Math.max(worst, Math.hypot(now[0] - start[0], now[2] - start[2]));
    }
    c.check(worst <= 2, `it stayed put for 10 s (moved at most ${worst.toFixed(1)} blocks)`);
    c.check((await c.world.count(c.bot, "oak_log")) === 0 && (await c.world.count(c.bot, "dirt")) === 0, "it did not pick its drops back up");
    c.check(await c.world.passes(`execute positioned ${C.x} ${C.y} ${C.z} if entity @e[type=item,distance=..8]`), "the drops are still where it died");
    const status = await c.body.send({ intent: "status" });
    c.check(status.type === "status", "status answers after the death");
  },
  cleanup: async (c) => {
    await leave(c);
    await clearDrops(c);
  },
};

export default [midTask, idle];
