// The strip mine: a stair to a depth with torches, a tunnel with a branch, the way back, a full pack, a worn pickaxe, the
// stops (gravel, lava), `go_to` a cell and the local view. Each starts from a frozen checkpoint (surface, day, the pack
// the scenario gives) on a built column far from home: stone over deepslate over bedrock, under a WorldGuard region of
// its own that lets the bot dig. Facts come from the server; what the body says is checked against them.
//
// The column: x 395..540, z 376..424, y -64 to 66 (grass on top at 66, bedrock at -64, deepslate to y 0, stone above), air
// to 100. The stair starts at (400, 67, 400) and runs east; the region is x 380..600, z 370..430, y -64..110 and is
// taken out of regions.yml again after (only its own block). Rebuild the column with `fill` if a runner is killed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { go, said } from "./handsb.scenario";
import { runDir } from "../slot";
import { sleep, type BodyEvent, type Ctx, type Observation, type Pos, type Scenario } from "./lib";

const REGIONS = path.join(runDir, "plugins", "WorldGuard", "worlds", "world", "regions.yml");
const REGION = "scuttle-strip";
const JOURNAL = path.join(process.cwd(), ".auth-cache");

export const X0 = 400;
export const Z0 = 400;
export const TOP = 67; // the bot's feet; the grass is y 66
export const AT = `${X0}.5 ${TOP} ${Z0}.5 270 0`; // facing east
export const COL = { x0: 395, x1: 540, z0: 376, z1: 424 };

const offlineUuid = (name: string): string => {
  const b = createHash("md5").update(`OfflinePlayer:${name}`).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

async function giveRegion(c: Ctx): Promise<void> {
  const text = readFileSync(REGIONS, "utf8");
  if (text.includes(`    ${REGION}:`)) return;
  writeFileSync(
    REGIONS,
    `${text.trimEnd()}\n    ${REGION}:\n        min: {x: 380, y: -64, z: 370}\n        max: {x: 600, y: 110, z: 430}\n        members:\n            unique-ids:\n            - ${offlineUuid(c.bot)}\n        flags: {}\n        owners: {}\n        type: cuboid\n        priority: 1\n`
  );
  await c.world.run("rg load -w world");
}

// takes out only this scenario's block: from its heading to the next region (four-space heading) or the end
async function takeRegion(c: Ctx): Promise<void> {
  const text = readFileSync(REGIONS, "utf8");
  const start = text.indexOf(`    ${REGION}:`);
  if (start < 0) return;
  const rest = text.slice(start + 1);
  const next = rest.search(/\n {4}\S/);
  writeFileSync(REGIONS, text.slice(0, start) + (next < 0 ? "" : rest.slice(next + 1)));
  await c.world.run("rg load -w world");
}

// the column over x0..x1 (z fixed): slices of eight so every fill stays under the server's block limit
async function column(c: Ctx, x1 = COL.x1): Promise<void> {
  const w = c.world;
  const { x0, z0, z1 } = COL;
  await w.run(`forceload add ${x0} ${z0} ${x1} ${z1}`);
  for (let a = x0; a <= x1; a += 8) {
    const b = Math.min(a + 7, x1);
    await w.run(`fill ${a} -64 ${z0} ${b} -64 ${z1} bedrock`);
    await w.run(`fill ${a} -63 ${z0} ${b} 0 ${z1} deepslate`);
    await w.run(`fill ${a} 1 ${z0} ${b} 65 ${z1} stone`);
    await w.run(`fill ${a} 66 ${z0} ${b} 66 ${z1} grass_block`);
    await w.run(`fill ${a} 67 ${z0} ${b} 100 ${z1} air`);
  }
  await w.run(`kill @e[type=item,x=${X0},y=${TOP},z=${Z0},distance=..200]`);
}

const FILLER = [
  "dirt", "sand", "gravel", "oak_log", "birch_log", "spruce_log", "oak_planks", "birch_planks", "stick", "coal", "iron_ingot", "gold_ingot", "redstone", "lapis_lazuli", "diamond", "emerald",
  "apple", "carrot", "potato", "beef", "porkchop", "mutton", "chicken", "cod", "salmon", "string", "feather", "flint", "bone", "gunpowder", "paper", "leather", "clay_ball", "snowball", "egg",
];

// the frozen start: survival, fed, healed, day, the pack `give` lists and nothing else, facing east on the grass
export async function checkpoint(c: Ctx, give: string[], reach = COL.x1): Promise<void> {
  const w = c.world;
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  await giveRegion(c);
  await column(c, reach);
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await w.run(`effect give ${c.bot} minecraft:saturation 30 10 true`);
  await w.run("difficulty peaceful");
  await w.run("gamerule spawn_mobs false");
  await w.run("time set day");
  await w.run("weather clear");
  await w.run(`tp ${c.bot} ${AT}`);
  await sleep(2500);
  for (const g of give) await w.run(`give ${c.bot} ${g}`);
  await sleep(500);
}

export async function tidy(c: Ctx, reach = COL.x1): Promise<void> {
  await c.body.send({ intent: "stop" });
  await sleep(1000);
  await column(c, reach);
  await c.world.run(`forceload remove ${COL.x0} ${COL.z0} ${COL.x1} ${COL.z1}`);
  await c.world.run(`clear ${c.bot}`);
  await takeRegion(c);
  await c.world.run(`tp ${c.bot} 0.5 68 -10`);
}

export const KIT = ["iron_pickaxe 1", "torch 32", "bread 8", "chest 1", "crafting_table 1"];

async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

export const feet = async (c: Ctx): Promise<Pos> => {
  const [x, y, z] = await c.world.pos(c.bot);
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
};

// own torches the journal knows of (place lines whose block ended as a wall torch)
function journalTorches(c: Ctx, since: number): number {
  const file = path.join(JOURNAL, `journal-${c.bot}.jsonl`);
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { t: number; op: string; after: string; own: boolean })
    .filter((e) => e.t >= since && e.op === "place" && e.after === "wall_torch" && e.own).length;
}

