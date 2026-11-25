// Turns what the body read (offsets from itself, counts, names) into the observation the mind gets:
// words and bands, handles, inside a size budget. The one place a number leaves the body for the mind is `pos`
// (D12: it plans a strip mine by y and by x and z); everything else stays a band or a word. Pure, so the budget and
// that rule are tested on made-up input.
import { directionWords, distanceBand, type healthBand } from "./bands";
import { fitBudget } from "./budget";
import type { Standing } from "./standing";

export const OBSERVATION_MAX_CHARS = 1200;

interface Offset {
  dx: number;
  dy: number;
  dz: number;
}

export interface RawEntity extends Offset {
  handle: string;
  what: string; // a player's name or the mob's type, never a custom name
  kind: "player" | "hostile" | "other";
  hp?: ReturnType<typeof healthBand>;
  water?: boolean; // a fish or squid: told as one line per kind, not one each
}
export interface RawBlock extends Offset {
  handle: string;
  what: string;
  has?: string; // a chest of its own: what it last saw in it
}
export interface RawSense {
  pos: { x: number; y: number; z: number }; // the cell the feet are in
  biome: string | null;
  under: string | null; // the block under the feet
  light: number | null; // block light at the head, 0 to 15
  health: number | null;
  food: number | null;
  armor: number;
  time: string | null; // null away from the overworld
  weather: string;
  where: string;
  held: string | null;
  items: Array<{ name: string; count: number }>;
  tools: Array<{ name: string; left: number }>;
  entities: RawEntity[]; // nearest first within a kind
  blocks: RawBlock[];
  standing?: Standing; // what it stands in, when not plain ground
  stone?: Offset; // the nearest natural stone it may dig, in view
  refused: Array<{ dx: number; dz: number; r: number }>; // places the server undid its digs, nearest first
  places: Array<{ name: string; leads?: "up" | "down"; yours?: boolean } & Offset> | null; // null away from the overworld; `leads` is the dug stair's
}

export interface Observation {
  pos: { x: number; y: number; z: number };
  biome?: string;
  under?: string;
  light?: number;
  health: number | null;
  food: number | null;
  armor?: number;
  time?: string;
  weather: string;
  where: string;
  in?: Standing;
  held: string | null;
  inv: Record<string, number>;
  tools?: string[];
  near: Array<Record<string, string>>;
  blocks: Array<Record<string, string>>;
  stone?: string;
  places?: Record<string, string>;
  refused?: Array<{ d: string; dir: string }>;
  more?: Record<string, number>; // how many were left off each list to fit
}

const words = ({ dx, dy, dz }: Offset) => ({ d: distanceBand(Math.hypot(dx, dy, dz)), dir: directionWords(dx, dy, dz) });

const placeWords = (o: Offset): string => {
  const { d, dir } = words(o);
  return d === "here" ? "here" : `${d} ${dir}`;
};

// players and hostile mobs ahead of the rest, then by distance, so a trim drops far animals first
const RANK = { player: 0, hostile: 1, other: 2 };
const byDistance = (a: Offset, b: Offset) => Math.hypot(a.dx, a.dy, a.dz) - Math.hypot(b.dx, b.dy, b.dz);

// Fish and squid come as one line per kind, a count and the nearest band, after everything else so a trim drops
// them first. They carry a handle only when there is nothing else in `near`: a school is not worth pointing at.
export function waterLines(water: readonly RawEntity[], withHandle: boolean): Array<Record<string, string>> {
  const kinds = new Map<string, RawEntity[]>();
  for (const e of [...water].sort(byDistance)) kinds.set(e.what, [...(kinds.get(e.what) ?? []), e]);
  return [...kinds.values()].map((group) => {
    const nearest = group[0];
    const w = words(nearest);
    return {
      ...(withHandle && nearest.handle && { h: nearest.handle }),
      what: group.length > 1 ? `${nearest.what} x${group.length}` : nearest.what,
      ...(group.length === 1 && { dir: w.dir }),
      d: w.d,
    };
  });
}

export function compose(raw: RawSense, max = OBSERVATION_MAX_CHARS): Observation {
  const entities = [...raw.entities].filter((e) => !e.water).sort((a, b) => RANK[a.kind] - RANK[b.kind] || byDistance(a, b));
  const fish = raw.entities.filter((e) => e.water);
  const lists = {
    near: [
      ...entities.map((e) => ({
        h: e.handle,
        what: e.what,
        ...(e.kind !== "other" && { k: e.kind }),
        ...words(e),
        ...(e.hp && e.hp !== "full" && { hp: e.hp }),
      })),
      ...waterLines(fish, entities.length === 0),
    ],
    blocks: [...raw.blocks].sort(byDistance).map((b) => ({ h: b.handle, what: b.what, ...(b.has && { has: b.has }), ...words(b) })),
    refused: raw.refused.map(({ dx, dz, r }) => ({ d: distanceBand(Math.max(0, Math.hypot(dx, dz) - r)), dir: directionWords(dx, 0, dz) })),
    tools: raw.tools.map((t) => `${t.name} ${t.left}%`),
    inv: [...raw.items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };

  const { out } = fitBudget(
    lists,
    (l, trimmed): Observation => ({
      pos: raw.pos,
      ...(raw.biome && { biome: raw.biome }),
      ...(raw.under && { under: raw.under }),
      ...(raw.light !== null && { light: raw.light }),
      health: raw.health,
      food: raw.food,
      ...(raw.armor > 0 && { armor: raw.armor }),
      ...(raw.time && { time: raw.time }),
      weather: raw.weather,
      where: raw.where,
      ...(raw.standing && { in: raw.standing }),
      held: raw.held,
      inv: Object.fromEntries(l.inv.map((i) => [i.name, i.count])),
      ...(l.tools.length > 0 && { tools: l.tools }),
      near: l.near,
      blocks: l.blocks,
      ...(raw.stone && { stone: placeWords(raw.stone) }),
      ...(raw.places && {
        places: Object.fromEntries(raw.places.map((p) => [p.name, p.leads ? `${placeWords(p)}, the stair you dug, ${p.leads}` : p.yours ? `your base, ${placeWords(p)}` : placeWords(p)])),
      }),
      ...(l.refused.length > 0 && { refused: l.refused }),
      ...(Object.keys(trimmed).length > 0 && { more: { ...trimmed } }),
    }),
    max
  );
  return out;
}
