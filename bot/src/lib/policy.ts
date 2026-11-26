// The one question every world change asks first: may the body break or place this? Pure, over a `World` the
// caller reads (names, zones, grants); gate.ts is the live adapter and the doors in collect.ts, movement.ts and
// place-block.ts call it again at the moment of the change. The first refusal wins, in this order: unknown,
// physical, provenance, made radius, zones, then what only a place has to pass.
import {
  fallingWhy,
  isFalling,
  isLiquid,
  isMade,
  BUILD_HEIGHT,
  MADE_RADIUS,
  SIX,
  standOk,
  type NameAt,
  type Pos,
} from "./block-rules";

export type Kind = "dig" | "place";
export type Op = {
  kind: Kind;
  pos: Pos; // the cell that changes: the block dug, or the cell filled
  block?: string; // place: what goes there
  against?: Pos; // place: the solid block it is set against
  job: string;
  player?: string; // UUID of the player the job is for; a grant only serves its own player
};
export type Refusal = "unsafe" | "player_built" | "protected" | "unknown" | "not_allowed";
export type Verdict = { ok: true } | { ok: false; reason: Refusal; detail: string };
export type Provenance = "own" | "player" | "natural" | "unknown";
export type ZoneReason = "made" | "reverted" | "asked";

export interface World {
  nameAt: NameAt;
  solidAt?: (p: Pos) => boolean;
  zonesAt?: (p: Pos) => readonly ZoneReason[];
  // the journal's word that the body placed this block and it is still what it placed
  isOwn?: (p: Pos, blockNow: string) => boolean;
  // a grant (or any position test) that lifts provenance, radius and zones at a position
  granted?: (p: Pos, op: Op) => boolean;
  budgetLeft?: (job: string) => boolean;
  occupied?: (p: Pos) => boolean; // a player or mob stands in the cell (not the body itself)
  lightAt?: (p: Pos) => number | null; // 0 to 15, the brighter of sky and block light; null where it is not loaded
}

export interface CheckOpts {
  strict?: boolean; // place: the made radius and the kept zones apply, as they do to a dig (what the hands set down, not the stair's fill)
  stand?: Pos; // where the feet are, when the planner knows: geometry is its job, the doors leave it out
  physical?: boolean; // false: only the block itself must be loaded (logs and leaves, which never had the rule)
  clearFalling?: boolean; // a dig that brings a capped, dry column of sand or gravel down beside the body: needs `stand`, and the column's probe
  settling?: boolean; // with clearFalling: clearing what already came down, so the cells the column left empty are not open space
}

const ok: Verdict = { ok: true };
const no = (reason: Refusal, detail: string): Verdict => ({ ok: false, reason, detail });

// words are the planners' own where they have them, so a refusal at a door reads like one at the plan
const WORDS = {
  unknown: "it cannot see far enough ahead",
  liquid: "liquid next to it",
  falling: "sand or gravel overhead",
  stand: "it cannot be reached from there",
  made: "something a player built is too close",
  here: "a player built this",
  zone: "its digs were undone near there",
};

export function provenanceAt(pos: Pos, blockNow: string | null, world: Pick<World, "isOwn" | "zonesAt">): Provenance {
  if (blockNow === null) return "unknown";
  if (world.isOwn?.(pos, blockNow)) return "own";
  if (isMade(blockNow) || world.zonesAt?.(pos).includes("made")) return "player";
  return "natural";
}