const wallTorchAt = (c: Ctx, p: Pos) => c.world.blockIs(p, "wall_torch");

// wall torches in a box, one RCON question a cell
async function torchesIn(c: Ctx, from: Pos, to: Pos): Promise<Pos[]> {
  const cells = c.world.cells(from, to);
  const hits = await Promise.all(cells.map((p) => wallTorchAt(c, p)));
  return cells.filter((_, i) => hits[i]);
}

export const words = (s: unknown) => typeof s === "string" && s.length > 0 && !/\d/.test(s);
export const events = (c: Ctx, from: number, name: string) => c.body.events.slice(from).filter((e) => e.event === name);

// ---- the way down ----

const deep: Scenario = (() => {
  let first: BodyEvent | null = null;
  let second: BodyEvent | null = null;
  let mid: Pos = { x: 0, y: 0, z: 0 };
  let foot: Pos = { x: 0, y: 0, z: 0 };
  let obs: Observation | null = null;
  let torches: Pos[] = [];
  let journalled = 0;
  let worn: BodyEvent[] = [];
  let up: Pos = { x: 0, y: 0, z: 0 };
  let upEnd: BodyEvent | null = null;
  let start = { picks: 0, torches: 0, bread: 0, chest: 0, table: 0 };
  let mark = 0;
  let t0 = 0;
  return {
    name: "strip: dig_down to -50 with torches in two calls lands on -50 with torches on the stair, and climb_up brings it out over the whole length",
    timeoutMs: 1_500_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe 1", "iron_pickaxe 1", "torch 32", "bread 8", "chest 1", "crafting_table 1"]);
      start = { picks: await c.world.count(c.bot, "iron_pickaxe"), torches: await c.world.count(c.bot, "torch"), bread: await c.world.count(c.bot, "bread"), chest: await c.world.count(c.bot, "chest"), table: await c.world.count(c.bot, "crafting_table") };
    },
    async act(c) {
      t0 = Date.now();
      mark = c.body.mark();
      first = (await go(c, { intent: "dig_down", to: -50, torches: true }, 600_000)).end;
      mid = await feet(c);
      second = (await go(c, { intent: "dig_down", to: -50, torches: true }, 600_000)).end;
      foot = await feet(c);
      obs = await observe(c);
      worn = events(c, mark, "tool_worn");
      // every stair column's own cells and the three round them
      const found: Pos[] = [];
      for (let x = X0; x <= foot.x; x++) {
        const y = TOP - (x - X0);
        found.push(...(await torchesIn(c, { x, y: y - 1, z: Z0 - 1 }, { x, y: y + 3, z: Z0 + 1 })));
      }
      torches = found;
      journalled = journalTorches(c, t0);
      const back = await go(c, { intent: "climb_up" }, 900_000);
      upEnd = back.end;
      up = await feet(c);
    },
    async verify(c) {
      c.check(start.picks === 2 && start.torches === 32 && start.bread === 8 && start.chest === 1 && start.table === 1, `it started from the kit (${JSON.stringify(start)})`);
      c.check(first?.event === "task_finished" && /sixty-four steps down, not at the depth yet/.test(String(first.detail ?? "")), `the first call stops at sixty-four steps (${said(first)})`);
      c.check(mid.y <= TOP - 60 && mid.y >= TOP - 66, `and is 64 steps down (y ${mid.y})`);
      c.check(second?.event === "task_finished" && /at the depth asked/.test(String(second.detail ?? "")), `the second finishes at the depth asked (${said(second)})`);
      c.check(foot.y === -50, `it stands on y -50 (${foot.y})`);
      c.check(foot.x === X0 + (TOP + 50), `a one-wide stair, one block along per step (x ${foot.x})`);
      c.check(torches.length >= 12 && torches.length <= 18, `torches stand on the stair, about one in eight (${torches.length} of 117 steps)`);
      c.check(journalled >= torches.length - 1, `each torch is in the journal as its own (${journalled})`);
      c.check(obs?.pos?.y === -50 && obs.pos.x === foot.x && obs.pos.z === Z0, `observe pos is where the server has it (${JSON.stringify(obs?.pos)})`);
      c.check(typeof obs?.biome === "string" && obs.biome.length > 0, `biome is a name (${obs?.biome})`);
      c.check(/deepslate|stone|tuff/.test(String(obs?.under)), `under is deepslate or stone (${obs?.under})`);
      c.check(typeof obs?.light === "number" && obs.light >= 0 && obs.light <= 15, `light is 0 to 15 (${obs?.light})`);
      c.check(!!obs?.stone && !!obs.blocks.find((b) => b.what === "deepslate" && !!b.h), `stone shows deepslate with a handle, far from home (${obs?.stone}; ${(obs?.blocks ?? []).map((b) => b.what).join(", ")})`);
      c.check(worn.length >= 1 && worn.every((e) => e.item === "iron_pickaxe" && words(e.left)), `a worn pickaxe was told of, in words (${worn.map((e) => `${e.item}/${e.left}`).join(", ")})`);
      c.check(upEnd?.event === "task_finished", `climb_up finished (${said(upEnd)})`);
      c.check(Math.abs(up.y - TOP) <= 1 && Math.hypot(up.x - X0, up.z - Z0) <= 2, `and it is back at the top (${JSON.stringify(up)})`);
    },
    async cleanup(c) {
      await tidy(c);
    },
  };
})();

