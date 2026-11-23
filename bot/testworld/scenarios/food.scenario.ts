// Food: what the body eats, when, and what it takes from the stash. Hunger is forced with the hunger
// effect on easy (peaceful refills the bar); mobs are off and it is day, so nothing interrupts a task.
// Facts are the server's: food level, item counts, chest contents. Events are the API's.
import { home } from "../../src/lib/home";
import { growNaturalTrees } from "./get_wood.scenario";
import { sleep, type BodyEvent, type Ctx, type Scenario } from "./lib";

const chest = home.stashChests[0];
const chestAt = `${chest.x} ${chest.y} ${chest.z}`;

async function food(c: Ctx): Promise<number> {
  return Number((await c.world.run(`data get entity ${c.bot} foodLevel`)).match(/(\d+)\s*$/)?.[1] ?? NaN);
}

// full, nothing carried, nothing running, and long enough for a survival tick to end any old hunger episode
async function prepare(c: Ctx): Promise<void> {
  const w = c.world;
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await w.run("gamerule spawn_mobs false");
  await w.run("time set day");
  await w.run("difficulty peaceful");
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:saturation 1 20 true`);
  await w.run(`data modify block ${chestAt} Items set value []`);
  await w.run(`tp ${c.bot} 0.5 68 -10`);
  for (let i = 0; i < 40 && (await food(c)) < 20; i++) await sleep(250);
  await sleep(6000);
}

// drain to `max` or below, then stop the drain. Amplifier 100 burns about 2.5 points a second: the 20
// saturation from prepare() goes in about 8 s, then food falls slowly enough to stop within one
async function drainTo(c: Ctx, max: number): Promise<number> {
  await c.world.run("difficulty easy");
  await c.world.run(`effect give ${c.bot} minecraft:hunger 120 100 true`);
  let level = await food(c);
  for (let i = 0; i < 1000 && level > max; i++) {
    await sleep(40);
    level = await food(c);
  }
  await c.world.run(`effect clear ${c.bot}`);
  return level;
}

async function cleanup(c: Ctx): Promise<void> {
  const w = c.world;
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:saturation 1 20 true`);
  await w.run("difficulty peaceful");
  await w.run("gamerule spawn_mobs true");
  await w.run("time set day");
  await w.run(`data modify block ${chestAt} Items set value []`);
  await w.run(`tp ${c.bot} 0.5 68 -10`);
}

const view = { x: 0, y: 70, z: -18 };

function eatsTheBread(): Scenario {
  let start = 99;
  let from = 0;
  return {
    name: "food: hungry with bread and rotten flesh, eats the bread",
    timeoutMs: 90_000,
    view,
    setup: prepare,
    async act(c) {
      start = await drainTo(c, 12);
      await c.world.run(`give ${c.bot} bread 3`);
      await c.world.run(`give ${c.bot} rotten_flesh 3`);
      await sleep(500);
      from = c.body.mark();
      for (let i = 0; i < 100 && (await c.world.count(c.bot, "bread")) === 3; i++) await sleep(250);
      await sleep(2500);
    },
    async verify(c) {
      const now = await food(c);
      c.check(start <= 12, `hunger forced (food ${start})`);
      c.check((await c.world.count(c.bot, "bread")) < 3, "bread eaten");
      c.check((await c.world.count(c.bot, "rotten_flesh")) === 3, "rotten flesh still carried, all 3");
      c.check(now > start, `food rose from ${start} to ${now}`);
      c.check(c.body.events.slice(from).every((e) => e.event !== "no_food"), "no no_food event while it had bread");
    },
    cleanup,
  };
}

