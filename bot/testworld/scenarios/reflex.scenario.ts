// Reflexes on Normal, with the facts the server gives: health, deaths, blocks, the Fire tag, food. Each
// scenario also reads the body's own events (reflex_started / changed / ended, hurt, starving), because a
// mind plays through `wait` and is deaf when a reflex starts, changes or ends without one. The checks are
// collateral and recovery as much as survival: health at the end, whether a mock house stood, whether the
// reflex let go (the body takes an order again) and whether it ended once instead of looping.
import { arena, C, leave, rel, tidy } from "./arena";
import { sleep, type BodyEvent, type Ctx, type Pos, type Scenario } from "./lib";
import { WardBot } from "./ward";

const ARMOUR = ["head helmet", "chest chestplate", "legs leggings", "feet boots"];
const at = (p: Pos) => `${p.x} ${p.y} ${p.z}`;
const zombieTag = "{PersistenceRequired:1b,IsBaby:0b}";

async function armour(c: Ctx, kind = "iron"): Promise<void> {
  for (const piece of ARMOUR) {
    const [slot, item] = piece.split(" ");
    await c.world.run(`item replace entity ${c.bot} armor.${slot} with minecraft:${kind}_${item}`);
  }
}

// nothing hostile left over from an earlier scenario, only what the fixture summons
async function clearMobs(c: Ctx): Promise<void> {
  for (const t of ["zombie", "creeper", "skeleton", "spider", "husk", "drowned"]) await c.world.run(`kill @e[type=${t}]`);
}

async function setup(c: Ctx): Promise<void> {
  await c.body.send({ intent: "stop" });
  await clearMobs(c);
  await arena(c);
  await sleep(500);
}

const since = (c: Ctx, from: number) => c.body.events.slice(from);
const named = (list: BodyEvent[], event: string, what?: string) => list.filter((e) => e.event === event && (what === undefined || e.what === what));

async function lowestHealth(c: Ctx, ms: number, stop?: () => Promise<boolean>): Promise<{ lowest: number; secs: number }> {
  let lowest = 20;
  const t0 = Date.now();
  for (; Date.now() - t0 < ms; await sleep(250)) {
    lowest = Math.min(lowest, await c.world.health(c.bot));
    if (stop && (await stop())) break;
  }
  return { lowest, secs: Math.round((Date.now() - t0) / 100) / 10 };
}

// a body that has let go takes an order again (and is stopped at once)
async function takesOrders(c: Ctx): Promise<boolean> {
  const ok = await c.body.startTask();
  await c.body.send({ intent: "stop" });
  return ok;
}

const alive = (c: Ctx, type: string) => c.world.passes(`execute if entity @e[type=${type},x=${C.x},y=${C.y},z=${C.z},distance=..80]`);

// a sealed 5 by 5 room: the pathfinder has no way out to flee along, so running gains nothing
async function sealedRoom(c: Ctx): Promise<void> {
  await c.world.run("fill 57 66 57 63 70 63 stone");
  await c.world.run("fill 58 67 58 62 69 62 air");
  await c.world.run(`tp ${c.bot} 58.5 67 58.5`);
}

const cornered: Scenario = (() => {
  let from = 0;
  let run = { lowest: 20, secs: 0 };
  return {
    name: "reflex: cornered in a sealed room, armoured but bare-handed, fights it out",
    timeoutMs: 120_000,
    view: rel(-4, 6),
    async setup(c) {
      await setup(c);
      await armour(c);
      await sealedRoom(c);
      await sleep(1500);
    },
    async act(c) {
      from = c.body.mark();
      await c.world.run(`summon minecraft:zombie 62.5 67 62.5 ${zombieTag}`);
      run = await lowestHealth(c, 60_000, async () => !(await alive(c, "zombie")));
      await sleep(4000);
    },
    async verify(c) {
      const ev = since(c, from);
      const started = named(ev, "reflex_started", "mobs");
      const changed = named(ev, "reflex_changed", "mobs");
      const ended = named(ev, "reflex_ended", "mobs");
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(!(await alive(c, "zombie")), `the zombie is dead (${run.secs} s)`);
      c.check(run.lowest >= 6, `health stayed at 6 or more (lowest ${run.lowest})`);
      c.check(started.length === 1, `one reflex_started mobs (${started.length}): ${started[0]?.why}`);
      c.check(changed.some((e) => /cornered, fighting a zombie/.test(String(e.why))), `reflex_changed says cornered, fighting (${JSON.stringify(changed.map((e) => e.why))})`);
      c.check(ended.length === 1 && ended[0].ok === true, `one reflex_ended mobs ok (${JSON.stringify(ended.map((e) => e.ok))})`);
      c.check(named(ev, "hurt").length >= 1, "the damage woke the mind with a hurt event");
      c.check(await takesOrders(c), "released: the body takes an order again");
    },
    async cleanup(c) {
      await clearMobs(c);
      await c.world.run(`clear ${c.bot}`);
      await tidy(c);
    },
  };
})();

