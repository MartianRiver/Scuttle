// The hands that set things down, from a frozen checkpoint: nothing in the pack but what the scenario gives, day, no
// table near, a flat platform far from home that a WorldGuard region of its own lets the bot build on. Facts come from the
// server: which blocks are in the world, what the pack and the chest hold. Everything it sets down is cleared again, and
// anything that changes what the bot remembers (the base file) is removed and the bot restarted.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDir } from "../slot";
import { restartBot, sleep, type BodyEvent, type Ctx, type Observation, type Pos, type Scenario } from "./lib";

export const S = { x: 215, y: 67, z: 215 }; // the bot's cell; the platform floor is y 66
const FAR = { x: 315, y: 67, z: 215 }; // a second small platform a hundred blocks east, for the leash
export const AT = `${S.x + 0.5} ${S.y} ${S.z + 0.5} 270 0`; // facing east
const REGIONS = path.join(runDir, "plugins", "WorldGuard", "worlds", "world", "regions.yml");
const SITE_REGION = "scuttle-site";
const BASE_FILE = path.join(process.cwd(), ".auth-cache");

const offlineUuid = (name: string): string => {
  const b = createHash("md5").update(`OfflinePlayer:${name}`).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// a region the bot may build in around the site, appended to the regions file and loaded; takeRegion puts the file back
async function giveRegion(c: Ctx): Promise<void> {
  const text = readFileSync(REGIONS, "utf8");
  if (text.includes(SITE_REGION)) return;
  writeFileSync(
    REGIONS,
    `${text.trimEnd()}\n    ${SITE_REGION}:\n        min: {x: 190, y: 40, z: 190}\n        max: {x: 340, y: 110, z: 240}\n        members:\n            unique-ids:\n            - ${offlineUuid(c.bot)}\n        flags: {}\n        owners: {}\n        type: cuboid\n        priority: 1\n`
  );
  await c.world.run("rg load -w world");
}

async function takeRegion(c: Ctx): Promise<void> {
  const text = readFileSync(REGIONS, "utf8");
  const at = text.indexOf(`    ${SITE_REGION}:`);
  if (at < 0) return;
  writeFileSync(REGIONS, text.slice(0, at));
  await c.world.run("rg load -w world");
}

async function platform(c: Ctx, at: Pos, half: number): Promise<void> {
  const w = c.world;
  await w.run(`forceload add ${at.x - 25} ${at.z - 25} ${at.x + 25} ${at.z + 25}`);
  await w.run(`fill ${at.x - half} 66 ${at.z - half} ${at.x + half} 66 ${at.z + half} grass_block`);
  await w.run(`fill ${at.x - half} 67 ${at.z - half} ${at.x + half} 80 ${at.z + half} air`);
}

// the frozen start: bare pack plus `give`, day, nothing set down near, facing east
export async function checkpoint(c: Ctx, give: string[] = [], region = true): Promise<void> {
  const w = c.world;
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  if (region) await giveRegion(c);
  await platform(c, S, 20);
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await w.run(`effect give ${c.bot} minecraft:saturation 5 10 true`);
  await w.run("time set day");
  await w.run("weather clear");
  await w.run(`tp ${c.bot} ${AT}`);
  await sleep(2500);
  for (const g of give) await w.run(`give ${c.bot} ${g}`);
  await sleep(500);
}

export async function tidy(c: Ctx, restart = false): Promise<void> {
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  await c.world.run("time set day");
  await c.world.run(`fill ${S.x - 20} 67 ${S.z - 20} ${S.x + 20} 80 ${S.z + 20} air`);
  await c.world.run(`fill ${FAR.x - 3} 67 ${FAR.z - 3} ${FAR.x + 3} 80 ${FAR.z + 3} air`);
  await c.world.run(`kill @e[type=item,x=${S.x},y=${S.y},z=${S.z},distance=..40]`);
  await c.world.run(`clear ${c.bot}`);
  for (const f of [`base-${c.bot}.json`]) if (existsSync(path.join(BASE_FILE, f))) rmSync(path.join(BASE_FILE, f));
  await takeRegion(c);
  if (restart) await restartBot(c);
  await c.world.run(`tp ${c.bot} 0.5 68 -10`);
}

export async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

export async function run(c: Ctx, intent: object, ms = 60_000): Promise<{ reply: string; end: BodyEvent | null }> {
  const from = c.body.mark();
  const r = await c.body.send(intent);
  if (r.type !== "accepted") return { reply: r.type === "rejected" ? `rejected ${r.reason}` : r.type, end: null };
  let end: BodyEvent | undefined;
  for (const stop = Date.now() + ms; !end && Date.now() < stop; await sleep(100)) {
    end = c.body.events.slice(from).find((e) => e.taskId === r.taskId && ["task_finished", "task_failed", "task_stopped"].includes(e.event));
  }
  await sleep(400);
  return { reply: "accepted", end: end ?? null };
}

export const said = (e: BodyEvent | null) => `${e?.event ?? "no end"} ${e?.reason ?? ""} ${e?.detail ?? ""}`.trim();
export const finished = (e: BodyEvent | null) => e?.event === "task_finished";

// the cells within two of the bot's start that hold a block of that kind
export async function findAround(c: Ctx, block: string): Promise<Pos[]> {
  const cells = c.world.cells({ x: S.x - 2, y: S.y, z: S.z - 2 }, { x: S.x + 2, y: S.y + 1, z: S.z + 2 });
  const hits = await Promise.all(cells.map((p) => c.world.blockIs(p, block)));
  return cells.filter((_, i) => hits[i]);
}

// the starting facts every scenario here asserts before it acts
export async function startsBare(c: Ctx, held: Record<string, number>): Promise<void> {
  for (const [item, n] of Object.entries(held)) c.check((await c.world.count(c.bot, item)) === n, `starts with ${n} ${item}`);
  c.check((await findAround(c, "crafting_table")).length === 0, "no table within reach to start with");
  const [x, y, z] = await c.world.pos(c.bot);
  c.check(Math.abs(x - (S.x + 0.5)) < 1.5 && Math.abs(z - (S.z + 0.5)) < 1.5 && y >= S.y - 0.1, `at the site (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
}

const tableBeside: Scenario = {
  name: "place: a crafting table goes down beside it, and the body is told where in words",
  timeoutMs: 90_000,
  setup: (c) => checkpoint(c, ["crafting_table 1"]),
  async act(c) {
    await startsBare(c, { crafting_table: 1 });
    const r = await run(c, { intent: "place", item: "crafting_table" });
    c.check(r.reply === "accepted" && finished(r.end), `place ends finished (${r.reply}, ${said(r.end)})`);
    c.check(r.end?.detail === "a crafting table beside it", `the words say what and where (${r.end?.detail})`);
  },
  async verify(c) {
    const tables = await findAround(c, "crafting_table");
    c.check(tables.length === 1, `one table in the world beside it (${tables.length})`);
    c.check(tables.every((p) => Math.abs(p.x - S.x) <= 1 && Math.abs(p.z - S.z) <= 1), "and it is adjacent");
    c.check((await c.world.count(c.bot, "crafting_table")) === 0, "the pack no longer has one");
    const o = await observe(c);
    c.check(o.blocks.some((b) => b.what === "your crafting table"), `observe lists it as its own (${o.blocks.map((b) => b.what).join(", ")})`);
    c.check(!JSON.stringify({ ...o, pos: undefined }).match(/-?\d{3,}/), "and no coordinate came with it beyond the body's own cell");
    const none = await run(c, { intent: "place", item: "furnace" });
    c.check(none.end?.reason === "none_held", `a furnace it does not hold (${said(none.end)})`);
    await c.world.run(`give ${c.bot} tnt 1`);
    const tnt = await run(c, { intent: "place", item: "tnt" });
    c.check(tnt.end?.reason === "not_allowed", `tnt is not on the list even held (${said(tnt.end)})`);
  },
  cleanup: (c) => tidy(c),
};

const fieldCraft: Scenario = {
  name: "place: craft with a table it carries: set down, used, picked back up",
  timeoutMs: 180_000,
  setup: (c) => checkpoint(c, ["oak_log 4"]),
  async act(c) {
    await startsBare(c, { oak_log: 4 });
    for (const [item, count] of [["oak_planks", 16], ["crafting_table", 1], ["stick", 4]] as const) {
      const r = await run(c, { intent: "craft", item, count });
      c.check(finished(r.end), `craft ${item}: ${said(r.end)}`);
    }
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "a table in the pack");
    const from = c.body.mark();
    const r = await run(c, { intent: "craft", item: "wooden_pickaxe" });
    c.check(finished(r.end), `craft wooden_pickaxe with no table near: ${said(r.end)}`);
    const placed = c.body.events.slice(from).some((e) => e.event === "task_progress");
    c.check(placed || finished(r.end), "it ran like any craft");
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) === 1, "the pickaxe is in the pack");
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "the table is back in the pack");
    c.check((await findAround(c, "crafting_table")).length === 0, "and gone from the world");
  },
  cleanup: (c) => tidy(c),
};

const notYours: Scenario = {
  name: "place: pick_up refuses a table it did not place and takes up its own",
  timeoutMs: 120_000,
  setup: (c) => checkpoint(c, ["crafting_table 1"]),
  async act(c) {
    await startsBare(c, { crafting_table: 1 });
    // a table nobody here placed, three cells off, where the body has never put anything
    await c.world.run(`setblock ${S.x + 4} ${S.y} ${S.z + 4} crafting_table`);
    await sleep(800);
    const o = await observe(c);
    const kid = o.blocks.find((b) => b.what === "crafting_table");
    c.check(Boolean(kid), `observe shows a table that is not its own (${o.blocks.map((b) => b.what).join(", ")})`);
    if (!kid) return;
    const r = await run(c, { intent: "pick_up", handle: kid.h });
    c.check(r.end?.event === "task_failed" && r.end.reason === "not_yours", `a table it did not place ends not_yours (${said(r.end)})`);
    c.check(await c.world.blockIs({ x: S.x + 4, y: S.y, z: S.z + 4 }, "crafting_table"), "and the table is still there");
  },
  async verify(c) {
    // its own: placed by it, taken back by it
    const p = await run(c, { intent: "place", item: "crafting_table", where: "ahead" });
    c.check(finished(p.end), `place ahead: ${said(p.end)}`);
    const o = await observe(c);
    const mine = o.blocks.find((b) => b.what === "your crafting table");
    c.check(Boolean(mine), "it lists its own table");
    if (!mine) return;
    const r = await run(c, { intent: "pick_up", handle: mine.h });
    c.check(finished(r.end), `pick_up of its own table: ${said(r.end)}`);
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "the table is in the pack again");
    c.check(!(await c.world.blockIs({ x: S.x + 1, y: S.y, z: S.z }, "crafting_table")), "and gone from where it stood");
    const gone = await run(c, { intent: "pick_up", handle: mine.h });
    c.check(gone.reply === "rejected stale_handle" || gone.end?.reason === "stale_handle", `its handle is stale now (${gone.reply} ${said(gone.end)})`);
  },
  cleanup: (c) => tidy(c),
};

const nearHouse: Scenario = {
  name: "place: refuses beside what a player built, in words with a next step",
  timeoutMs: 90_000,
  setup: (c) => checkpoint(c, ["crafting_table 1"]),
  async act(c) {
    await startsBare(c, { crafting_table: 1 });
    // a wall of planks two cells east: every cell it could use is within the made radius
    await c.world.run(`fill ${S.x + 2} ${S.y} ${S.z - 2} ${S.x + 2} ${S.y + 3} ${S.z + 2} oak_planks`);
    await sleep(500);
    c.check(await c.world.blockIs({ x: S.x + 2, y: S.y, z: S.z }, "oak_planks"), "the wall is up");
    const r = await run(c, { intent: "place", item: "crafting_table" });
    c.check(r.end?.event === "task_failed" && r.end.reason === "refused", `refused (${said(r.end)})`);
    c.check(/player built/.test(String(r.end?.detail)), `with the words for it (${r.end?.detail})`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "it still holds the table");
    c.check((await findAround(c, "crafting_table")).length === 0, "nothing was set down");
  },
  cleanup: (c) => tidy(c),
};

const ownChest: Scenario = {
  name: "place: its own chest takes a store and gives it back, and observe says what is in it",
  timeoutMs: 120_000,
  setup: (c) => checkpoint(c, ["chest 1", "oak_log 8"]),
  async act(c) {
    await startsBare(c, { chest: 1, oak_log: 8 });
    const p = await run(c, { intent: "place", item: "chest", where: "ahead" });
    c.check(finished(p.end), `place chest: ${said(p.end)}`);
    const spot = { x: S.x + 1, y: S.y, z: S.z };
    c.check(await c.world.blockIs(spot, "chest"), "the chest is ahead of it");
    const s = await run(c, { intent: "store", item: "oak_log" });
    c.check(finished(s.end), `store with no chest named: ${said(s.end)}`);
    c.check((await c.world.chestCount(spot, "oak_log")) === 8, "all eight logs are in its chest");
    c.check((await c.world.count(c.bot, "oak_log")) === 0, "none left in the pack");
    const o = await observe(c);
    const chest = o.blocks.find((b) => b.what === "your chest");
    c.check(Boolean(chest) && /oak_log 8/.test(String((chest as Record<string, unknown>)?.has)), `observe says what it holds (${JSON.stringify(chest)})`);
    const stash = (await c.body.send({ intent: "stash" })).stash;
    c.check((stash?.items.oak_log ?? 0) >= 8, `and stash counts it (${JSON.stringify(stash?.items)})`);
    const t = await run(c, { intent: "take", item: "oak_log", count: 5, chest: chest?.h });
    c.check(finished(t.end), `take from it by handle: ${said(t.end)}`);
  },
  async verify(c) {
    const spot = { x: S.x + 1, y: S.y, z: S.z };
    c.check((await c.world.count(c.bot, "oak_log")) === 5, "five logs back in the pack");
    c.check((await c.world.chestCount(spot, "oak_log")) === 3, "three still in the chest");
    // a chest it did not place is not its own
    await c.world.run(`setblock ${S.x + 4} ${S.y} ${S.z + 4} chest`);
    await sleep(800);
    const o = await observe(c);
    const other = o.blocks.find((b) => b.what === "chest");
    c.check(Boolean(other), "another chest is in view");
    if (other) {
      const r = await run(c, { intent: "store", item: "oak_log", chest: other.h });
      c.check(r.end?.reason === "not_yours", `store into a chest that is not its own: ${said(r.end)}`);
      c.check((await c.world.chestCount({ x: S.x + 4, y: S.y, z: S.z + 4 }, "oak_log")) === 0, "nothing went into it");
    }
  },
  cleanup: (c) => tidy(c),
};

// bed, table and chest set down, the base made there: home moves, the leash and bedtime with it
const baseMade: Scenario = {
  name: "place: make_base away from home, go_to the base, bedtime takes it to the new bed, the leash is measured from it",
  timeoutMs: 420_000,
  async setup(c) {
    await checkpoint(c, ["oak_planks 16", "white_bed 1"]);
    await platform(c, FAR, 3);
  },
  async act(c) {
    await startsBare(c, { oak_planks: 16, white_bed: 1 });
    const refused = await run(c, { intent: "make_base" });
    c.check(refused.end?.reason === "not_ready", `nothing of its own yet is not_ready (${said(refused.end)})`);
    const table = await run(c, { intent: "craft", item: "crafting_table" });
    c.check(finished(table.end), `craft a table: ${said(table.end)}`);
    for (const item of ["crafting_table", "white_bed"]) {
      const r = await run(c, { intent: "place", item, where: "here" });
      c.check(finished(r.end), `place ${item}: ${said(r.end)}`);
    }
    const chest = await run(c, { intent: "craft", item: "chest" });
    c.check(finished(chest.end), `craft a chest at its own table: ${said(chest.end)}`);
    const put = await run(c, { intent: "place", item: "chest", where: "here" });
    c.check(finished(put.end), `place chest: ${said(put.end)}`);
    const made = await run(c, { intent: "make_base" });
    c.check(finished(made.end) && made.end?.detail === "this is its base now", `make_base: ${said(made.end)}`);
    const o = await observe(c);
    c.check(/^your base/.test(o.places?.home ?? ""), `home reads your base (${o.places?.home})`);
    c.check(/^here/.test(o.places?.bed ?? "") || /^close/.test(o.places?.bed ?? ""), `and the bed place is the new one (${o.places?.bed})`);
  },
  async verify(c) {
    // the leash: measured from the new base. A hundred blocks east, away from it, is too far; walking back toward it is not
    await c.world.run(`tp ${c.bot} ${FAR.x + 0.5} ${FAR.y} ${FAR.z + 0.5}`);
    await sleep(2500);
    const out = await c.body.send({ intent: "explore", dir: "east", far: "far" });
    c.check(out.type === "rejected" && out.reason === "too_far", `east from there is past the leash (${out.type} ${out.reason ?? ""})`);
    const back = await c.body.send({ intent: "explore", dir: "west", far: "far" });
    c.check(back.type === "accepted", `west toward the base is within it, though the old home is a long way off (${back.type} ${back.reason ?? ""})`);
    await c.body.send({ intent: "stop" });
    await sleep(1500);

    // back on the site: go_to home walks to the new bed
    await c.world.run(`tp ${c.bot} ${S.x + 14.5} ${S.y} ${S.z + 0.5}`);
    await sleep(2500);
    const g = await run(c, { intent: "go_to", handle: "home" }, 60_000);
    c.check(finished(g.end), `go_to home: ${said(g.end)}`);
    const [x, , z] = await c.world.pos(c.bot);
    c.check(Math.hypot(x - (S.x + 0.5), z - (S.z + 0.5)) < 8, `it is at the new base (${x.toFixed(0)}, ${z.toFixed(0)})`);

    const from = c.body.mark();
    await c.world.run("time set 13000");
    const slept = await c.body.waitEvent("sleeping", from, 70_000);
    c.check(slept !== null, "a sleeping event at dusk");
    let theirs = false;
    for (const p of c.world.cells({ x: S.x - 2, y: S.y, z: S.z - 2 }, { x: S.x + 2, y: S.y, z: S.z + 2 })) {
      if (await c.world.passes(`execute if block ${p.x} ${p.y} ${p.z} #minecraft:beds[occupied=true]`)) theirs = true;
    }
    c.check(theirs, "the bed it set down is the one occupied");
    c.check(!(await c.world.passes("execute if block 4 68 -28 #minecraft:beds[occupied=true]")), "and the old home bed is not");
    const woke = c.body.mark();
    await c.world.run("time set day");
    c.check((await c.body.waitEvent("woke", woke, 20_000)) !== null, "it wakes in the morning");
  },
  cleanup: async (c) => {
    await c.world.run("time set day");
    await sleep(2000);
    await tidy(c, true);
  },
};

