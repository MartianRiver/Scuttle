// Give: the body walks to a player and throws items at them. A second offline bot, Ward, is the
// recipient and stands well outside the reach it throws from, so the walk is part of the test.
// Facts from the server: item counts in each inventory, plus the body's own events. A thrown stack
// lands wherever it lands and the Ward bot does not walk, so once the body says it is done the item
// entities near the Ward are moved onto it, which is what a kid walking over to pick them up does.
import { arena, C, leave } from "./arena";
import { sleep, type BodyEvent, type Ctx, type Scenario } from "./lib";
import { WardBot } from "./ward";

const WARD = "Ward";
const wardSpot = `${C.x + 15 + 0.5} ${C.y} ${C.z + 4 + 0.5}`;
const LOG = "oak_log";

interface Opts {
  setup?(c: Ctx): Promise<void>;
  run(c: Ctx): Promise<void>;
  verify(c: Ctx): void | Promise<void>;
}

// the reply and the terminal event of one give intent
async function give(c: Ctx, intent: object, ms: number): Promise<{ reply: string; end: BodyEvent | null }> {
  const mark = c.body.mark();
  let reply = "";
  // the Ward may not have loaded for the body yet
  for (let i = 0; i < 6; i++) {
    const r = await c.body.send({ intent: "give", player: WARD, ...intent });
    reply = r.type === "rejected" ? `rejected ${r.reason}` : r.type;
    if (r.type !== "rejected" || r.reason !== "unknown_player") break;
    await sleep(1000);
  }
  if (reply !== "accepted") return { reply, end: null };
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const e = c.body.events.slice(mark).find((ev) => ev.event === "task_finished" || ev.event === "task_failed");
    if (e) return { reply, end: e };
  }
  return { reply, end: null };
}

// what a thrown stack leaves on the ground goes to the Ward, as a player walking over would pick it up
const collectAtWard = (c: Ctx) => c.world.run(`tp @e[type=item,x=${C.x},y=${C.y},z=${C.z},distance=..60] ${WARD}`);

function scenario(name: string, o: Opts): Scenario {
  const ward = new WardBot(WARD);
  return {
    name,
    timeoutMs: 60_000,
    async setup(c) {
      await arena(c);
      await ward.join();
      await c.world.run(`gamemode survival ${WARD}`);
      await c.world.run(`clear ${WARD}`);
      await c.world.run(`tp ${WARD} ${wardSpot}`);
      await o.setup?.(c);
      await sleep(1500); // the body has to have the Ward in view
    },
    act: (c) => o.run(c),
    async verify(c) {
      await o.verify(c);
    },
    async cleanup(c) {
      // a player's inventory is saved when they quit, and the next scenario's Ward must start empty
      await c.world.run(`clear ${WARD}`).catch(() => {});
      await ward.quit();
      await c.world.run(`clear ${c.bot}`);
      await leave(c);
    },
  };
}

export default [
  (() => {
    let result: Awaited<ReturnType<typeof give>> | null = null;
    let wardHas = 0;
    let botHas = 0;
    return scenario("give: 12 of 20 logs reach a player 15 blocks away, 8 stay", {
      async setup(c) {
        await c.world.run(`give ${c.bot} ${LOG} 20`);
      },
      async run(c) {
        result = await give(c, { item: LOG, count: 12 }, 30_000);
        await collectAtWard(c);
        for (let i = 0; i < 20 && (wardHas = await c.world.count(WARD, LOG)) < 12; i++) await sleep(500);
        botHas = await c.world.count(c.bot, LOG);
      },
      verify(c) {
        c.check(result?.reply === "accepted", `the give was accepted (got ${result?.reply})`);
        c.check(result?.end?.event === "task_finished", `task_finished within 30 s (got ${result?.end?.event ?? "nothing"} ${result?.end?.reason ?? ""})`);
        c.check(wardHas === 12, `the Ward holds 12 ${LOG} (holds ${wardHas})`);
        c.check(botHas === 8, `the body kept 8 ${LOG} (kept ${botHas})`);
      },
    });
  })(),

  (() => {
    let result: Awaited<ReturnType<typeof give>> | null = null;
    return scenario("give: an item it does not hold ends none_held", {
      async setup(c) {
        await c.world.run(`give ${c.bot} ${LOG} 5`);
      },
      async run(c) {
        result = await give(c, { item: "diamond", count: 3 }, 10_000);
      },
      verify(c) {
        c.check(result?.reply === "accepted", `the give was accepted (got ${result?.reply})`);
        c.check(result?.end?.event === "task_failed", `task_failed (got ${result?.end?.event ?? "nothing"})`);
        c.check(result?.end?.reason === "none_held", `the reason was none_held (got ${result?.end?.reason})`);
      },
    });
  })(),

  (() => {
    let result: Awaited<ReturnType<typeof give>> | null = null;
    let wardHas = 0;
    let swords = 0;
    return scenario("give: it will not throw the sword in its hand", {
      async setup(c) {
        // the held slot, whichever hotbar slot is selected
        await c.world.run(`item replace entity ${c.bot} weapon.mainhand with minecraft:iron_sword`);
      },
      async run(c) {
        result = await give(c, { item: "iron_sword", count: 1 }, 10_000);
        await collectAtWard(c);
        await sleep(2500);
        wardHas = await c.world.count(WARD, "iron_sword");
        swords = await c.world.count(c.bot, "iron_sword");
      },
      verify(c) {
        c.check(result?.reply === "accepted", `the give was accepted (got ${result?.reply})`);
        c.check(result?.end?.event === "task_failed", `task_failed (got ${result?.end?.event ?? "nothing"})`);
        c.check(result?.end?.reason === "none_held", `the reason was none_held (got ${result?.end?.reason})`);
        c.check(wardHas === 0, `the Ward got no sword (holds ${wardHas})`);
        c.check(swords === 1, `the body still has its sword (has ${swords})`);
      },
    });
  })(),
] satisfies Scenario[];
