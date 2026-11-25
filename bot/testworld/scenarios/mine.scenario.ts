// The mine site: a permanent shaft the body walks, a landing kit at its foot, tasks measured from the landing, and undo.
// Depth scenarios start from a shaft cut by RCON `fill` (a real dig of it is minefull.manual.scenario.ts) plus a site file
// written beside the journal and a bot restart, which is also the check that the site survives one. Facts come from the
// server. The column is strip's: stone over deepslate over bedrock, far from home, under a region that lets the bot dig.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { go, said } from "./handsb.scenario";
import { checkpoint, events, feet, KIT, tidy, words, X0, Z0, TOP, AT } from "./strip.scenario";
import { restartBot, sleep, type BodyEvent, type Ctx, type Observation, type Pos, type Scenario } from "./lib";

const AUTH = path.join(process.cwd(), ".auth-cache");
const siteFile = (c: Ctx) => path.join(AUTH, `sites-${c.bot}.json`);
const cellAt = (i: number): Pos => ({ x: X0 + i, y: TOP - i, z: Z0 });

async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

// the stair strip's dig_down cuts, made by fill: column i has three open cells, its feet on TOP - i
async function preCut(c: Ctx, steps: number): Promise<void> {
  for (let i = 1; i <= steps; i++) await c.world.run(`fill ${X0 + i} ${TOP - i} ${Z0} ${X0 + i} ${TOP - i + 2} ${Z0} air`);
}

function writeSite(c: Ctx, steps: number, landing: boolean): void {
  const shaft = Array.from({ length: steps + 1 }, (_, i) => cellAt(i));
  const mine = { top: cellAt(0), facing: { dx: 1, dz: 0 }, shaft, landing: landing ? cellAt(steps) : null, kit: {} };
  writeFileSync(siteFile(c), JSON.stringify({ mine }));
}

// the shaft is cut, the file is written, and a restart loads it: what a body that dug it last week would have
async function withShaft(c: Ctx, give: string[], steps: number, landing = false, reach = 440): Promise<void> {
  await checkpoint(c, give, reach);
  await preCut(c, steps);
  writeSite(c, steps, landing);
  await restartBot(c);
  await c.world.run(`tp ${c.bot} ${AT}`);
  await sleep(2500);
}

async function forget(c: Ctx): Promise<void> {
  rmSync(siteFile(c), { force: true });
  await restartBot(c);
}

const at = (p: Pos) => `${p.x} ${p.y} ${p.z}`;
const near = (a: Pos, b: Pos, d: number) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= d;

// ---- walking a shaft that is already there ----

const walk: Scenario = (() => {
  const DEPTH = 120; // TOP to y -53: the stair crosses x 512 at y -45, where the body was rubber-banded until lib/physics-fix.ts (without it go_to shaft fails there, stuck)
  let before: Observation | null = null;
  let toMine: { reply: string; end: BodyEvent | null } | null = null;
  let down: BodyEvent | null = null;
  let foot: Pos = { x: 0, y: 0, z: 0 };
  let ahead = false;
  let up: BodyEvent | null = null;
  let top: Pos = { x: 0, y: 0, z: 0 };
  return {
    name: "mine: a shaft saved before a restart is a place after it, dig_shaft walks down it with no digging, and go_to shaft climbs the whole length",
    timeoutMs: 900_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await withShaft(c, KIT, DEPTH, false, 540);
    },
    async act(c) {
      before = await observe(c);
      toMine = await go(c, { intent: "go_to", handle: "mine" }, 10_000);
      down = (await go(c, { intent: "dig_shaft", to: TOP - DEPTH }, 600_000)).end;
      foot = await feet(c);
      ahead = !(await c.world.blockIs({ x: foot.x + 1, y: foot.y, z: foot.z }, "air"));
      up = (await go(c, { intent: "go_to", handle: "shaft" }, 600_000)).end;
      top = await feet(c);
    },
    async verify(c) {
      c.check(!!before?.places?.shaft && !before.places.mine, `the shaft is a place after the restart, the mine is not yet (${JSON.stringify(before?.places)})`);
      c.check(toMine?.reply === "rejected stale_handle", `go_to mine before there is a landing is refused (${toMine?.reply})`);
      c.check(down?.event === "task_finished" && /at the depth asked/.test(String(down.detail ?? "")), `dig_shaft finished at the depth asked (${said(down)})`);
      c.check(foot.y === TOP - DEPTH && foot.x === X0 + DEPTH && foot.z === Z0, `it stands at the foot of the shaft, a hundred steps down (${JSON.stringify(foot)})`);
      c.check(ahead, "nothing was dug: the rock ahead of the foot is still rock");
      c.check(up?.event === "task_finished", `go_to shaft finished (${said(up)})`);
      c.check(near(top, cellAt(0), 3), `and it is back at the top (${JSON.stringify(top)})`);
    },
    async cleanup(c) {
      await tidy(c);
      await forget(c);
    },
  };
})();