const giveUp: Scenario = (() => {
  let from = 0;
  return {
    name: "reflex: cornered by a creeper it will not fight lets go once and takes orders",
    timeoutMs: 90_000,
    view: rel(-4, 6),
    async setup(c) {
      await setup(c);
      await sealedRoom(c);
    },
    async act(c) {
      from = c.body.mark();
      // stands still a few blocks off: close enough to count as pressing, never hurts. A creeper is never fought
      await c.world.run("summon minecraft:creeper 61.5 67 58.5 {NoAI:1b,PersistenceRequired:1b}");
      await c.body.waitEvent("reflex_ended", from, 25_000);
      await sleep(12_000);
    },
    async verify(c) {
      const ev = since(c, from);
      const ended = named(ev, "reflex_ended", "mobs");
      c.check(named(ev, "reflex_started", "mobs").length === 1, "one reflex_started mobs");
      c.check(ended.length === 1, `one reflex_ended in 37 s, not a loop (${ended.length})`);
      c.check(ended[0]?.ok === false && /cornered/.test(String(ended[0]?.detail)), `it gave up as cornered (${JSON.stringify(ended[0])})`);
      c.check(await takesOrders(c), "released: the body takes an order again");
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
    },
    async cleanup(c) {
      await clearMobs(c);
      await tidy(c);
    },
  };
})();

// order matters to a waiter: the task ends as interrupted first, then the reflex says it started
const order: Scenario = (() => {
  let from = 0;
  return {
    name: "reflex: a task ends interrupted before the reflex says it started",
    timeoutMs: 90_000,
    view: { x: 0, y: 70, z: -20 },
    async setup(c) {
      await c.body.send({ intent: "stop" });
      await clearMobs(c);
      await c.world.run("gamerule spawn_mobs false");
      await c.world.run("difficulty normal");
      await c.world.run("time set midnight");
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
      await c.world.run(`tp ${c.bot} 0.5 68 -10`);
      await sleep(1000);
    },
    async act(c) {
      from = c.body.mark();
      c.check(await c.body.startTask(), "task accepted");
      await sleep(2500);
      const [x, y, z] = (await c.world.pos(c.bot)).map((n) => Math.round(n));
      await c.world.run(`summon minecraft:zombie ${x + 6} ${y} ${z} ${zombieTag}`);
      await c.body.waitEvent("reflex_started", from, 12_000);
      await sleep(1500);
    },
    async verify(c) {
      const ev = since(c, from);
      const failed = ev.findIndex((e) => e.event === "task_failed" && e.reason === "interrupted");
      const started = ev.findIndex((e) => e.event === "reflex_started");
      c.check(failed >= 0 && started >= 0, `both events arrived (failed at ${failed}, started at ${started})`);
      c.check(failed < started, "task_failed interrupted comes before reflex_started");
      c.check(/zombie/.test(String(ev[started]?.why)), `the start says what it does about it (${ev[started]?.why})`);
    },
    cleanup: async (c) => {
      await clearMobs(c);
      await leave(c);
    },
  };
})();

