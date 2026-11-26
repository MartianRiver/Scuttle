// Upkeep underground: the torch events, a column of gravel brought down safely (and refused when water or lava is near
// it), and `ensure` restoring a kit from the chest beside it. Same column, region and kit as strip.scenario.ts; each starts
// from the frozen checkpoint, then works in a room cut into the stone at y 30 (as strip's worn-pickaxe scenario does).
// Facts come from the server; what the body says is checked against them.
import { go, said } from "./handsb.scenario";
import { checkpoint, events, feet, tidy, words, X0, Z0 } from "./strip.scenario";
import { sleep, type BodyEvent, type Ctx, type Pos, type Scenario } from "./lib";

const Y = 30; // the floor of the room and of the tunnel
const ROOM = `${X0 - 1} ${Y} ${Z0 - 1} ${X0 + 3} ${Y + 1} ${Z0 + 1}`;

// the room the body starts in, sealed in stone: no way to the surface, so it counts as underground
async function room(c: Ctx): Promise<void> {
  await c.world.run(`fill ${X0 - 1} ${Y} ${Z0 - 1} ${X0 + 40} ${Y + 2} ${Z0 + 1} stone`);
  await c.world.run(`fill ${ROOM} air`);
  await c.world.run(`tp ${c.bot} ${X0}.5 ${Y} ${Z0}.5 270 0`);
  await sleep(2500);
}

const at = (p: Pos) => `${p.x} ${p.y} ${p.z}`;

// ---- the torch events ----

const torches: Scenario = (() => {
  let surface = 0;
  let quiet = 0;
  let low1: BodyEvent[] = [];
  let out: BodyEvent[] = [];
  let low2: BodyEvent[] = [];
  let all: BodyEvent[] = [];
  return {
    name: "upkeep: torches_low at three and torches_out at none, only underground, once an episode, and again after it carries more",
    timeoutMs: 120_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["bread 4"], 440);
    },
    async act(c) {
      const mark = c.body.mark();
      await sleep(3500); // on the grass with no torch: nothing to say
      surface = events(c, mark, "torches_out").length + events(c, mark, "torches_low").length;
      await c.world.run(`give ${c.bot} torch 8`); // before it goes down: with none, the room alone would say torches_out
      await room(c);
      await sleep(3000);
      quiet = events(c, mark, "torches_out").length + events(c, mark, "torches_low").length;
      await c.world.run(`clear ${c.bot} minecraft:torch 5`);
      await sleep(3000);
      low1 = events(c, mark, "torches_low");
      await c.world.run(`clear ${c.bot} minecraft:torch`);
      await sleep(3000);
      out = events(c, mark, "torches_out");
      await c.world.run(`give ${c.bot} torch 2`);
      await sleep(3000);
      low2 = events(c, mark, "torches_low");
      all = c.body.events.slice(mark).filter((e) => e.event === "torches_low" || e.event === "torches_out");
    },
    async verify(c) {
      c.check(surface === 0, `none on the surface with no torch (${surface})`);
      c.check(quiet === 0, `none underground with eight (${quiet})`);
      c.check(low1.length === 1 && low1[0].left === 3, `three left underground: one torches_low with left 3 (${JSON.stringify(low1.map((e) => e.left))})`);
      c.check(out.length === 1 && out[0].left === 0, `none left: one torches_out with left 0 (${JSON.stringify(out.map((e) => e.left))})`);
      c.check(low2.length === 2 && low2[1].left === 2, `carrying more than it did when told ends the episode, so two left is a torches_low again (${JSON.stringify(low2.map((e) => e.left))})`);
      c.check(all.map((e) => e.event).join(",") === "torches_low,torches_out,torches_low", `in that order, each once (${all.map((e) => e.event).join(",")})`);
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
})();

// ---- gravel overhead ----

const gravelCol = () => [Y + 2, Y + 3]; // over the head cell of the tunnel at x: the column the body must bring down

