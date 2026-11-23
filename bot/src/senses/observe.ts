// What the body can see right now, as the observation the mind reads (compose.ts shapes it). Mineflayer
// holds every loaded chunk and entity whether a player could see them or not, so everything listed
// here has to pass a ray from the eyes (sight.ts); blocks also need an open face. SCUTTLE_XRAY, which
// the mining loop has for tests, plays no part here. Positions go into handles and offsets and no
// further.
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { safeToDig } from "../behaviors/dig-safety";
import { describeLevel } from "../behaviors/place";
import { nearestRefused, refusedNow, reverted } from "../behaviors/refused";
import { STONE_MIN_Y, STONE_RANGE } from "../behaviors/stone-plan";
import { armourPoints } from "../behaviors/stance";
import { home } from "../lib/home";
import { isPlainLogName } from "../lib/movement";
import { durabilityLeft, mobHealthBand, timeWords, weatherWords } from "./bands";
import { compose, type Observation, type RawBlock, type RawEntity, type RawSense } from "./compose";
import { HandleTable, PLACES, type Place } from "./handles";
import { blockKind, PER_KIND, PER_LIQUID, SIGHT_BLOCKS, SIGHT_ENTITIES } from "./notable";
import { blockVisible, entityVisible, hasOpenFace, type Opaque } from "./sight";
import { bodyStanding } from "./standing";
import { pickTrees, type TreeProbe } from "./trees";

const LIVING = new Set(["player", "hostile", "animal", "passive", "mob", "ambient", "water_creature"]);
const NAME = /^[A-Za-z0-9_.]{1,17}$/;
const MAX_ENTITIES = 40; // looked at, nearest first, before the budget trims the list
const TESTS_PER_KIND = 40; // blocks of one kind ray-tested before giving up on it

// where each known place is; goto.ts walks to the same spots
export const placeSpot = (p: Place): Vec3 =>
  p === "table" ? home.craftingTable : p === "stash" ? home.stashChests[0] : p === "furnace" ? home.furnaces[0] : home.bed[0];

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

  return {
    health: typeof bot.health === "number" ? bot.health : null,
    food: typeof bot.food === "number" ? bot.food : null,
    armor: armourPoints(worn),
    time: overworld && typeof bot.time.timeOfDay === "number" ? timeWords(bot.time.timeOfDay) : null,
    weather: weatherWords((bot as unknown as { rainState: number }).rainState ?? 0, bot.thunderState),
    where: describeLevel(feet, home.bed[0], bot.game.dimension),
    held: bot.heldItem?.name ?? null,
    items,
    tools,
    entities: seenEntities(v),
    blocks: [...seenBlocks(v), ...seenTrees(v)],
    standing: bodyStanding(bot),
    stone: seenStone(v),
    refused: nearestRefused(refusedNow(), feet).map((z) => ({ dx: z.x - feet.x, dz: z.z - feet.z, r: z.r })),
    places: overworld ? PLACES.map((name) => ({ name, ...v.rel(centre(placeSpot(name))) })) : null,
  };
}

function seenEntities({ bot, handles, opaque, feet, eye, rel }: View): RawEntity[] {
  const near = Object.values(bot.entities)
    .filter((e): e is Entity => e !== bot.entity && Boolean(e.position) && LIVING.has(e.type ?? ""))
    .map((e) => ({ e, d: e.position.distanceTo(feet) }))
    .filter(({ d }) => d <= SIGHT_ENTITIES)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_ENTITIES);

  const out: RawEntity[] = [];
  for (const { e } of near) {
    if (!entityVisible(eye, e.position, e.height ?? 1.8, opaque)) continue;
    const player = e.type === "player";
    // a player's name is the server's validated one; a mob is its type, never a custom name a player set
    const what = player ? (e.username && NAME.test(e.username) ? e.username : "player") : (e.name ?? "mob");
    const handle = handles.mint({ kind: "entity", id: e.id, label: player ? what : `the ${what.replace(/_/g, " ")}` });
    // a living entity's health is metadata slot 9
    const hp = player ? undefined : mobHealthBand(what, e.metadata?.[9]);
    out.push({ handle, what, kind: player ? "player" : e.type === "hostile" ? "hostile" : "other", ...(hp && { hp }), ...rel(e.position) });
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
  const spots = new Set([...PLACES.filter((p) => p !== "home").map(placeSpot), home.bed[1]].map((v) => v.toString()));

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
    out.push({ handle, what: block.name, ...rel(centre(pos)) });
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
// refused place, safe by the dig rule) that is in view; no handle, since there are a lot of faces
function seenStone({ bot, opaque, feet, eye, rel }: View): { dx: number; dy: number; dz: number } | undefined {
  const id = bot.registry.blocksByName.stone?.id;
  if (id === undefined) return undefined;
  const nameAt = (p: { x: number; y: number; z: number }) => bot.blockAt(new Vec3(p.x, p.y, p.z), false)?.name ?? null;
  let tested = 0;
  for (const pos of bot.findBlocks({ matching: id, maxDistance: SIGHT_BLOCKS, count: 64 }).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    if (pos.y <= STONE_MIN_Y || pos.distanceTo(home.craftingTable) > STONE_RANGE || reverted.covers(pos)) continue;
    if (!hasOpenFace(pos, opaque)) continue;
    if (++tested > 20) break;
    if (blockVisible(eye, pos, opaque) && safeToDig(pos, nameAt)) return rel(centre(pos));
  }
  return undefined;
}
