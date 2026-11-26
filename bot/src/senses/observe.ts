// What the body can see right now, as the observation the mind reads (compose.ts shapes it). Mineflayer
// holds every loaded chunk and entity whether a player could see them or not, so everything listed
// here has to pass a ray from the eyes (sight.ts); blocks also need an open face. SCUTTLE_XRAY, which
// the mining loop has for tests, plays no part here. A block's position goes into its handle and an
// offset band and no further; the body's own cell is `pos` (D12), the one coordinate that is sent.
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { isMade, safeToDig } from "../behaviors/dig-safety";
import { describeLevel } from "../behaviors/place";
import { nearestRefused, refusedNow, reverted } from "../behaviors/refused";
import { STONE_MIN_Y, STONE_RANGE } from "../behaviors/stone-plan";
import { STONE_STOP } from "../behaviors/dig-down-plan";
import { isStairStep, stairFacing, stairLeads, stairTop } from "../behaviors/stair";
import { armourPoints } from "../behaviors/stance";
import { base } from "../lib/base";
import { blockLightAt } from "../lib/light";
import { journal } from "../lib/journal";
import { getMine } from "../lib/sites";
import { spotKey, stashMemory, stashSummary } from "../behaviors/stash-plan";
import { isPlainLogName } from "../lib/movement";
import { durabilityLeft, mobHealthBand, timeWords, weatherWords } from "./bands";
import { compose, type Observation, type RawBlock, type RawEntity, type RawSense } from "./compose";
import { HandleTable, PLACES, type Place } from "./handles";
import { coverDepth, COVER_SCAN, type Over } from "./cover";
import { blockKind, PER_KIND, PER_LIQUID, SIGHT_BLOCKS, SIGHT_ENTITIES } from "./notable";
import { blockVisible, entityVisible, hasOpenFace, type Opaque } from "./sight";
import { bodyStanding } from "./standing";
import { pickTrees, type TreeProbe } from "./trees";

const LIVING = new Set(["player", "hostile", "animal", "passive", "mob", "ambient", "water_creature"]);
const NAME = /^[A-Za-z0-9_.]{1,17}$/;
const MAX_ENTITIES = 40; // looked at, nearest first, before the budget trims the list
const TESTS_PER_KIND = 40; // blocks of one kind ray-tested before giving up on it

// where each known place is; goto.ts walks to the same spots
export function placeSpot(p: Place): Vec3 | null {
  if (p === "stair") {
    const top = stairTop();
    return top ? new Vec3(top.x, top.y, top.z) : null;
  }
  if (p === "mine" || p === "shaft") {
    const at = p === "mine" ? getMine()?.landing : getMine()?.top;
    return at ? new Vec3(at.x, at.y, at.z) : null;
  }
  // a base made in the field may have no furnace or chest yet
  return (p === "table" ? base.craftingTable : p === "stash" ? base.stashChests[0] : p === "furnace" ? base.furnaces[0] : base.bed[0]) ?? null;
}

const centre = (p: Vec3) => p.offset(0.5, 0.5, 0.5);

export const isOverworld = (bot: Bot): boolean => !bot.game.dimension || bot.game.dimension === "overworld";

type Rel = (p: Vec3) => { dx: number; dy: number; dz: number };
interface View {
  bot: Bot;
  handles: HandleTable;
  opaque: Opaque;
  feet: Vec3;
  eye: Vec3;
  rel: Rel;
}

export function createObserver(bot: Bot, handles: HandleTable): () => Observation {
  return () => {
    const cache = new Map<number, boolean>();
    // an unloaded cell hides what is behind it
    const opaque: Opaque = (x, y, z) => {
      const key = (x * 4099 + z) * 512 + y;
      let hit = cache.get(key);
      if (hit === undefined) {
        const b = bot.blockAt(new Vec3(x, y, z), false);
        hit = !b || (b.boundingBox === "block" && !b.transparent);
        cache.set(key, hit);
      }
      return hit;
    };
    const feet = bot.entity.position;
    const view: View = {
      bot,
      handles,
      opaque,
      feet,
      eye: feet.offset(0, (bot.entity as { eyeHeight?: number }).eyeHeight ?? 1.62, 0),
      rel: (p) => ({ dx: p.x - feet.x, dy: p.y - feet.y, dz: p.z - feet.z }),
    };
    return compose(gather(view));
  };
}