// ---- the landing kit ----

const KIT_ITEMS = ["iron_pickaxe 1", "chest 1", "crafting_table 1", "torch 16", "bread 4"];

const kit: Scenario = (() => {
  const DEPTH = 40;
  const foot = cellAt(DEPTH);
  const chestAt = { x: foot.x, y: foot.y, z: foot.z + 1 };
  const tableAt = { x: foot.x, y: foot.y, z: foot.z - 1 };
  const furnaceAt = { x: foot.x, y: foot.y + 1, z: foot.z - 1 };
  let lacking: { reply: string; end: BodyEvent | null } | null = null;
  let afterFirst = { chest: false, table: false, furnace: false };
  let at1: Pos = { x: 0, y: 0, z: 0 };
  let ready: BodyEvent | null = null;
  let afterSecond = { chest: false, table: false, furnace: false };
  let torchesIn = 0;
  let torchWall = 0;
  let carried = { before: 0, after: 0 };
  let took: BodyEvent | null = null;
  let o: Observation | null = null;
  let toTop: BodyEvent | null = null;
  let toMine: BodyEvent | null = null;
  let back: Pos = { x: 0, y: 0, z: 0 };
  let undoEnd: BodyEvent | null = null;
  let leftOver = { chest: false, table: true, furnace: true, torches: 0 };
  const blocks = async (c: Ctx) => ({ chest: await c.world.blockIs(chestAt, "chest"), table: await c.world.blockIs(tableAt, "crafting_table"), furnace: await c.world.blockIs(furnaceAt, "furnace") });
  return {
    name: "mine: make_mine sets a chest, table, furnace and torch at the foot, says what it lacks, stocks the chest, take reads it, and undo leaves a chest with things in it",
    timeoutMs: 600_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await withShaft(c, KIT_ITEMS, DEPTH);
    },
    async act(c) {
      // from the top, with no furnace: walks down, sets what it has, says what it lacks
      lacking = await go(c, { intent: "make_mine" }, 240_000);
      at1 = await feet(c);
      afterFirst = await blocks(c);
      await c.world.run(`give ${c.bot} furnace 1`);
      await sleep(500);
      ready = (await go(c, { intent: "make_mine" }, 120_000)).end;
      afterSecond = await blocks(c);
      torchesIn = await c.world.chestCount(chestAt, "torch");
      for (let dy = -1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (await c.world.blockIs({ x: foot.x + dx, y: foot.y + dy, z: foot.z + dz }, "wall_torch")) torchWall++;
      o = await observe(c);
      carried.before = await c.world.count(c.bot, "torch");
      took = (await go(c, { intent: "take", item: "torch", count: 3 }, 60_000)).end;
      carried.after = await c.world.count(c.bot, "torch");
      toTop = (await go(c, { intent: "go_to", handle: "shaft" }, 300_000)).end;
      toMine = (await go(c, { intent: "go_to", handle: "mine" }, 300_000)).end;
      back = await feet(c);
      // the kit went down across two calls, so it comes up in two: the second call's furnace and torch, then the first's
      await go(c, { intent: "undo", job: "make_mine" }, 120_000);
      undoEnd = (await go(c, { intent: "undo", job: "make_mine" }, 120_000)).end;
      leftOver = { ...(await blocks(c)), torches: await c.world.chestCount(chestAt, "torch") };
    },
    async verify(c) {
      const first = lacking?.end;
      c.check(first?.event === "task_failed" && first.reason === "not_ready" && /furnace/.test(String(first.detail ?? "")) && words(first.detail), `without a furnace it says so, in words (${said(first ?? null)})`);
      c.check(first?.missing && (first.missing as Record<string, number>).furnace === 1, `and names it in missing (${JSON.stringify(first?.missing)})`);
      c.check(near(at1, foot, 1), `it walked down to the foot to do it (${JSON.stringify(at1)})`);
      c.check(afterFirst.chest && afterFirst.table && !afterFirst.furnace, `the chest and table are down, the furnace is not (${JSON.stringify(afterFirst)})`);
      c.check(ready?.event === "task_finished" && /landing is ready/.test(String(ready.detail ?? "")), `asked again with a furnace it finishes (${said(ready)})`);
      c.check(afterSecond.chest && afterSecond.table && afterSecond.furnace, `chest, table and furnace stand beside the foot, the furnace on the table (${JSON.stringify(afterSecond)})`);
      c.check(torchWall >= 1, `a torch is on a wall at the landing (${torchWall})`);
      c.check(torchesIn >= 6 && torchesIn <= 8, `half of its torches went into the chest (${torchesIn})`);
      c.check(!!o?.places?.mine, `go_to mine is a place now (${JSON.stringify(o?.places)})`);
      c.check(!!o?.blocks.find((b) => b.what === "your chest"), `the landing chest is its own, with a handle (${(o?.blocks ?? []).map((b) => b.what).join(", ")})`);
      c.check(took?.event === "task_finished" && carried.after - carried.before === 3, `take got three torches from the landing chest, the nearest one (${said(took)}, ${carried.before} to ${carried.after})`);
      c.check(toTop?.event === "task_finished" && toMine?.event === "task_finished", `it walks up the shaft and down again (${said(toTop)} / ${said(toMine)})`);
      c.check(near(back, foot, 3), `and is at the landing (${JSON.stringify(back)})`);
      c.check(undoEnd?.event === "task_finished" && /took up/.test(String(undoEnd.detail ?? "")) && /held things/.test(String(undoEnd.detail ?? "")) && words(undoEnd.detail), `undo takes the kit up and says the chest held things (${said(undoEnd)})`);
      c.check(leftOver.chest && !leftOver.table && !leftOver.furnace && leftOver.torches >= 3, `the chest stays with its torches, the table and furnace are gone (${JSON.stringify(leftOver)})`);
    },
    async cleanup(c) {
      await tidy(c);
      await forget(c);
    },
  };
})();