// water 5 deep under a stone ceiling, a shaft to the open air four blocks off. The nearest dry cell is on
// top of the ceiling, straight up and out of reach; the way out is sideways, through the shaft
const ceiling: Scenario = (() => {
  let from = 0;
  let run = { lowest: 20, secs: 0 };
  const dry = (c: Ctx) =>
    c.world.passes(`execute as ${c.bot} at @s unless block ~ ~1 ~ water unless block ~ ~ ~ water`);
  return {
    name: "reflex: underwater under a ceiling, the way out is the shaft not the roof",
    timeoutMs: 90_000,
    view: { x: C.x - 6, y: C.y + 4, z: C.z },
    async setup(c) {
      await setup(c);
      await c.world.run(`fill 55 60 56 67 66 64 stone`);
      await c.world.run(`fill 56 61 57 66 65 63 water`);
      await c.world.run(`fill 63 66 59 64 66 61 water`);
      await c.world.run(`tp ${c.bot} 59.5 61 60.5`);
    },
    async act(c) {
      from = c.body.mark();
      run = await lowestHealth(c, 40_000, async () => (await c.body.waitEvent("reflex_ended", from, 1)) !== null);
      await sleep(2000);
    },
    async verify(c) {
      const ev = since(c, from);
      const ended = named(ev, "reflex_ended", "drowning");
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(run.lowest >= 8, `health stayed at 8 or more (lowest ${run.lowest}, out in ${run.secs} s)`);
      c.check(await dry(c), "head out of the water at the end");
      c.check(named(ev, "reflex_started", "drowning").length === 1, "one reflex_started drowning");
      c.check(ended.length === 1 && ended[0].ok === true, `one reflex_ended drowning, ok (${JSON.stringify(ended.map((e) => [e.ok, e.detail]))})`);
      c.check(await takesOrders(c), "released: the body takes an order again");
    },
    cleanup: tidy,
  };
})();

async function pool(c: Ctx): Promise<void> {
  await c.world.run(`fill 63 65 58 66 65 62 stone`);
  await c.world.run(`fill 63 66 58 66 66 62 water`);
}

const burning = (() => {
  let from = 0;
  let run = { lowest: 20, secs: 0 };
  const fireTag = async (c: Ctx) => Number((await c.world.run(`data get entity ${c.bot} Fire`)).match(/(-?\d+)s?\s*$/)?.[1] ?? -1);
  const s: Scenario = {
    // a fireball sets the body on fire without lava or fire under it: only the entity's own flags say so
    name: "reflex: set on fire by a fireball, walks to the pool and puts it out",
    timeoutMs: 90_000,
    view: { x: C.x - 8, y: C.y + 3, z: C.z },
    async setup(c) {
      await setup(c);
      await pool(c);
    },
    async act(c) {
      from = c.body.mark();
      await c.world.run(`execute as ${c.bot} at @s run summon minecraft:small_fireball ~ ~3 ~ {Motion:[0.0,-0.5,0.0],power:[0.0,-0.1,0.0]}`);
      run = await lowestHealth(c, 20_000, async () => (await fireTag(c)) <= 0 && (await c.body.waitEvent("reflex_ended", from, 1)) !== null);
      await sleep(1500);
    },
    async verify(c) {
      const ev = since(c, from);
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(run.lowest >= 8, `health stayed at 8 or more (lowest ${run.lowest}, over in ${run.secs} s)`);
      c.check((await fireTag(c)) <= 0, "the fire is out");
      c.check(named(ev, "reflex_started", "burning").length === 1, `reflex_started burning (${JSON.stringify(named(ev, "reflex_started").map((e) => e.what))})`);
      // the blow itself says "hurt by something" (the fire flag comes a moment after); the burn may be out before its own event
      c.check(named(ev, "hurt").length >= 1, `the damage woke the mind with a hurt event (${JSON.stringify(named(ev, "hurt").map((e) => e.cause))})`);
      c.check(named(ev, "reflex_ended", "burning").length === 1, "one reflex_ended burning");
      c.check(await takesOrders(c), "released: the body takes an order again");
    },
    cleanup: tidy,
  };
  return s;
})();