// ---- a tunnel and a branch ----

const branch: Scenario = (() => {
  let ends: Array<BodyEvent | null> = [];
  let eastEnd: Pos = { x: 0, y: 0, z: 0 };
  let back: Pos = { x: 0, y: 0, z: 0 };
  let northEnd: Pos = { x: 0, y: 0, z: 0 };
  let main: Pos[] = [];
  let side: Pos[] = [];
  let mainDug = 0;
  let sideDug = 0;
  let upEnd: BodyEvent | null = null;
  let up: Pos = { x: 0, y: 0, z: 0 };
  let goEnd: BodyEvent | null = null;
  let places: Record<string, string> | undefined;
  const DEPTH = 40;
  return {
    name: "strip: tunnel east 32 with torches, go_to a cell 3 back, tunnel north 16 from it: two branches with torches, climb_up from the branch end reaches the top",
    timeoutMs: 1_200_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, KIT, 480);
    },
    async act(c) {
      ends.push((await go(c, { intent: "dig_down", to: DEPTH, torches: true }, 400_000)).end);
      const foot = await feet(c);
      ends.push((await go(c, { intent: "tunnel", dir: "east", length: 32, torches: true }, 600_000)).end);
      eastEnd = await feet(c);
      const o = await observe(c);
      const target = { x: o.pos.x - 3, y: o.pos.y, z: o.pos.z };
      goEnd = (await go(c, { intent: "go_to", ...target }, 120_000)).end;
      back = await feet(c);
      ends.push((await go(c, { intent: "tunnel", dir: "north", length: 16, torches: true }, 600_000)).end);
      northEnd = await feet(c);
      places = (await observe(c)).places;
      // the cells each tunnel cut, and the torches along them
      main = await torchesIn(c, { x: foot.x + 1, y: foot.y, z: Z0 - 1 }, { x: eastEnd.x, y: foot.y + 2, z: Z0 + 1 });
      side = await torchesIn(c, { x: back.x - 1, y: foot.y, z: northEnd.z }, { x: back.x + 1, y: foot.y + 2, z: Z0 - 1 });
      mainDug = await c.world.countBlocks({ x: foot.x + 1, y: foot.y, z: Z0 }, { x: eastEnd.x, y: foot.y, z: Z0 }, "air");
      sideDug = await c.world.countBlocks({ x: back.x, y: foot.y, z: northEnd.z }, { x: back.x, y: foot.y, z: Z0 - 1 }, "air");
      const out = await go(c, { intent: "climb_up" }, 900_000);
      upEnd = out.end;
      up = await feet(c);
    },
    async verify(c) {
      const [down, east, north] = ends;
      c.check(down?.event === "task_finished" && /at the depth asked/.test(String(down.detail ?? "")), `the stair reached the depth (${said(down ?? null)})`);
      c.check(east?.event === "task_finished" && /ran out of length/.test(String(east.detail ?? "")) && words(east.detail), `the main tunnel ran its length (${said(east ?? null)})`);
      c.check(mainDug === 32, `thirty-two cells of the main tunnel are open (${mainDug})`);
      c.check(main.length >= 3 && main.length <= 6, `torches on the main tunnel, about one in eight (${main.length})`);
      c.check(goEnd?.event === "task_finished", `go_to a cell finished (${said(goEnd)})`);
      c.check(Math.abs(back.x - (eastEnd.x - 3)) <= 2 && back.y === eastEnd.y && Math.abs(back.z - eastEnd.z) <= 1, `it stands about 3 back along the tunnel (${back.x} for ${eastEnd.x - 3})`);
      c.check(north?.event === "task_finished" && /ran out of length/.test(String(north.detail ?? "")), `the branch ran its length (${said(north ?? null)})`);
      c.check(sideDug === 16 && northEnd.z <= Z0 - 15, `sixteen cells of the branch are open, off the main tunnel (${sideDug}, z ${northEnd.z})`);
      c.check(side.length >= 1 && side.length <= 4, `the branch has torches (${side.length})`);
      c.check(!!places?.stair && /the stair you dug/.test(places.stair), `the stair is still a place (${places?.stair})`);
      c.check(upEnd?.event === "task_finished", `climb_up from the end of the branch finished (${said(upEnd)})`);
      c.check(Math.abs(up.y - TOP) <= 1 && Math.hypot(up.x - X0, up.z - Z0) <= 2, `and it is at the top (${JSON.stringify(up)})`);
    },
    async cleanup(c) {
      await tidy(c, 480);
    },
  };
})();