// ---- a task begun in the mine ----

const depth: Scenario = (() => {
  const DEPTH = 40;
  const foot = cellAt(DEPTH);
  let above: { reply: string; end: BodyEvent | null } | null = null;
  let below: { reply: string; end: BodyEvent | null } | null = null;
  let dig: BodyEvent | null = null;
  let cobble = 0;
  let y = 0;
  let ended: BodyEvent[] = [];
  return {
    name: "mine: explore's leash and get_stone's search are measured from the landing when begun in the mine, and dig_shaft is refused once there is a landing",
    timeoutMs: 400_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await withShaft(c, ["stone_pickaxe 1", "stone_sword 1", "bread 4"], DEPTH, true);
    },
    async act(c) {
      // 400 blocks from home on the surface: past the leash
      above = await go(c, { intent: "explore", dir: "east", far: "near" }, 5_000);
      await c.world.run(`tp ${c.bot} ${foot.x}.5 ${foot.y} ${foot.z}.5`);
      await sleep(2500);
      const r = await c.body.send({ intent: "explore", dir: "east", far: "near" });
      below = { reply: r.type === "rejected" ? `rejected ${r.reason}` : r.type, end: null };
      await c.body.send({ intent: "stop" });
      await sleep(1500);
      dig = (await go(c, { intent: "dig_shaft", to: -60 }, 20_000)).end;

      // stone is not offered at this depth to a get_stone aimed at home; aimed at the mine it digs the rock round the landing
      const mark = c.body.mark();
      const t = await c.body.send({ intent: "task", name: "get_stone", near: "mine" });
      for (let i = 0; i < 160 && t.type === "accepted"; i++) {
        cobble = await c.world.count(c.bot, "cobblestone");
        if (cobble >= 6) break;
        await sleep(1000);
      }
      y = (await feet(c)).y;
      await c.body.send({ intent: "stop" });
      await sleep(1500);
      ended = events(c, mark, "task_failed");
    },
    async verify(c) {
      c.check(above?.reply === "rejected too_far", `on the surface, 400 blocks from home, explore is too far (${above?.reply})`);
      c.check(below?.reply === "accepted", `in the mine the same order is inside the leash from the landing (${below?.reply})`);
      c.check(dig?.event === "task_failed" && dig.reason === "refused" && /landing/.test(String(dig.detail ?? "")) && words(dig.detail), `dig_shaft is refused once there is a landing (${said(dig)})`);
      c.check(cobble >= 6, `get_stone near the mine took stone below y 30 (${cobble} cobblestone)`);
      c.check(y <= 40, `and it was down in the mine while it did (y ${y})`);
      c.check(!ended.some((e) => e.reason === "no_stone"), `it did not say no_stone (${ended.map((e) => e.reason).join(", ")})`);
    },
    async cleanup(c) {
      await tidy(c);
      await forget(c);
    },
  };
})();