const fallEnds = (name: string, withPool: boolean, expect: RegExp, hurtCause: RegExp | null): Scenario => {
  let from = 0;
  return {
    name,
    timeoutMs: 60_000,
    view: { x: C.x - 8, y: C.y + 6, z: C.z },
    async setup(c) {
      await setup(c);
      if (withPool) {
        await c.world.run(`fill ${C.x + 2} 65 ${C.z - 1} ${C.x + 3} 65 ${C.z + 1} stone`);
        await c.world.run(`fill ${C.x + 2} 66 ${C.z - 1} ${C.x + 3} 66 ${C.z + 1} water`);
      }
    },
    async act(c) {
      from = c.body.mark();
      await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y + 15} ${C.z}.5`);
      await c.body.waitEvent("reflex_ended", from, 10_000);
      await sleep(1500);
    },
    async verify(c) {
      const ev = since(c, from);
      const ended = named(ev, "reflex_ended", "fall");
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(ended.length === 1, `one reflex_ended fall (${ended.length})`);
      c.check(expect.test(String(ended[0]?.detail)), `it says how it landed (${ended[0]?.detail})`);
      c.check(named(ev, "reflex_started", "fall").length === (withPool ? 1 : 0), `reflex_started fall only when it steered (${named(ev, "reflex_started", "fall").length})`);
      if (hurtCause) c.check(named(ev, "hurt").some((e) => hurtCause.test(String(e.cause))), `a hurt event says ${hurtCause} (${JSON.stringify(named(ev, "hurt").map((e) => e.cause))})`);
    },
    cleanup: tidy,
  };
};

// hunger forced with the hunger effect (peaceful refills the bar), stopped at `max`
async function drainTo(c: Ctx, max: number): Promise<number> {
  const level = async () => Number((await c.world.run(`data get entity ${c.bot} foodLevel`)).match(/(\d+)\s*$/)?.[1] ?? NaN);
  await c.world.run("difficulty easy");
  await c.world.run(`effect give ${c.bot} minecraft:hunger 120 100 true`);
  let now = await level();
  for (let i = 0; i < 1500 && now > max; i++) {
    await sleep(40);
    now = await level();
  }
  await c.world.run(`effect clear ${c.bot}`);
  await c.world.run("difficulty normal");
  return now;
}

// a sealed 5 by 5 room, so running gains nothing; a skeleton that cannot move or shoot stands `dist` blocks off
const hungryRun = (name: string, dist: number, eats: boolean): Scenario => {
  let from = 0;
  let food0 = 20;
  let food1 = 0;
  return {
    name,
    timeoutMs: 90_000,
    view: { x: C.x, y: C.y + 6, z: C.z - 8 },
    async setup(c) {
      await setup(c);
      await c.world.run("effect give " + c.bot + " minecraft:saturation 1 20 true");
      await sleep(9000);
      await c.world.run(`fill 57 66 57 63 70 63 stone`);
      await c.world.run(`fill 58 67 58 62 69 62 air`);
      await c.world.run(`tp ${c.bot} 60.5 67 60.5`);
      food0 = await drainTo(c, 5);
      await c.world.run(`give ${c.bot} bread 4`);
    },
    async act(c) {
      from = c.body.mark();
      await c.world.run(`summon minecraft:skeleton ${60 - dist}.5 67 60.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
      await sleep(14_000);
      food1 = Number((await c.world.run(`data get entity ${c.bot} foodLevel`)).match(/(\d+)\s*$/)?.[1] ?? NaN);
    },
    async verify(c) {
      const ev = since(c, from);
      c.check(food0 <= 6, `hunger forced (food ${food0})`);
      c.check(named(ev, "reflex_started", "mobs").length === 1, "running from the skeleton");
      c.check(named(ev, "reflex_ended", "mobs").length === 0, "still running at the end, nothing ended it");
      c.check(named(ev, "starving").length === 1, `starving said once (${named(ev, "starving").length})`);
      if (eats) {
        c.check(food1 > food0, `it ate on the run: food ${food0} to ${food1}`);
        c.check(named(ev, "reflex_started", "eating").length >= 1, "an eating reflex_started");
      } else {
        c.check(food1 <= food0, `it did not eat with the threat close: food ${food0} to ${food1}`);
        c.check(named(ev, "reflex_started", "eating").length === 0, "no eating event");
      }
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
    },
    async cleanup(c) {
      await clearMobs(c);
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`effect give ${c.bot} minecraft:saturation 1 20 true`);
      await tidy(c);
    },
  };
};

// A mock house of planks and glass with the Ward standing against its wall and a creeper coming at them. The guard
// goes for creepers (stance.ts GUARD); this reads what that costs the house, the body and the Ward.
const HOUSE = { x: C.x + 6, z: C.z - 1 }; // 3 by 3 by 3, floor on the arena
const houseCells = (): { from: Pos; to: Pos } => ({ from: { x: HOUSE.x, y: C.y, z: HOUSE.z }, to: { x: HOUSE.x + 2, y: C.y + 2, z: HOUSE.z + 2 } });