function onlyFlesh(): Scenario {
  let start = 99;
  let low = 99;
  let mid = 99;
  let event: BodyEvent | null = null;
  let noFoods = 0;
  let fleshAbove = 0;
  return {
    name: "food: only rotten flesh, no eating above 6, no_food once, eats it at 6",
    timeoutMs: 120_000,
    view,
    setup: prepare,
    async act(c) {
      const from = c.body.mark();
      start = await drainTo(c, 10);
      await c.world.run(`give ${c.bot} rotten_flesh 3`);
      event = await c.body.waitEvent("no_food", from, 12_000);
      await sleep(7000); // a second tick or two: no second event, no meal
      fleshAbove = await c.world.count(c.bot, "rotten_flesh");
      noFoods = c.body.events.slice(from).filter((e) => e.event === "no_food").length;
      mid = await food(c);
      low = await drainTo(c, 6);
      for (let i = 0; i < 100 && (await c.world.count(c.bot, "rotten_flesh")) === 3; i++) await sleep(250);
      await sleep(2500);
    },
    async verify(c) {
      c.check(start <= 10 && start >= 7, `hunger forced into 7 to 10 (food ${start})`);
      c.check(event !== null, "a no_food event arrived");
      const level = event?.food;
      c.check(typeof level === "number" && level < 15 && level >= 7, `no_food carries the food level (${level})`);
      c.check(Object.keys(event ?? {}).every((k) => ["type", "seq", "ts", "event", "food"].includes(k)), "no_food fields are food only");
      c.check(noFoods === 1, `exactly one no_food in the episode (${noFoods})`);
      c.check(fleshAbove === 3, `rotten flesh untouched above 6 (${fleshAbove} left)`);
      c.check(mid <= 10, `food had not risen meanwhile (${mid})`);
      c.check(low <= 6, `drained to 6 or below (${low})`);
      c.check((await c.world.count(c.bot, "rotten_flesh")) < 3, "ate the flesh at 6 or below");
      c.check((await food(c)) > low, "food rose after the flesh");
    },
    cleanup,
  };
}

function duringTask(): Scenario {
  let start = 99;
  let peak = 0;
  let accepted = false;
  let ended: BodyEvent | undefined;
  return {
    name: "food: hungry during get_wood, eats at a pause and the task still finishes",
    timeoutMs: 300_000,
    view,
    async setup(c) {
      await prepare(c);
      await growNaturalTrees(c);
      await sleep(2000); // the bot has to see the new trees before the task looks for one
    },
    async act(c) {
      start = await drainTo(c, 12);
      await c.world.run(`give ${c.bot} bread 4`);
      const from = c.body.mark();
      accepted = await c.body.startTask();
      peak = start;
      const done = (e: BodyEvent) => e.event === "task_finished" || e.event === "task_failed";
      for (const end = Date.now() + 240_000; Date.now() < end && !c.body.events.slice(from).some(done); await sleep(500)) {
        peak = Math.max(peak, await food(c));
      }
      ended = c.body.events.slice(from).find(done);
    },
    async verify(c) {
      c.check(start <= 12, `hunger forced (food ${start})`);
      c.check(accepted, "task accepted");
      c.check(ended?.event === "task_finished", `task finished (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
      c.check(peak > start, `food went up during the task (${start} to a peak of ${peak})`);
      c.check((await c.world.count(c.bot, "bread")) < 4, "bread eaten");
      c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "the task still crafted its pickaxe");
    },
    cleanup,
  };
}

const restock: Scenario = {
  name: "food: a get_wood at the stash takes food from the chest, never rotten flesh",
  timeoutMs: 300_000,
  view,
  async setup(c) {
    await prepare(c);
    await growNaturalTrees(c);
    await sleep(2000); // as above
    const items = [
      `{Slot:0b,id:"minecraft:bread",count:6}`,
      `{Slot:1b,id:"minecraft:cooked_beef",count:3}`,
      `{Slot:2b,id:"minecraft:rotten_flesh",count:5}`,
      `{Slot:3b,id:"minecraft:golden_apple",count:2}`,
    ];
    await c.world.run(`data modify block ${chestAt} Items set value [${items.join(",")}]`);
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
    const bread = await c.world.count(c.bot, "bread");
    const beef = await c.world.count(c.bot, "cooked_beef");
    c.check(beef === 3, `carries all 3 cooked beef (${beef})`);
    c.check(bread === 4, `carries 4 bread, enough for about 40 points (${bread})`);
    c.check((await c.world.chestCount(chest, "bread")) === 2, "2 bread left in the chest");
    c.check((await c.world.chestCount(chest, "cooked_beef")) === 0, "no cooked beef left in the chest");
    c.check((await c.world.chestCount(chest, "rotten_flesh")) === 5, "rotten flesh all still in the chest");
    c.check((await c.world.chestCount(chest, "golden_apple")) === 2, "golden apples still in the chest");
    c.check((await c.world.count(c.bot, "rotten_flesh")) === 0 && (await c.world.count(c.bot, "golden_apple")) === 0, "neither carried");
  },
  cleanup,
};

export default [eatsTheBread(), onlyFlesh(), duringTask(), restock];