// ---- undo ----

const undo: Scenario = (() => {
  const cells = (): Pos[] => {
    // what dig_down to y 63 cuts through the dirt filled below: one in the first column, two, then three and three
    const out: Pos[] = [{ x: X0 + 1, y: 66, z: Z0 }];
    for (const [x, ys] of [[X0 + 2, [66, 65]], [X0 + 3, [66, 65, 64]], [X0 + 4, [65, 64, 63]]] as Array<[number, number[]]>) for (const y of ys) out.push({ x, y, z: Z0 });
    return out;
  };
  const changed: Pos = { x: X0 + 3, y: 65, z: Z0 };
  let dug: BodyEvent | null = null;
  let dirtHeld = 0;
  let openAfterDig = 0;
  let undoDig: BodyEvent | null = null;
  let restored = 0;
  let changedKept = false;
  let dirtLeft = 0;
  let refused: BodyEvent | null = null;
  let chestStays = false;
  let tookUp: BodyEvent | null = null;
  let tableUp: BodyEvent | null = null;
  let none: { reply: string; end: BodyEvent | null } | null = null;
  let items = { chest: 0, table: 0, bread: 0 };
  return {
    name: "mine: undo puts back dirt it dug and says what changed since, takes up what it placed, and leaves a chest with things in it",
    timeoutMs: 400_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe 1", "chest 1", "crafting_table 1", "bread 4"], 440);
      await c.world.run(`fill ${X0 + 1} 60 ${Z0} ${X0 + 4} 66 ${Z0} dirt`);
    },
    async act(c) {
      dug = (await go(c, { intent: "dig_down", to: 63 }, 120_000)).end;
      dirtHeld = await c.world.count(c.bot, "dirt");
      for (const p of cells()) if (await c.world.blockIs(p, "air")) openAfterDig++;
      await go(c, { intent: "climb_up" }, 120_000);
      await c.world.run(`setblock ${at(changed)} stone`);
      undoDig = (await go(c, { intent: "undo", job: "dig_down" }, 180_000)).end;
      for (const p of cells()) if (await c.world.blockIs(p, "dirt")) restored++;
      changedKept = await c.world.blockIs(changed, "stone");
      dirtLeft = await c.world.count(c.bot, "dirt");

      // placed things: the newest job first, a chest with bread in it stays
      await c.world.run(`tp ${c.bot} ${AT}`);
      await sleep(2000);
      await go(c, { intent: "place", item: "crafting_table" }, 60_000);
      await go(c, { intent: "place", item: "chest" }, 60_000);
      await go(c, { intent: "store", item: "bread" }, 60_000);
      refused = (await go(c, { intent: "undo", job: "place" }, 120_000)).end;
      chestStays = (await c.world.countBlocks({ x: X0 - 2, y: TOP, z: Z0 - 2 }, { x: X0 + 2, y: TOP, z: Z0 + 2 }, "chest")) === 1;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) await c.world.run(`execute if block ${X0 + dx} ${TOP} ${Z0 + dz} chest run data modify block ${X0 + dx} ${TOP} ${Z0 + dz} Items set value []`);
      tookUp = (await go(c, { intent: "undo", job: "place" }, 120_000)).end;
      tableUp = (await go(c, { intent: "undo", job: "place" }, 120_000)).end;
      const r = await go(c, { intent: "undo", job: "place" }, 20_000);
      none = { reply: r.reply, end: r.end };
      items = { chest: await c.world.count(c.bot, "chest"), table: await c.world.count(c.bot, "crafting_table"), bread: await c.world.count(c.bot, "bread") };
    },
    async verify(c) {
      c.check(dug?.event === "task_finished", `dig_down to y 63 finished (${said(dug)})`);
      c.check(dirtHeld >= 9 && openAfterDig === 9, `it dug nine cells of dirt and holds the dirt (${openAfterDig} open, ${dirtHeld} held)`);
      c.check(undoDig?.event === "task_finished" && /put back/.test(String(undoDig.detail ?? "")) && words(undoDig.detail), `undo finished and says what it did (${said(undoDig)})`);
      c.check(/changed since/.test(String(undoDig?.detail ?? "")), `and that a cell changed since (${undoDig?.detail})`);
      c.check(restored >= 6, `the dug cells are dirt again (${restored} of 9; one is the stone put there after)`);
      c.check(changedKept, "the cell that changed since is left as it was, not put back over");
      c.check(dirtLeft >= 1, `it put back dirt it carried, no more (${dirtLeft} left)`);
      c.check(refused?.event === "task_failed" && refused.reason === "nothing_undone" && /held things/.test(String(refused.detail ?? "")), `undo of a chest with bread in it is refused, never emptied (${said(refused)})`);
      c.check(chestStays, "the chest is still there");
      c.check(tookUp?.event === "task_finished" && /took up one/.test(String(tookUp.detail ?? "")), `once emptied the chest is taken up (${said(tookUp)})`);
      c.check(tableUp?.event === "task_finished" && /took up one/.test(String(tableUp.detail ?? "")), `and the older job's table after it (${said(tableUp)})`);
      // an older run's blocks far off are unloaded, so they stay "last" and it can only say it could not get at them
      c.check(none?.end?.event === "task_failed" && (none.end.reason === "nothing_to_undo" || (none.end.reason === "nothing_undone" && /could not get at/.test(String(none.end.detail ?? "")))), `then nothing of this run is left to undo (${said(none?.end ?? null)})`);
      c.check(items.chest === 1 && items.table === 1, `the chest and table are back in the pack (${JSON.stringify(items)})`);
    },
    async cleanup(c) {
      await tidy(c);
    },
  };
})();