const guardHouse = (name: string, armed: boolean, knownFailing?: string): Scenario => {
  const ward = new WardBot();
  let from = 0;
  let built = 0;
  let run = { lowest: 20, secs: 0 };
  let wardLowest = 20;
  return {
    name,
    knownFailing,
    timeoutMs: 120_000,
    view: rel(-8, 0),
    async setup(c) {
      await setup(c);
      if (armed) {
        await c.world.run(`give ${c.bot} iron_sword`);
        await armour(c);
      }
      const g = (await c.world.run("gamerule mob_griefing")).includes("true");
      c.check(g, "mob_griefing is on, or a house standing proves nothing");
      const { from: a, to: b } = houseCells();
      await c.world.run(`fill ${a.x} ${a.y} ${a.z} ${b.x} ${b.y} ${b.z} oak_planks hollow`);
      await c.world.run(`fill ${a.x + 1} ${a.y + 1} ${a.z} ${a.x + 1} ${a.y + 1} ${a.z} glass`);
      built = await houseBlocks(c);
      await ward.join();
      await c.world.run(`gamemode survival Ward`);
      await c.world.run(`tp Ward ${HOUSE.x - 1}.5 ${C.y} ${C.z}.5`); // against the west wall
      await c.world.trackDeaths("Ward");
      await sleep(1500);
    },
    async act(c) {
      from = c.body.mark();
      let reply = { type: "none" } as { type: string };
      for (let i = 0; i < 6 && reply.type !== "accepted"; i++) {
        reply = await c.body.send({ intent: "guard", player: "Ward" });
        if (reply.type !== "accepted") await sleep(1000);
      }
      c.check(reply.type === "accepted", "the guard order was accepted");
      await sleep(2000);
      // from the north, so it comes past the corner of the house to the Ward
      await c.world.run(`summon minecraft:creeper ${HOUSE.x - 1}.5 ${C.y} ${C.z + 8}.5 {PersistenceRequired:1b}`);
      const watchWard = async () => {
        wardLowest = Math.min(wardLowest, await c.world.health("Ward"));
        return !(await alive(c, "creeper"));
      };
      run = await lowestHealth(c, 40_000, watchWard);
      await sleep(3000);
    },
    async verify(c) {
      const left = await houseBlocks(c);
      c.check(built >= 20, `the house was built (${built} blocks)`);
      c.check(left === built, `no block of the house was destroyed (${built} before, ${left} after)`);
      c.check(run.lowest >= 12, `the body took less than 8 damage (lowest ${run.lowest}, creeper gone in ${run.secs} s)`);
      c.check(wardLowest >= 12, `the ward took less than 8 damage (lowest ${wardLowest})`);
      c.check((await c.world.deaths(c.bot)) === 0 && (await c.world.deaths("Ward")) === 0, "nobody died");
      const hurt = named(since(c, from), "hurt");
      c.check(hurt.length <= 2, `a blast wakes the mind once or twice, not per tick (${hurt.length}: ${JSON.stringify(hurt.map((e) => e.cause))})`);
    },
    async cleanup(c) {
      await ward.quit();
      await clearMobs(c);
      await c.world.run(`clear ${c.bot}`);
      const { from: a, to: b } = houseCells();
      await c.world.run(`fill ${a.x - 1} ${a.y} ${a.z - 1} ${b.x + 1} ${b.y + 2} ${b.z + 1} air`);
      await leave(c);
    },
  };
};

async function houseBlocks(c: Ctx): Promise<number> {
  const { from, to } = houseCells();
  return (await c.world.countBlocks(from, to, "oak_planks")) + (await c.world.countBlocks(from, to, "glass"));
}

export default [
  cornered,
  giveUp,
  order,
  ceiling,
  burning,
  fallEnds("reflex: a 15 block fall onto stone ends with one landing event", false, /landed hard, badly hurt/, /falling/),
  fallEnds("reflex: a steered fall into a pool says it landed in water", true, /landed in water/, null),
  hungryRun("reflex: starving on the run, far from the threat, eats", 18, true),
  hungryRun("reflex: starving with the threat close, does not eat", 8, false),
  guardHouse("reflex: guard vs a creeper beside a house, sword and armour, the house stands", true),
  // a blast reaches the body in some runs (lowest health 2.2 and 5.4 seen) and the house still stood; a pass is not a fix, it is luck
  guardHouse("reflex: guard vs a creeper beside a house, bare hands, the house stands", false, "bare-handed, the guard lets a creeper blast it in some runs"),
] satisfies Scenario[];