// ---- a full pack, a worn pickaxe ----

const full: Scenario = (() => {
  let end: BodyEvent | null = null;
  let again: BodyEvent | null = null;
  let packFull: BodyEvent[] = [];
  let dugFirst = 0;
  let dugSecond = 0;
  let slots = 0;
  let cobble = 0;
  return {
    name: "strip: a full pack ends a tunnel with 'pack full' and one pack_full event, and it goes on once a slot is free",
    timeoutMs: 300_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe 1", ...FILLER.map((f) => `${f} 1`)], 440);
      // down into the rock first, so the tunnel is cut in stone
      await c.world.run(`tp ${c.bot} ${X0}.5 30 ${Z0}.5 270 0`);
      await c.world.run(`fill ${X0 - 1} 30 ${Z0 - 1} ${X0 + 40} 32 ${Z0 + 1} stone`);
      await c.world.run(`fill ${X0} 30 ${Z0} ${X0} 31 ${Z0} air`);
      await sleep(2500);
      // every slot taken: the pickaxe, then fillers until none is free
      for (let i = 0; i < 40; i++) await c.world.run(`give ${c.bot} ${FILLER[i % FILLER.length]} 1`);
      // the overflow started a pack_full episode while idle; end it, so the one in the act starts inside the tunnel
      await c.world.run(`clear ${c.bot} dirt`);
      await c.world.run("kill @e[type=item]");
      await sleep(2500);
      await c.world.run(`give ${c.bot} dirt 1`);
      await sleep(1500);
    },
    async act(c) {
      const mark = c.body.mark();
      const o = await observe(c);
      slots = Object.keys(o.inv).length + (o.tools?.length ?? 0);
      end = (await go(c, { intent: "tunnel", dir: "east", length: 12 }, 120_000)).end;
      dugFirst = await c.world.countBlocks({ x: X0 + 1, y: 30, z: Z0 }, { x: X0 + 12, y: 30, z: Z0 }, "air");
      packFull = events(c, mark, "pack_full");
      cobble = await c.world.count(c.bot, "cobblestone");
      // a slot frees, and the same order goes on
      await c.world.run(`clear ${c.bot} dirt`);
      await sleep(2500);
      const mark2 = c.body.mark();
      again = (await go(c, { intent: "tunnel", dir: "east", length: 3 }, 120_000)).end;
      dugSecond = await c.world.countBlocks({ x: X0 + 1, y: 30, z: Z0 }, { x: X0 + 12, y: 30, z: Z0 }, "air") - dugFirst;
      packFull = [...packFull, ...events(c, mark2, "pack_full").map((e) => ({ ...e, again: true }))];
    },
    async verify(c) {
      c.check(slots >= 34, `it started with a full pack (${slots} kinds)`);
      c.check(end?.event === "task_finished" && /pack full/.test(String(end.detail ?? "")), `the tunnel ended pack full (${said(end)})`);
      c.check(dugFirst < 12, `and did not dig on (${dugFirst} of 12 cells)`);
      c.check(cobble <= 1, `no cobblestone was dropped to be left behind (${cobble} held)`);
      c.check(packFull.filter((e) => !e.again).length === 1, `one pack_full event (${packFull.filter((e) => !e.again).length})`);
      c.check(again?.event === "task_finished" && dugSecond >= 1, `after a slot freed it dug on (${said(again)}, ${dugSecond} cells)`);
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
})();

const worn: Scenario = (() => {
  let end: BodyEvent | null = null;
  let told: BodyEvent[] = [];
  let late = 0;
  return {
    name: "strip: a pickaxe worn to its last tenth gives one tool_worn, in words, with the item",
    timeoutMs: 240_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, ["iron_pickaxe[damage=215] 1", "bread 4"], 440);
      await c.world.run(`tp ${c.bot} ${X0}.5 30 ${Z0}.5 270 0`);
      await c.world.run(`fill ${X0 - 1} 30 ${Z0 - 1} ${X0 + 40} 32 ${Z0 + 1} stone`);
      await c.world.run(`fill ${X0} 30 ${Z0} ${X0} 31 ${Z0} air`);
      await sleep(2500);
    },
    async act(c) {
      const mark = c.body.mark();
      const before = await c.world.run(`data get entity ${c.bot} Inventory[{id:"minecraft:iron_pickaxe"}].components`);
      c.check(/damage"?: 215/.test(before), `it holds a pickaxe with 215 used (${before.slice(0, 80)})`);
      end = (await go(c, { intent: "tunnel", dir: "east", length: 16 }, 180_000)).end;
      await sleep(1500);
      told = events(c, mark, "tool_worn");
      late = told.length;
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `the tunnel finished (${said(end)})`);
      c.check(late === 1, `one tool_worn (${late})`);
      c.check(told[0]?.item === "iron_pickaxe" && words(told[0]?.left), `it names the pickaxe and says how worn in words (${told[0]?.item}, ${told[0]?.left})`);
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
})();

// ---- the stops ----

function stop(name: string, plant: (c: Ctx) => Promise<void>, detail: RegExp, intact: (c: Ctx) => Promise<boolean>): Scenario {
  let end: BodyEvent | null = null;
  let at: Pos = { x: 0, y: 0, z: 0 };
  let health = 0;
  let whole = false;
  return {
    name,
    timeoutMs: 300_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, KIT, 440);
      await plant(c);
    },
    async act(c) {
      end = (await go(c, { intent: "dig_down", to: -50 }, 240_000)).end;
      at = await feet(c);
      health = await c.world.health(c.bot);
      whole = await intact(c);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "blocked", `blocked (${said(end)})`);
      c.check(detail.test(String(end?.detail ?? "")) && words(end?.detail), `says why, in words (${end?.detail})`);
      c.check(at.y > -50 && at.x - X0 >= 3 && at.x - X0 <= 8, `it stopped short on the stair (x ${at.x}, y ${at.y})`);
      c.check(health >= 19, `unhurt (${health})`);
      c.check(whole, "what it stopped for is untouched");
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
}