// ---- undo of a dig through rock: the block is not what the dig gave ----

const rock: Scenario = (() => {
  const cells = (): Pos[] => {
    // what dig_down to y 63 cuts: grass on top, stone below
    const out: Pos[] = [{ x: X0 + 1, y: 66, z: Z0 }];
    for (const [x, ys] of [[X0 + 2, [66, 65]], [X0 + 3, [66, 65, 64]], [X0 + 4, [65, 64, 63]]] as Array<[number, number[]]>) for (const y of ys) out.push({ x, y, z: Z0 });
    return out;
  };
  let dug: BodyEvent | null = null;
  let none: BodyEvent | null = null;
  let undone: BodyEvent | null = null;
  let counts = { cobble: 0, dirt: 0, stone: 0, air: 0 };
  let held = { cobble: 0, dirt: 0 };
  return {
    name: "mine: undo of a dig through stone and grass puts back cobblestone and dirt, says when it carries none, and never sets stone down",
    timeoutMs: 400_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe 1"], 440);
    },
    async act(c) {
      dug = (await go(c, { intent: "dig_down", to: 63 }, 180_000)).end;
      await go(c, { intent: "climb_up" }, 120_000);
      await c.world.run(`clear ${c.bot} cobblestone`);
      await c.world.run(`clear ${c.bot} dirt`);
      none = (await go(c, { intent: "undo", job: "dig_down" }, 120_000)).end;
      await c.world.run(`give ${c.bot} cobblestone 20`);
      await c.world.run(`give ${c.bot} dirt 5`);
      await sleep(500);
      undone = (await go(c, { intent: "undo", job: "dig_down" }, 180_000)).end;
      for (const p of cells()) {
        if (await c.world.blockIs(p, "cobblestone")) counts.cobble++;
        else if (await c.world.blockIs(p, "dirt")) counts.dirt++;
        else if (await c.world.blockIs(p, "stone")) counts.stone++;
        else if (await c.world.blockIs(p, "air")) counts.air++;
      }
      held = { cobble: await c.world.count(c.bot, "cobblestone"), dirt: await c.world.count(c.bot, "dirt") };
    },
    async verify(c) {
      c.check(dug?.event === "task_finished", `dig_down to y 63 finished (${said(dug)})`);
      c.check(none?.event === "task_failed" && none.reason === "nothing_undone" && /none of what that block drops/.test(String(none.detail ?? "")) && words(none.detail), `carrying neither, undo says so in words (${said(none)})`);
      c.check(undone?.event === "task_finished" && /put back/.test(String(undone.detail ?? "")) && words(undone.detail), `once it carries them it puts back (${said(undone)})`);
      c.check(counts.cobble >= 5 && counts.dirt >= 2 && counts.stone === 0, `the stone cells are cobblestone, the grass cells dirt, and none is stone (${JSON.stringify(counts)})`);
      c.check(held.cobble + held.dirt <= 25 - 7, `what it set down came out of the pack (${JSON.stringify(held)})`);
    },
    async cleanup(c) {
      await tidy(c);
    },
  };
})();

