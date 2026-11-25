// `clear_trees` on a flat platform far from home: a base made with the real place and make_base, a small grove of
// grown-looking oak trees around it (built with fill, like get_wood's), a bare trunk and a trunk past the square as decoys,
// plants on the ground and items lying about. Facts come from the server: which blocks stand, what the pack and the chest hold.
// Everything set up is cleared again, the base file removed and the bot restarted (it keeps its base in memory).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDir } from "../slot";
import { restartBot, sleep, type BodyEvent, type Ctx, type Pos, type Scenario } from "./lib";

const S = { x: 215, y: 67, z: 215 }; // the bot's cell; the floor is y 66
const AT = `${S.x + 0.5} ${S.y} ${S.z + 0.5} 270 0`;
const REGIONS = path.join(runDir, "plugins", "WorldGuard", "worlds", "world", "regions.yml");
const SITE_REGION = "scuttle-clear";
const AUTH = path.join(process.cwd(), ".auth-cache");
const RADIUS = 11;

// offsets from the bot's cell: trunks inside the square, a bare trunk, a trunk past the square, plants, items
const TREES = [[-9, -6], [9, -5], [-8, 8], [7, 9]] as const;
const EDGE_TREE = [14, 0] as const; // 13 to 15 from the table: past the square, inside its edge
const DECOY = [0, -9] as const; // no leaves near it, so it is no tree
const POPPIES = [[-7, 0], [-6, 3], [7, -3], [0, 7]] as const;
const DANDELIONS = [[6, 5], [-5, -5]] as const;
const ROSE_BUSH = [3, -7] as const;
const FAR_POPPY = [18, 3] as const;
const SAPLING = [-3, 7] as const;
const FAR_ITEM = [19, -3] as const;
const TALL = 5; // logs in a trunk

const at = (o: readonly [number, number], dy = 0): Pos => ({ x: S.x + o[0], y: S.y + dy, z: S.z + o[1] });
const cell = (p: Pos) => `${p.x} ${p.y} ${p.z}`;

const offlineUuid = (name: string): string => {
  const b = createHash("md5").update(`OfflinePlayer:${name}`).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

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
  const i = text.indexOf(`    ${SITE_REGION}:`);
  if (i < 0) return;
  writeFileSync(REGIONS, text.slice(0, i));
  await c.world.run("rg load -w world");
}