// made blocks in the cube around `target`, and over it in its column; `skip` leaves out the ones that don't count
export function madeNear(target: Pos, world: World, skip: (p: Pos) => boolean): boolean {
  const madeAt = (dx: number, dy: number, dz: number): boolean => {
    const p = { x: target.x + dx, y: target.y + dy, z: target.z + dz };
    const name = world.nameAt(p);
    return name !== null && isMade(name) && !skip(p);
  };
  for (let dx = -MADE_RADIUS; dx <= MADE_RADIUS; dx++)
    for (let dy = -MADE_RADIUS; dy <= MADE_RADIUS; dy++) for (let dz = -MADE_RADIUS; dz <= MADE_RADIUS; dz++) if (madeAt(dx, dy, dz)) return true;
  for (let dy = MADE_RADIUS + 1; dy <= BUILD_HEIGHT; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (madeAt(dx, dy, dz)) return true;
  return false;
}

function physical(pos: Pos, nameAt: NameAt, stand?: Pos, clearFalling = false, settling = false): Verdict | null {
  const around = SIX.map(([dx, dy, dz]) => nameAt({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }));
  const over = [1, 2].map((dy) => nameAt({ x: pos.x, y: pos.y + dy, z: pos.z }));
  if (around.some((n) => n === null) || over.some((n) => n === null)) return no("unknown", WORDS.unknown);
  if (stand && !standOk(pos, stand)) return no("unsafe", WORDS.stand);
  if (around.some((n) => isLiquid(n as string))) return no("unsafe", WORDS.liquid);
  // what stands over the target comes down once it is gone, and what is two over follows
  if (over.some((n) => isFalling(n as string))) {
    if (!clearFalling) return no("unsafe", WORDS.falling);
    // the body is never under the column: it has to say where it stands, and that is beside the cell
    if (!stand) return no("unsafe", WORDS.stand);
    const why = fallingWhy(pos, nameAt, settling);
    if (why) return no("unsafe", why);
  }
  return null;
}

function checkDig(op: Op, world: World, opts: CheckOpts): Verdict {
  const here = world.nameAt(op.pos);
  if (here === null) return no("unknown", WORDS.unknown);
  if (opts.physical !== false) {
    const bad = physical(op.pos, world.nameAt, opts.stand, opts.clearFalling, opts.settling);
    if (bad) return bad;
  }

  const granted = (p: Pos): boolean => world.granted?.(p, op) === true;
  const prov = provenanceAt(op.pos, here, world);
  if (prov === "player" && !granted(op.pos)) return no("player_built", WORDS.here);

  // the body's own block is exempt at its own position and nowhere else
  const skip = (p: Pos): boolean => granted(p) || (world.isOwn?.(p, world.nameAt(p) ?? "") ?? false);
  if (madeNear(op.pos, world, skip)) return no("player_built", WORDS.made);

  const kept = world.zonesAt?.(op.pos).some((z) => z !== "made") ?? false;
  if (kept && !granted(op.pos)) return no("protected", WORDS.zone);
  return ok;
}

// what fill the stair may set down, in the order it uses it: natural blocks first, cobblestone last because it reads
// as a build to anything that has not journalled its own
export const PLACEABLE = ["dirt", "stone", "netherrack", "cobbled_deepslate", "cobblestone"] as const;
// what the hands set down besides: a table, a furnace, a chest, a torch, any bed. Never in the stair's fill order
const FIXTURES = /^(crafting_table|furnace|chest|torch|\w+_bed)$/;
// the one widening for planting: these saplings and no other plant (pale oak, azalea and mangrove propagules are left out)
export const SAPLINGS = ["oak_sapling", "spruce_sapling", "birch_sapling", "jungle_sapling", "acacia_sapling", "dark_oak_sapling", "cherry_sapling"] as const;
export const placeable = (name: string): boolean => (PLACEABLE as readonly string[]).includes(name) || FIXTURES.test(name) || (SAPLINGS as readonly string[]).includes(name);
// what the mind may ask for: the stair's stone is its own fill and not on the list
export const handsPlaceable = (name: string): boolean => name !== "stone" && placeable(name);
export const isSapling = (name: string): boolean => (SAPLINGS as readonly string[]).includes(name);
// what a sapling goes in, and the light it needs to grow
export const SAPLING_GROUND = ["grass_block", "dirt", "podzol", "coarse_dirt", "rooted_dirt"] as const;
export const SAPLING_LIGHT = 9;
const REPLACEABLE = /^(air|cave_air|void_air|short_grass|grass|tall_grass|fern|large_fern|dead_bush|short_dry_grass|tall_dry_grass|leaf_litter|snow)$/;
export const isReplaceable = (name: string): boolean => REPLACEABLE.test(name);

// a sapling goes on the top of grass or dirt, and only where there is light to grow it
function checkSapling(op: Op, world: World): Verdict | null {
  const on = op.against;
  if (!on || on.x !== op.pos.x || on.z !== op.pos.z || on.y !== op.pos.y - 1) return no("not_allowed", "a sapling goes on the ground, not against a side");
  if (!(SAPLING_GROUND as readonly string[]).includes(world.nameAt(on) ?? "")) return no("not_allowed", "a sapling only goes in grass or dirt");
  const light = world.lightAt?.(op.pos);
  if (light === undefined || light === null) return no("unknown", WORDS.unknown);
  if (light < SAPLING_LIGHT) return no("not_allowed", "it is too dark there for a sapling to grow");
  return null;
}

// Made radius, liquid and falling are about what breaking takes apart; a block set down can't, and the stair's own
// fill would otherwise refuse against the cobblestone it laid before. The hands (`strict`) set blocks down among
// things players built, which is as bad as digging them, so for them the radius and the kept zones count.
function checkPlace(op: Op, world: World, opts: CheckOpts): Verdict {
  const here = world.nameAt(op.pos);
  if (here === null || (op.against && world.nameAt(op.against) === null)) return no("unknown", WORDS.unknown);
  const prov = provenanceAt(op.pos, here, world);
  if (prov === "player" && world.granted?.(op.pos, op) !== true) return no("player_built", WORDS.here);

  if (!op.block || !placeable(op.block) || (opts.strict && !handsPlaceable(op.block))) return no("not_allowed", "it does not set that block down");
  if (!REPLACEABLE.test(here)) return no("not_allowed", "something is already there");
  if (!op.against || !world.solidAt?.(op.against)) return no("not_allowed", "nothing solid to set it against");
  if (world.occupied?.(op.pos)) return no("not_allowed", "someone is standing there");
  const planting = isSapling(op.block) ? checkSapling(op, world) : null;
  if (planting) return planting;
  if (opts.strict) {
    const skip = (p: Pos): boolean => world.granted?.(p, op) === true || (world.isOwn?.(p, world.nameAt(p) ?? "") ?? false);
    if (madeNear(op.pos, world, skip)) return no("player_built", WORDS.made);
    if ((world.zonesAt?.(op.pos).length ?? 0) > 0 && world.granted?.(op.pos, op) !== true) return no("protected", WORDS.zone);
  }
  if (world.budgetLeft && !world.budgetLeft(op.job)) return no("not_allowed", "it has set down enough blocks for now");
  return ok;
}

export function check(op: Op, world: World, opts: CheckOpts = {}): Verdict {
  return op.kind === "dig" ? checkDig(op, world, opts) : checkPlace(op, world, opts);
}

// ---- grants: a player asks for help with something, for a while, in a box ----

export type Box = { min: Pos; max: Pos };
export type Grant = { player: string; box: Box; expires: number; ops: readonly Kind[] };
export const MAX_GRANTS = 3;
export const MAX_GRANT_SPAN = 16;

const span = (box: Box): number => Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) + 1;
const inBox = (p: Pos, b: Box): boolean =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;