function gather(v: View): RawSense {
  const { bot, feet } = v;
  const overworld = isOverworld(bot);

  // armour worn is in slots 5 to 8; items() is only the carried part
  const worn = [5, 6, 7, 8].map((s) => bot.inventory.slots[s]?.name).filter((n): n is string => Boolean(n));
  const items: RawSense["items"] = [];
  const tools: RawSense["tools"] = [];
  for (const it of bot.inventory.items()) {
    if (it.maxDurability) {
      tools.push({ name: it.name, left: durabilityLeft(it.durabilityUsed ?? 0, it.maxDurability) });
      continue;
    }
    const have = items.find((i) => i.name === it.name);
    if (have) have.count += it.count;
    else items.push({ name: it.name, count: it.count });
  }

  // the stone it would take is also a block it can be pointed at, for `collect`; at the foot of a stair it dug, the
  // stone that stopped it comes first, wherever that is from home
  const stone = stairStone(v) ?? seenStone(v) ?? localStone(v);
  const blocks = [...seenBlocks(v), ...seenTrees(v)];
  if (stone) blocks.push({ handle: v.handles.mint({ kind: "block", ...stone.at, name: stone.name }), what: stone.name, ...stone.rel });

  return {
    ...localView(bot, feet),
    health: typeof bot.health === "number" ? bot.health : null,
    food: typeof bot.food === "number" ? bot.food : null,
    armor: armourPoints(worn),
    time: overworld && typeof bot.time.timeOfDay === "number" ? timeWords(bot.time.timeOfDay) : null,
    weather: weatherWords((bot as unknown as { rainState: number }).rainState ?? 0, bot.thunderState),
    where: describeLevel(feet, base.bed[0], bot.game.dimension, overworld ? coverOver(bot, feet) : undefined),
    held: bot.heldItem?.name ?? null,
    items,
    tools,
    entities: seenEntities(v),
    blocks,
    standing: bodyStanding(bot),
    stone: stone?.rel,
    refused: nearestRefused(refusedNow(), feet).map((z) => ({ dx: z.x - feet.x, dz: z.z - feet.z, r: z.r })),
    places: overworld ? seenPlaces(v) : null,
  };
}

// where the feet are and what is round them: the cell, the biome, the block underfoot and the light at the head
function localView(bot: Bot, feet: Vec3): Pick<RawSense, "pos" | "biome" | "under" | "light"> {
  const cell = feet.floored();
  // the block's own biome object has no name on 26.3 (its registry is another copy); the id is the server's
  const biomeId = bot.blockAt(cell)?.biome?.id;
  return {
    pos: { x: cell.x, y: cell.y, z: cell.z },
    biome: (biomeId !== undefined && bot.registry.biomes[biomeId]?.name) || null,
    under: bot.blockAt(feet.offset(0, -0.01, 0))?.name ?? null,
    light: blockLightAt(bot, cell.offset(0, 1, 0)),
  };
}

// under rock, as observe's `where` says it (more than two solid blocks over the head)
export const isUnderground = (bot: Bot): boolean => isOverworld(bot) && coverOver(bot, bot.entity.position) !== undefined;

// how far below open air the body is, when there is rock over its head (cover.ts); the cells above are read as the
// world has them, up to the scan's top, and an unloaded cell ends the column
function coverOver(bot: Bot, feet: Vec3): number | undefined {
  const column: Over[] = [];
  const x = Math.floor(feet.x);
  const z = Math.floor(feet.z);
  for (let y = Math.floor(feet.y) + 2; y < Math.floor(feet.y) + 2 + COVER_SCAN; y++) {
    const b = bot.blockAt(new Vec3(x, y, z), false);
    if (!b) break;
    if (b.boundingBox !== "block") column.push("open");
    else if (/_(leaves|log|wood)$/.test(b.name)) column.push("foliage");
    else column.push(isMade(b.name) ? "made" : "rock");
  }
  return coverDepth(column) ?? undefined;
}

// the known places with where they are, the stair only once there is one
function seenPlaces(v: View): NonNullable<RawSense["places"]> {
  const out: NonNullable<RawSense["places"]> = [];
  for (const name of PLACES) {
    const spot = placeSpot(name);
    if (!spot) continue;
    out.push({ name, ...v.rel(centre(spot)), ...(name === "stair" && { leads: stairLeads(v.feet) }), ...(name === "home" && base.made && { yours: true }) });
  }
  return out;
}

// fish and squid: the registry's water creatures, and the squids it calls passive
const WATER_MOBS = new Set(["cod", "salmon", "tropical_fish", "pufferfish", "squid", "glow_squid", "tadpole"]);
const MAX_WATER = 30; // ray-tested, nearest first
export const isWaterMob = (name: string | undefined, type: string | undefined): boolean => type === "water_creature" || WATER_MOBS.has(name ?? "");