// the stair at column x has its feet on y = 67 - (x - 400): head cell one up, and the cell over that
const col = (x: number) => ({ c: TOP - (x - X0) });

const gravel = stop(
  "strip: gravel over the next step stops the stair, 'sand or gravel overhead', and leaves it in place",
  async (c) => {
    const { c: y } = col(X0 + 5);
    await c.world.run(`setblock ${X0 + 5} ${y + 3} ${Z0} gravel`); // two over the head cell of that column
  },
  /sand or gravel overhead/,
  async (c) => c.world.blockIs({ x: X0 + 5, y: TOP - 5 + 3, z: Z0 }, "gravel")
);

const lava = stop(
  "strip: lava beside the way down stops the stair before it, 'lava behind the wall', and nothing runs",
  async (c) => {
    const { c: y } = col(X0 + 5);
    await c.world.run(`setblock ${X0 + 5} ${y + 1} ${Z0 + 1} lava`); // beside the feet cell of that column, inside the rock
  },
  /lava/,
  async (c) => (await c.world.blockIs({ x: X0 + 5, y: TOP - 5 + 1, z: Z0 + 1 }, "lava")) && !(await c.world.blockIs({ x: X0 + 4, y: TOP - 4, z: Z0 + 1 }, "lava"))
);

// ---- go_to a cell ----