async function run(c: Ctx, intent: object, ms = 60_000): Promise<{ reply: string; end: BodyEvent | null }> {
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
const said = (e: BodyEvent | null) => `${e?.event ?? "no end"} ${e?.reason ?? ""} ${e?.detail ?? ""}`.trim();

async function tree(c: Ctx, p: Pos): Promise<void> {
  const w = c.world;
  await w.run(`fill ${p.x - 2} ${p.y + 2} ${p.z - 2} ${p.x + 2} ${p.y + 3} ${p.z + 2} oak_leaves`);
  await w.run(`fill ${p.x - 1} ${p.y + 4} ${p.z - 1} ${p.x + 1} ${p.y + 5} ${p.z + 1} oak_leaves`);
  await w.run(`fill ${p.x} ${p.y} ${p.z} ${p.x} ${p.y + TALL - 1} ${p.z} oak_log`);
}

async function wipe(c: Ctx): Promise<void> {
  // two halves: one fill is capped at 32768 blocks
  for (const [y0, y1] of [[67, 78], [79, 90]]) await c.world.run(`fill ${S.x - 22} ${y0} ${S.z - 22} ${S.x + 22} ${y1} ${S.z + 22} air`);
  await c.world.run(`kill @e[type=item,x=${S.x},y=${S.y},z=${S.z},distance=..40]`);
}

// the platform, the region, a bare pack plus `give`, the base made with the body's own hands, then the grove and the clutter
async function site(c: Ctx, o: { give?: string[]; grove?: boolean } = {}): Promise<{ table: Pos; chest: Pos }> {
  const w = c.world;
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  await giveRegion(c);
  await w.run(`forceload add ${S.x - 30} ${S.z - 30} ${S.x + 30} ${S.z + 30}`);
  await w.run(`fill ${S.x - 22} 66 ${S.z - 22} ${S.x + 22} 66 ${S.z + 22} grass_block`);
  await wipe(c);
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await w.run(`effect give ${c.bot} minecraft:saturation 600 10 true`);
  await w.run("time set day");
  await w.run("weather clear");
  await w.run(`tp ${c.bot} ${AT}`);
  await sleep(2500);
  for (const g of ["crafting_table 1", "white_bed 1", "chest 1"]) await w.run(`give ${c.bot} ${g}`);
  for (const item of ["crafting_table", "white_bed", "chest"]) {
    const r = await run(c, { intent: "place", item, where: "here" });
    c.check(r.end?.event === "task_finished", `place ${item}: ${said(r.end)}`);
  }
  const made = await run(c, { intent: "make_base" });
  c.check(made.end?.event === "task_finished", `make_base: ${said(made.end)}`);
  const rec = JSON.parse(readFileSync(path.join(AUTH, `base-${c.bot}.json`), "utf8")) as { craftingTable: Pos; stashChests: Pos[] };

  if (o.grove !== false) {
    for (const t of TREES) await tree(c, at(t));
    await tree(c, at(EDGE_TREE));
    await w.run(`fill ${cell(at(DECOY))} ${cell(at(DECOY, TALL - 1))} oak_log`);
    for (const p of POPPIES) await w.run(`setblock ${cell(at(p))} poppy`);
    for (const p of DANDELIONS) await w.run(`setblock ${cell(at(p))} dandelion`);
    await w.run(`setblock ${cell(at(ROSE_BUSH))} rose_bush[half=lower]`);
    await w.run(`setblock ${cell(at(ROSE_BUSH, 1))} rose_bush[half=upper]`);
    await w.run(`setblock ${cell(at(SAPLING))} oak_sapling`);
    await w.run(`setblock ${cell(at(FAR_POPPY))} poppy`);
  }
  for (const g of o.give ?? []) await w.run(`give ${c.bot} ${g}`);
  await sleep(o.grove === false ? 500 : 3000); // the bot has to see the grove before it surveys it
  return { table: rec.craftingTable, chest: rec.stashChests[0] };
}

async function tidy(c: Ctx): Promise<void> {
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  await wipe(c);
  await c.world.run(`clear ${c.bot}`);
  const file = path.join(AUTH, `base-${c.bot}.json`);
  if (existsSync(file)) rmSync(file);
  await takeRegion(c);
  await restartBot(c);
  await c.world.run(`tp ${c.bot} 0.5 68 -10`);
}

const held = async (c: Ctx, chest: Pos, item: string) => (await c.world.count(c.bot, item)) + (await c.world.chestCount(chest, item));
const trunkLogs = (c: Ctx, o: readonly [number, number]) => c.world.countBlocks(at(o), at(o, TALL - 1), "oak_log");
const entityAt = (c: Ctx, p: Pos, r = 3) => c.world.passes(`execute if entity @e[type=item,x=${p.x},y=${p.y},z=${p.z},distance=..${r}]`);
const air = (c: Ctx, p: Pos) => c.world.passes(`execute if block ${cell(p)} air`);

const clear: Scenario = {
  name: "clear_trees: fells the square, keeps the edge, takes what drops, clears the ground",
  timeoutMs: 600_000,
  async setup(c) {
    await site(c);
    // things lying about: three of a tree's, one of a kind the sweep leaves, one past the ring (that one never despawns, the run is long)
    const items: Array<[readonly [number, number], string, number]> = [[[-2, 3], "apple", 2], [[2, -4], "oak_sapling", 3], [[-4, 8], "stick", 5], [[-13, 13], "diamond", 1]];
    for (const [o, item, n] of items) await c.world.run(`summon item ${S.x + o[0] + 0.5} ${S.y + 0.2} ${S.z + o[1] + 0.5} {Item:{id:"minecraft:${item}",count:${n}}}`);
    const far = at(FAR_ITEM);
    await c.world.run(`summon item ${far.x + 0.5} ${far.y + 0.2} ${far.z + 0.5} {Age:-32768s,Item:{id:"minecraft:birch_sapling",count:1}}`);
  },
  async act(c) {
    const r = await run(c, { intent: "clear_trees", radius: RADIUS }, 540_000);
    c.check(r.end?.event === "task_finished", `clear_trees ends finished (${r.reply}, ${said(r.end)})`);
    c.check(/^felled four trees/.test(String(r.end?.detail ?? "")), `the words say four trees (${r.end?.detail})`);
    c.check(/cleared \w+ plants?/.test(String(r.end?.detail ?? "")), "and the plants cleared");
    c.check(/at the edge/.test(String(r.end?.detail ?? "")), "and the edge tree left");
    const got = (r.end?.got ?? {}) as Record<string, number>;
    c.check((got.oak_log ?? 0) >= TREES.length * TALL - 2, `got oak_log ${got.oak_log} of ${TREES.length * TALL}`);
    c.check(JSON.stringify({ detail: r.end?.detail, got: r.end?.got }).match(/-?\d{3,}/) === null, "no coordinate in the ending");
  },
  async verify(c) {
    const rec = JSON.parse(readFileSync(path.join(AUTH, `base-${c.bot}.json`), "utf8")) as { stashChests: Pos[] };
    const chest = rec.stashChests[0];
    for (const t of TREES) c.check((await trunkLogs(c, t)) === 0, `trunk at ${t} is gone`);
    c.check((await trunkLogs(c, EDGE_TREE)) === TALL, "the trunk past the square still stands");
    c.check((await trunkLogs(c, DECOY)) === TALL, "the bare trunk is untouched");
    const logs = await held(c, chest, "oak_log");
    c.check(logs >= TREES.length * TALL - 2, `logs kept, pack and chest ${logs} of ${TREES.length * TALL}`);
    c.check((await held(c, chest, "apple")) >= 2, "the apples lying about are in the pack or the chest");
    c.check((await held(c, chest, "oak_sapling")) >= 3, "and the saplings");
    c.check((await held(c, chest, "stick")) >= 5, "and the sticks");
    c.check((await held(c, chest, "diamond")) === 0, "a diamond lying there is not its to take");
    c.check(await entityAt(c, at(FAR_ITEM)), "an item past the ring stays where it lay");
    for (const p of [...POPPIES, ...DANDELIONS, SAPLING]) c.check(await air(c, at(p)), `the plant at ${p} is gone`);
    c.check(await air(c, at(ROSE_BUSH)), "the rose bush is gone, both halves");
    c.check(await air(c, at(ROSE_BUSH, 1)), "its upper half too");
    c.check(await c.world.blockIs(at(FAR_POPPY), "poppy"), "the poppy past the square stays");
    const t0 = at(TREES[0], 2);
    const left = await c.world.countBlocks({ x: t0.x - 2, y: t0.y, z: t0.z - 2 }, { x: t0.x + 2, y: t0.y, z: t0.z + 2 }, "oak_leaves");
    c.check(left <= 12, `leaves down at the first tree's lowest level: ${left} of 24 left`);
  },
  cleanup: tidy,
};

const stash: Scenario = {
  name: "clear_trees: a nearly full pack is stashed at the base chest (logs in the chest, a tree down)",
  timeoutMs: 420_000,
  async setup(c) {
    // 33 stacks of dirt, three slots free: the first tree's logs make it two
    const { chest } = await (async () => {
      const r = await site(c, { grove: false });
      await tree(c, at(TREES[0]));
      await tree(c, at(TREES[1]));
      for (let i = 0; i < 33; i++) await c.world.run(`give ${c.bot} dirt 64`);
      await sleep(3000); // the bot has to see the two trees before it surveys
      return r;
    })();
    c.check((await c.world.chestCount(chest, "oak_log")) === 0, "the chest starts without logs");
  },
  async act(c) {
    const r = await run(c, { intent: "clear_trees", radius: RADIUS }, 360_000);
    c.check(r.end?.event === "task_finished", `ends finished (${r.reply}, ${said(r.end)})`);
    process.stdout.write(`    stash scenario ended: ${said(r.end)}\n`);
  },
  async verify(c) {
    const rec = JSON.parse(readFileSync(path.join(AUTH, `base-${c.bot}.json`), "utf8")) as { stashChests: Pos[] };
    const chest = rec.stashChests[0];
    c.check((await c.world.chestCount(chest, "oak_log")) >= TALL - 1, `the chest has the logs (${await c.world.chestCount(chest, "oak_log")})`);
    const felled = (await trunkLogs(c, TREES[0])) === 0 || (await trunkLogs(c, TREES[1])) === 0;
    c.check(felled, "at least one tree is down");
    c.check((await c.world.count(c.bot, "dirt")) === 33 * 64, "the dirt it carried stays with it");
  },
  cleanup: tidy,
};

const stop: Scenario = {
  name: "clear_trees: stop ends it at once, nothing walks or digs after",
  timeoutMs: 240_000,
  async setup(c) {
    await site(c);
  },
  async act(c) {
    const from = c.body.mark();
    const r = await c.body.send({ intent: "clear_trees", radius: RADIUS });
    c.check(r.type === "accepted", `accepted (${r.type} ${r.reason ?? ""})`);
    for (let i = 0; i < 400 && (await c.world.count(c.bot, "oak_log")) < 1; i++) await sleep(150);
    await sleep(500);
    await c.body.send({ intent: "stop" });
    c.check((await c.body.waitEvent("task_stopped", from, 3000)) !== null, "task_stopped within 3 s");
  },
  async verify(c) {
    const snap = async () => `${(await c.world.pos(c.bot)).map((n) => Math.round(n)).join(",")} logs ${await c.world.count(c.bot, "#minecraft:logs")} standing ${(await Promise.all(TREES.map((t) => trunkLogs(c, t)))).join("/")}`;
    await sleep(500);
    const before = await snap();
    await sleep(3000);
    const after = await snap();
    c.check(before === after, `still for 3 s after stop (${before} -> ${after})`);
    c.check((await c.body.send({ intent: "stop" })).type === "accepted", "and the body takes orders");
  },
  cleanup: tidy,
};

export default [clear, stash, stop];