function tunnelUnder(name: string, plant: (c: Ctx, x: number) => Promise<void>, expect: "cleared" | RegExp): Scenario {
  const X = X0 + 8;
  let end: BodyEvent | null = null;
  let at1: Pos = { x: 0, y: 0, z: 0 };
  let health = 0;
  let gravel: boolean[] = [];
  let flint = 0;
  return {
    name,
    timeoutMs: 300_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe 1", "bread 4"], 440);
      await room(c);
      await plant(c, X);
    },
    async act(c) {
      end = (await go(c, { intent: "tunnel", dir: "east", length: 14 }, 240_000)).end;
      await sleep(1500);
      at1 = await feet(c);
      health = await c.world.health(c.bot);
      gravel = await Promise.all(gravelCol().map((y) => c.world.blockIs({ x: X, y, z: Z0 }, "gravel")));
      flint = (await c.world.count(c.bot, "gravel")) + (await c.world.count(c.bot, "flint"));
    },
    async verify(c) {
      c.check(health >= 19, `unhurt, so it never stood under a falling block (${health})`);
      if (expect === "cleared") {
        c.check(end?.event === "task_finished", `the tunnel finished past the gravel (${said(end)})`);
        c.check(at1.x >= X + 3, `and went on past it (x ${at1.x}, the column at ${X})`);
        c.check(gravel.every((g) => !g), `no gravel is left in the column (${JSON.stringify(gravel)})`);
        c.check(flint >= 1, `the gravel it broke is in the pack (${flint})`);
      } else {
        c.check(end?.event === "task_failed" && end.reason === "blocked", `it stops blocked (${said(end)})`);
        c.check(expect.test(String(end?.detail ?? "")) && words(end?.detail), `and says why, in words (${end?.detail})`);
        c.check(at1.x < X, `before the column (x ${at1.x}, the column at ${X})`);
        c.check(gravel.every((g) => g), `the gravel is untouched (${JSON.stringify(gravel)})`);
        c.check(flint === 0, `nothing was picked up (${flint})`);
      }
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
}

const clears = tunnelUnder(
  "upkeep: a capped column of two gravel over the tunnel is brought down from beside it, broken block by block, and the tunnel goes on",
  async (c, x) => {
    for (const y of gravelCol()) await c.world.run(`setblock ${x} ${y} ${Z0} gravel`);
  },
  "cleared"
);

const lavaBeside = tunnelUnder(
  "upkeep: lava beside the gravel column refuses it, 'lava beside the sand or gravel', and nothing is dug under it",
  async (c, x) => {
    for (const y of gravelCol()) await c.world.run(`setblock ${x} ${y} ${Z0} gravel`);
    await c.world.run(`setblock ${x + 1} ${Y + 3} ${Z0} lava`); // inside the rock, two cells from anything the tunnel opens
  },
  /lava/
);

const waterAbove = tunnelUnder(
  "upkeep: water above the gravel column refuses it, 'water above the sand or gravel'",
  async (c, x) => {
    for (const y of gravelCol()) await c.world.run(`setblock ${x} ${y} ${Z0} gravel`);
    await c.world.run(`setblock ${x} ${Y + 4} ${Z0} water`);
  },
  /water/
);

// ---- ensure ----

const ensure: Scenario = (() => {
  let chestAt: Pos | null = null;
  let placed: BodyEvent | null = null;
  let kit: BodyEvent | null = null;
  let held = { stone: 0, torch: 0, bread: 0, iron: 0 };
  let more: BodyEvent | null = null;
  let torchesAfter = 0;
  let inChest = { stick: 0, torch: 0 };
  return {
    name: "upkeep: ensure kit takes a pickaxe, torches and food from the chest, crafts the second pickaxe, and ensure torches says what it still lacks",
    timeoutMs: 300_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe[damage=240] 1", "torch 2", "bread 3", "chest 1", "crafting_table 1"], 440);
      await room(c);
    },
    async act(c) {
      placed = (await go(c, { intent: "place", item: "chest", where: "here" }, 60_000)).end;
      const room_ = c.world.cells({ x: X0 - 1, y: Y, z: Z0 - 1 }, { x: X0 + 3, y: Y + 1, z: Z0 + 1 });
      const hits = await Promise.all(room_.map((p) => c.world.blockIs(p, "chest")));
      chestAt = room_.find((_, i) => hits[i]) ?? null;
      if (!chestAt) return;
      const slots = ["stone_pickaxe 1", "torch 20", "bread 13", "stick 8", "coal 4", "cobblestone 6"];
      for (let i = 0; i < slots.length; i++) await c.world.run(`item replace block ${at(chestAt)} container.${i} with ${slots[i]}`);
      await sleep(500);
      kit = (await go(c, { intent: "ensure", what: "kit" }, 120_000)).end;
      held = {
        stone: await c.world.count(c.bot, "stone_pickaxe"),
        torch: await c.world.count(c.bot, "torch"),
        bread: await c.world.count(c.bot, "bread"),
        iron: await c.world.count(c.bot, "iron_pickaxe"),
      };
      more = (await go(c, { intent: "ensure", what: "torches", count: 40 }, 120_000)).end;
      torchesAfter = await c.world.count(c.bot, "torch");
      inChest = { stick: await c.world.chestCount(chestAt, "stick"), torch: await c.world.chestCount(chestAt, "torch") };
    },
    async verify(c) {
      c.check(placed?.event === "task_finished" && !!chestAt, `its chest stands in the room (${said(placed)})`);
      c.check(kit?.event === "task_finished" && words(kit.detail), `ensure kit finishes, in words (${said(kit)})`);
      c.check(held.stone === 2, `two stone pickaxes: one from the chest, one crafted (${held.stone})`);
      c.check(held.iron === 1, `the worn iron one is still carried (${held.iron})`);
      c.check(held.torch === 16 && held.bread === 16, `torches and food up to sixteen (${held.torch} torches, ${held.bread} bread)`);
      c.check(more?.event === "task_failed" && more.reason === "missing" && !!more.missing, `ensure torches for forty is short and says what (${said(more)} ${JSON.stringify(more?.missing)})`);
      c.check(words(more?.detail) && /short of/.test(String(more?.detail ?? "")), `in words (${more?.detail})`);
      c.check(torchesAfter >= 36, `and it made what it could first (${torchesAfter})`);
      c.check(inChest.torch === 0 && inChest.stick >= 1, `the chest gave its torches and kept the last sticks (${JSON.stringify(inChest)})`);
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
})();

export default [torches, clears, lavaBeside, waterAbove, ensure];