function seenEntities({ bot, handles, opaque, feet, eye, rel }: View): RawEntity[] {
  const all = Object.values(bot.entities)
    .filter((e): e is Entity => e !== bot.entity && Boolean(e.position) && LIVING.has(e.type ?? ""))
    .map((e) => ({ e, d: e.position.distanceTo(feet), water: isWaterMob(e.name, e.type) }))
    .filter(({ d }) => d <= SIGHT_ENTITIES)
    .sort((a, b) => a.d - b.d);
  const near = [...all.filter((x) => !x.water).slice(0, MAX_ENTITIES), ...all.filter((x) => x.water).slice(0, MAX_WATER)];

  const out: RawEntity[] = [];
  const seen = near.filter(({ e }) => entityVisible(eye, e.position, e.height ?? 1.8, opaque));
  // a school is not worth pointing at: water creatures get a handle (the nearest of each kind) only when nothing else is in view
  const alone = !seen.some((x) => !x.water);
  const minted = new Set<string>();
  for (const { e, water } of seen) {
    const player = e.type === "player";
    // a player's name is the server's validated one; a mob is its type, never a custom name a player set
    const what = player ? (e.username && NAME.test(e.username) ? e.username : "player") : (e.name ?? "mob");
    let handle = "";
    if (!water || (alone && !minted.has(what))) {
      handle = handles.mint({ kind: "entity", id: e.id, label: player ? what : `the ${what.replace(/_/g, " ")}` });
      if (water) minted.add(what);
    }
    // a living entity's health is metadata slot 9
    const hp = player ? undefined : mobHealthBand(what, e.metadata?.[9]);
    out.push({ handle, what, kind: player ? "player" : e.type === "hostile" ? "hostile" : "other", ...(hp && { hp }), ...(water && { water }), ...rel(e.position) });
  }
  return out;
}

function seenBlocks({ bot, handles, opaque, feet, eye, rel }: View): RawBlock[] {
  const reg = bot.registry;
  const solid = reg.blocksArray.filter((b) => blockKind(b.name) && b.name !== "water" && b.name !== "lava").map((b) => b.id);
  const found: Vec3[] = bot.findBlocks({ matching: solid, maxDistance: SIGHT_BLOCKS, count: 300 });
  for (const name of ["water", "lava"]) {
    const id = reg.blocksByName[name]?.id;
    if (id !== undefined) found.push(...bot.findBlocks({ matching: id, maxDistance: SIGHT_BLOCKS, count: 30 }));
  }
  // a known place that is also in view is listed once, under its place handle
  const spots = new Set([...PLACES.filter((p) => p !== "home" && p !== "stair" && p !== "mine" && p !== "shaft").map(placeSpot), base.bed[1]].filter((v): v is Vec3 => v !== null).map((v) => v.toString()));

  const listed = new Map<string, number>();
  const tested = new Map<string, number>();
  const out: RawBlock[] = [];
  for (const pos of found.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    const block = bot.blockAt(pos, false);
    const kind = block && blockKind(block.name);
    if (!block || !kind || spots.has(pos.toString())) continue;
    const cap = kind === "water" || kind === "lava" ? PER_LIQUID : PER_KIND;
    if ((listed.get(kind) ?? 0) >= cap || (tested.get(kind) ?? 0) >= TESTS_PER_KIND) continue;
    if (!hasOpenFace(pos, opaque)) continue;
    tested.set(kind, (tested.get(kind) ?? 0) + 1);
    if (!blockVisible(eye, pos, opaque)) continue;
    listed.set(kind, (listed.get(kind) ?? 0) + 1);
    const handle = handles.mint({ kind: "block", x: pos.x, y: pos.y, z: pos.z, name: block.name });
    // what it set down itself says so: a chest of its own also says what it last saw in it
    const own = journal.ownAt(pos, block.name);
    const has = own && kind === "chest" ? stashSummary(stashMemory.lookAt(spotKey(pos))) : null;
    out.push({ handle, what: own ? `your ${block.name.replace(/_/g, " ")}` : block.name, ...(has && { has }), ...rel(centre(pos)) });
  }
  return out;
}