// in memory only: a restart ends every grant
export class GrantStore {
  private grants: Grant[] = [];

  live(now: number): readonly Grant[] {
    this.grants = this.grants.filter((g) => g.expires > now);
    return this.grants;
  }

  // false when three are live already or the box is too wide
  add(grant: Grant, now: number): boolean {
    if (span(grant.box) > MAX_GRANT_SPAN || grant.expires <= now) return false;
    if (this.live(now).length >= MAX_GRANTS) return false;
    this.grants.push(grant);
    return true;
  }

  covers(p: Pos, op: Op, now: number): boolean {
    if (!op.player) return false;
    return this.live(now).some((g) => g.player === op.player && g.ops.includes(op.kind) && inBox(p, g.box));
  }

  clear(): void {
    this.grants = [];
  }
}

// ---- how many blocks it may set down ----

export const PLACE_JOB_MAX = 16;
export const PLACE_DAY_MAX = 256;
const DAY_MS = 24 * 60 * 60_000;

export class PlaceBudget {
  private perJob = new Map<string, number>();
  private day: number[] = [];
  constructor(
    private readonly jobMax = PLACE_JOB_MAX,
    private readonly dayMax = PLACE_DAY_MAX
  ) {}

  left(job: string, now: number): boolean {
    this.day = this.day.filter((t) => now - t < DAY_MS);
    return (this.perJob.get(job) ?? 0) < this.jobMax && this.day.length < this.dayMax;
  }

  spend(job: string, now: number): void {
    this.perJob.set(job, (this.perJob.get(job) ?? 0) + 1);
    this.day.push(now);
  }
}

// ---- reading the world cheaply ----

// Names, remembered for one task's scans: neighbouring made-radius cubes overlap heavily (a canopy asks about
// hundreds of leaves) and nothing here needs a block to be read twice. Unloaded cells are never remembered.
export function memoNames(nameAt: NameAt): NameAt {
  const seen = new Map<number, string>();
  const key = (p: Pos): number | null =>
    Math.abs(p.x) < 1 << 20 && Math.abs(p.z) < 1 << 20 && p.y >= -64 && p.y < 448 ? ((p.x + (1 << 20)) * 2 ** 21 + (p.z + (1 << 20))) * 512 + (p.y + 64) : null;
  return (p) => {
    const k = key(p);
    if (k === null) return nameAt(p);
    const hit = seen.get(k);
    if (hit !== undefined) return hit;
    const name = nameAt(p);
    if (name !== null) seen.set(k, name);
    return name;
  };
}