// ---- take: the own chest beside it is looked at, whatever the memory says ----

const takeNear: Scenario = (() => {
  const DEPTH = 40;
  const foot = cellAt(DEPTH);
  const chestAt = { x: foot.x, y: foot.y, z: foot.z + 1 };
  let ready: BodyEvent | null = null;
  let took: BodyEvent | null = null;
  let after: Pos = { x: 0, y: 0, z: 0 };
  let bread = 0;
  return {
    name: "mine: take looks in the own chest beside it even when it was last seen without the item, and does not walk to the base",
    timeoutMs: 400_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await withShaft(c, [...KIT_ITEMS, "furnace 1"], DEPTH);
    },
    async act(c) {
      ready = (await go(c, { intent: "make_mine" }, 240_000)).end; // opens the chest to stock it, so the memory says: no bread
      await c.world.run(`item replace block ${at(chestAt)} container.20 with bread 3`);
      await sleep(500);
      took = (await go(c, { intent: "take", item: "bread", count: 3 }, 120_000)).end;
      after = await feet(c);
      bread = await c.world.count(c.bot, "bread");
    },
    async verify(c) {
      c.check(ready?.event === "task_finished", `make_mine finished (${said(ready)})`);
      c.check(took?.event === "task_finished", `take finished (${said(took)})`);
      c.check(near(after, foot, 6), `it stayed at the landing (${JSON.stringify(after)})`);
      c.check(bread >= 3, `and holds the bread (${bread})`);
    },
    async cleanup(c) {
      await tidy(c);
      await forget(c);
    },
  };
})();

export default [walk, kit, depth, undo, rock, takeNear];