const cell: Scenario = (() => {
  let ok: BodyEvent | null = null;
  let refused: BodyEvent | null = null;
  let arrived: Pos = { x: 0, y: 0, z: 0 };
  let stayed: Pos = { x: 0, y: 0, z: 0 };
  let refusedReply = "";
  let bad = "";
  let o: Observation | null = null;
  return {
    name: "strip: go_to a cell walks there and stops within two, refuses a cell beside a build in words, and observe says where it is",
    timeoutMs: 180_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, KIT, 440);
      await c.world.run(`fill ${X0 + 14} 67 ${Z0 - 4} ${X0 + 16} 69 ${Z0 + 4} oak_planks`); // a wall a player built
    },
    async act(c) {
      o = await observe(c);
      ok = (await go(c, { intent: "go_to", x: X0 + 8, y: TOP, z: Z0 + 3 }, 60_000)).end;
      arrived = await feet(c);
      const r = await go(c, { intent: "go_to", x: X0 + 12, y: TOP, z: Z0 }, 60_000);
      refused = r.end;
      refusedReply = r.reply;
      stayed = await feet(c);
      // a half-cell or a word instead of a number never gets past the format check
      bad = (await c.body.send({ intent: "go_to", x: 1.5, y: 67, z: 3 })).type;
    },
    async verify(c) {
      c.check(o?.pos?.x === X0 && o.pos.y === TOP && o.pos.z === Z0, `observe pos is the cell it stands in (${JSON.stringify(o?.pos)})`);
      c.check(ok?.event === "task_finished", `the walk finished (${said(ok)})`);
      c.check(Math.hypot(arrived.x - (X0 + 8), arrived.z - (Z0 + 3)) <= 2 && arrived.y === TOP, `and it is within two blocks of the cell (${JSON.stringify(arrived)})`);
      c.check(refusedReply === "accepted" && refused?.event === "task_failed" && refused.reason === "refused", `a cell beside the planks is refused (${refusedReply} ${said(refused)})`);
      c.check(/built/.test(String(refused?.detail ?? "")) && words(refused?.detail), `in words (${refused?.detail})`);
      c.check(Math.abs(stayed.x - arrived.x) <= 1 && Math.abs(stayed.z - arrived.z) <= 1, `and it stayed where it was (${JSON.stringify(stayed)})`);
      c.check(bad !== "accepted", `a cell that is not whole numbers is turned down (${bad})`);
    },
    async cleanup(c) {
      await tidy(c, 440);
    },
  };
})();