// one handle per tree, on its base log; the gate is get_wood's own (trees.ts)
function seenTrees({ bot, handles, opaque, feet, eye, rel }: View): RawBlock[] {
  const ids = bot.registry.blocksArray.filter((b) => isPlainLogName(b.name)).map((b) => b.id);
  const logs = bot.findBlocks({ matching: ids, maxDistance: SIGHT_BLOCKS, count: 300 }).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));
  const at = (p: { x: number; y: number; z: number }) => bot.blockAt(new Vec3(p.x, p.y, p.z));
  const probe: TreeProbe = {
    nameAt: (p) => at(p)?.name ?? null,
    naturalLeafAt: (p) => {
      const b = at(p);
      return Boolean(b?.name.endsWith("_leaves") && b.getProperties().persistent === false);
    },
    visible: (p) => hasOpenFace(p, opaque) && blockVisible(eye, p, opaque),
  };
  return pickTrees(logs, probe).map((p) => {
    const name = at(p)?.name ?? "oak_log";
    return { handle: handles.mint({ kind: "block", x: p.x, y: p.y, z: p.z, name }), what: name, ...rel(centre(new Vec3(p.x, p.y, p.z))) };
  });
}

// the nearest natural stone get_stone would take (within its range of home, above its floor, not in a
// refused place, safe by the dig rule) that is in view; observe lists it once among the blocks, with a handle
function seenStone({ bot, opaque, feet, eye, rel }: View): { rel: { dx: number; dy: number; dz: number }; at: Vec3; name: string } | undefined {
  const id = bot.registry.blocksByName.stone?.id;
  if (id === undefined) return undefined;
  const nameAt = (p: { x: number; y: number; z: number }) => bot.blockAt(new Vec3(p.x, p.y, p.z), false)?.name ?? null;
  let tested = 0;
  for (const pos of bot.findBlocks({ matching: id, maxDistance: SIGHT_BLOCKS, count: 64 }).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    if (pos.y <= STONE_MIN_Y || pos.distanceTo(base.craftingTable) > STONE_RANGE || reverted.covers(pos)) continue;
    if (!hasOpenFace(pos, opaque)) continue;
    if (++tested > 20) break;
    if (blockVisible(eye, pos, opaque) && safeToDig(pos, nameAt)) return { rel: rel(centre(pos)), at: pos, name: "stone" };
  }
  return undefined;
}

// the rock a strip mine is cut in: stone and deepslate, with the plain variants between them
const LOCAL_ROCK = ["stone", "deepslate", "andesite", "diorite", "granite", "tuff"];

// The nearest natural stone or deepslate it could dig from here, in view, wherever it is: seenStone is get_stone's,
// held to home's range and above y 30, and finds nothing at strip-mine depth.
function localStone({ bot, opaque, feet, eye, rel }: View): { rel: { dx: number; dy: number; dz: number }; at: Vec3; name: string } | undefined {
  const ids = LOCAL_ROCK.map((n) => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
  const nameAt = (p: { x: number; y: number; z: number }) => bot.blockAt(new Vec3(p.x, p.y, p.z), false)?.name ?? null;
  let tested = 0;
  for (const pos of bot.findBlocks({ matching: ids, maxDistance: SIGHT_BLOCKS, count: 64 }).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    if (reverted.covers(pos) || !hasOpenFace(pos, opaque)) continue;
    if (++tested > 20) break;
    if (blockVisible(eye, pos, opaque) && safeToDig(pos, nameAt)) return { rel: rel(centre(pos)), at: pos, name: nameAt(pos) ?? "stone" };
  }
  return undefined;
}

// On a step of the stair it dug: the natural stone under its feet or in front, the block `dig_down` stopped at and
// `collect` can take from here. Home's range and the 30-block floor do not apply; collect has its own guards.
function stairStone({ bot, feet, rel }: View): { rel: { dx: number; dy: number; dz: number }; at: Vec3; name: string } | undefined {
  const here = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) };
  const f = stairFacing();
  if (!f || !isStairStep(here)) return undefined;
  const nameAt = (p: { x: number; y: number; z: number }) => bot.blockAt(new Vec3(p.x, p.y, p.z), false)?.name ?? null;
  const spots = [
    { x: here.x + f.dx, y: here.y + 1, z: here.z + f.dz },
    { x: here.x + f.dx, y: here.y, z: here.z + f.dz },
    { x: here.x, y: here.y - 1, z: here.z },
  ];
  for (const p of spots) {
    const name = nameAt(p);
    if (name && STONE_STOP.has(name) && !reverted.covers(p) && safeToDig(p, nameAt)) return { rel: rel(centre(new Vec3(p.x, p.y, p.z))), at: new Vec3(p.x, p.y, p.z), name };
  }
  return undefined;
}