const afterRestart: Scenario = {
  name: "place: what it placed is still its own after a bot restart",
  timeoutMs: 240_000,
  setup: (c) => checkpoint(c, ["crafting_table 1"]),
  async act(c) {
    await startsBare(c, { crafting_table: 1 });
    const p = await run(c, { intent: "place", item: "crafting_table", where: "ahead" });
    c.check(finished(p.end), `place: ${said(p.end)}`);
    await restartBot(c);
    await sleep(4000);
  },
  async verify(c) {
    const o = await observe(c);
    const mine = o.blocks.find((b) => b.what === "your crafting table");
    c.check(Boolean(mine), `after the restart the table still reads as its own (${o.blocks.map((b) => b.what).join(", ")})`);
    if (!mine) return;
    const r = await run(c, { intent: "pick_up", handle: mine.h });
    c.check(finished(r.end), `pick_up after a restart: ${said(r.end)}`);
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "the table is in the pack");
  },
  cleanup: (c) => tidy(c),
};

// no region of its own here, so the server's build deny undoes the block; kept last because the undone place is
// remembered for the bot's life, so it restarts the bot after
const undone: Scenario = {
  name: "place: where the server undoes it the place ends protected",
  timeoutMs: 180_000,
  setup: (c) => checkpoint(c, ["crafting_table 1"], false),
  async act(c) {
    await startsBare(c, { crafting_table: 1 });
    const r = await run(c, { intent: "place", item: "crafting_table", where: "ahead" }, 90_000);
    c.check(r.end?.event === "task_failed" && r.end.reason === "protected", `protected (${said(r.end)})`);
  },
  async verify(c) {
    c.check((await findAround(c, "crafting_table")).length === 0, "no table stayed in the world");
    c.check((await c.world.count(c.bot, "crafting_table")) === 1, "and it still holds it");
    const o = await observe(c);
    c.check((o.refused?.length ?? 0) > 0, "the place is remembered as one where its work was undone");
  },
  cleanup: (c) => tidy(c, true),
};

export default [tableBeside, fieldCraft, notYours, nearHouse, ownChest, baseMade, afterRestart, undone];