// ---- the local view ----

const view: Scenario = (() => {
  let o: Observation | null = null;
  let lit: Observation | null = null;
  let server: Pos = { x: 0, y: 0, z: 0 };
  let biomeOk = false;
  let underOk = false;
  const DARK = { x: 700, y: 20, z: 700 }; // a sealed pocket; the torch is set before the bot's chunk loads
  return {
    name: "strip: observe says pos, biome, under and light as the server has them, and block light near a torch",
    timeoutMs: 120_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      await checkpoint(c, KIT, 440);
      await c.world.run(`forceload add ${DARK.x - 8} ${DARK.z - 8} ${DARK.x + 8} ${DARK.z + 8}`);
      await c.world.run(`fill ${DARK.x - 3} ${DARK.y - 1} ${DARK.z - 3} ${DARK.x + 3} ${DARK.y + 3} ${DARK.z + 3} stone`);
      await c.world.run(`fill ${DARK.x - 1} ${DARK.y} ${DARK.z - 1} ${DARK.x + 1} ${DARK.y + 1} ${DARK.z + 1} air`);
      await c.world.run(`setblock ${DARK.x + 1} ${DARK.y} ${DARK.z} torch`);
      await sleep(2000);
      await c.world.run(`forceload remove ${DARK.x - 8} ${DARK.z - 8} ${DARK.x + 8} ${DARK.z + 8}`);
    },
    async act(c) {
      o = await observe(c);
      server = await feet(c);
      biomeOk = await c.world.passes(`execute positioned ${server.x} ${server.y} ${server.z} if biome ~ ~ ~ minecraft:${o.biome}`);
      underOk = await c.world.blockIs({ x: server.x, y: server.y - 1, z: server.z }, String(o.under));
      await c.world.run(`tp ${c.bot} ${DARK.x - 0.5} ${DARK.y} ${DARK.z + 0.5}`);
      await sleep(4000);
      lit = await observe(c);
    },
    async verify(c) {
      c.check(o?.pos?.x === server.x && o.pos.y === server.y && o.pos.z === server.z, `pos is the feet cell (${JSON.stringify(o?.pos)} for ${JSON.stringify(server)})`);
      c.check(biomeOk, `the biome is the server's (${o?.biome})`);
      c.check(underOk && o?.under === "grass_block", `under is the block under the feet (${o?.under})`);
      c.check(o?.light === 0, `light at the head on the open grass in daylight is block light, 0 (${o?.light})`);
      c.check(typeof lit?.light === "number" && lit.light >= 10, `beside a torch the light is high (${lit?.light})`);
      c.check(lit?.pos?.y === DARK.y && lit.pos.x === DARK.x - 1, `pos follows it (${JSON.stringify(lit?.pos)})`);
    },
    async cleanup(c) {
      await c.world.run(`forceload add ${DARK.x - 8} ${DARK.z - 8} ${DARK.x + 8} ${DARK.z + 8}`);
      await c.world.run(`fill ${DARK.x - 3} ${DARK.y - 1} ${DARK.z - 3} ${DARK.x + 3} ${DARK.y + 3} ${DARK.z + 3} air`);
      await c.world.run(`forceload remove ${DARK.x - 8} ${DARK.z - 8} ${DARK.x + 8} ${DARK.z + 8}`);
      await tidy(c, 440);
    },
  };
})();

export default [view, cell, gravel, lava, worn, full, branch, deep];
