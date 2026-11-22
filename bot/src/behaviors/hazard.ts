// The decision half of the self-preservation reflex: what the body is standing in, and the nearest
// cell that is better. Free of mineflayer, so the logic is testable on a made-up grid.

export type Hazard = "lava" | "fire" | "drowning" | "burning";

export interface Sense {
  inLava: boolean;
  inFire: boolean;
  headInWater: boolean;
  feetInWater: boolean;
  oxygen: number; // 0..20, 20 when the server has said nothing
  burning: boolean; // recently in lava or fire, and not yet in water
}

export interface Cell {
  solid: boolean;
  fluid: "water" | "lava" | null;
  fire: boolean;
}

export type Grid = (x: number, y: number, z: number) => Cell;
export interface Pos {
  x: number;
  y: number;
  z: number;
}

// air runs out at 20 and drowning starts at 0, so there is time; swimming up starts well before the end
const BREATH_LOW = 12;

// `prev` keeps a drowning rescue going until the body is out of the water, not just until it has air
export function classify(s: Sense, prev: Hazard | null = null): Hazard | null {
  if (s.inLava) return "lava";
  if (s.inFire) return "fire";
  if (s.headInWater && s.oxygen <= BREATH_LOW) return "drowning";
  if (prev === "drowning" && s.feetInWater) return "drowning";
  if (s.burning) return "burning";
  return null;
}

const standable = (g: Grid, x: number, y: number, z: number): boolean => {
  const feet = g(x, y, z);
  const head = g(x, y + 1, z);
  const floor = g(x, y - 1, z);
  return !feet.solid && !head.solid && feet.fluid === null && !feet.fire && floor.solid && floor.fluid !== "lava";
};

// Nearest cell to head for: dry standing room for lava, fire and drowning, water to put out a burn.
export function findCell(hazard: Hazard, g: Grid, from: Pos, radius = 8): Pos | null {
  const x0 = Math.floor(from.x);
  const y0 = Math.floor(from.y);
  const z0 = Math.floor(from.z);
  let best: Pos | null = null;
  let bestD = Infinity;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -2; dy <= radius; dy++) {
        const x = x0 + dx;
        const y = y0 + dy;
        const z = z0 + dz;
        const ok = hazard === "burning" ? g(x, y, z).fluid === "water" : standable(g, x, y, z);
        if (!ok) continue;
        const d = dx * dx + dz * dz + dy * dy * 2; // going up is slower than going sideways
        if (d < bestD) {
          bestD = d;
          best = { x, y, z };
        }
      }
    }
  }
  return best;
}

// Out of lava or fire, or off a burn: water close by does both at once, otherwise dry standing room.
export function findEscape(hazard: Hazard, g: Grid, from: Pos): Pos | null {
  if (hazard === "drowning") return findCell("drowning", g, from);
  return findCell("burning", g, from, 6) ?? findCell("lava", g, from);
}
