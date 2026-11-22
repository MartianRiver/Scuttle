// Fight or run: every number the body fights by, in one place. Pure, so it is tested without a game.
// The defaults are a first pick (River left the policy to us, 2026-11-23); 0.4.7 is where the mind
// gets to shape them.

import type { Mob } from "./danger";

// read on the 26.3 test server with /attribute, 2026-11-23. No mace: its damage comes from falling first
export const WEAPONS: Record<string, { damage: number; speed: number }> = {
  wooden_sword: { damage: 4, speed: 1.6 },
  golden_sword: { damage: 4, speed: 1.6 },
  stone_sword: { damage: 5, speed: 1.6 },
  iron_sword: { damage: 6, speed: 1.6 },
  diamond_sword: { damage: 7, speed: 1.6 },
  netherite_sword: { damage: 8, speed: 1.6 },
  wooden_axe: { damage: 7, speed: 0.8 },
  stone_axe: { damage: 9, speed: 0.8 },
  iron_axe: { damage: 9, speed: 0.9 },
  golden_axe: { damage: 7, speed: 1 },
  diamond_axe: { damage: 9, speed: 1 },
  netherite_axe: { damage: 10, speed: 1 },
  trident: { damage: 9, speed: 1.1 },
};
export const FIST = { damage: 1, speed: 4 };

// helmet, chestplate, leggings, boots; same source and date
const ARMOUR: Record<string, number[]> = {
  leather: [1, 3, 2, 1],
  copper: [2, 4, 3, 1],
  golden: [2, 5, 3, 1],
  chainmail: [2, 5, 4, 1],
  iron: [2, 6, 5, 2],
  diamond: [3, 8, 6, 3],
  netherite: [3, 8, 6, 3],
};
const PIECES = ["helmet", "chestplate", "leggings", "boots"];

export const POLICY = {
  fightFrom: 12, // health needed to start a fight
  retreatBelow: 8, // a fight under way turns into running below this; it starts again only from fightFrom
  rangedFrom: 14, // a lone skeleton is closed on only this healthy
  maxMelee: 2, // melee mobs at once
  maxMeleeArmoured: 3,
  armouredAt: 10, // armour points
  chase: 8, // blocks: a target further off is waited for, a ranged one is run from
  reach: 3, // attack reach, from the eyes
  cooldownJitter: 0.15, // each swing waits the full cooldown plus up to this much of it
  sweepClear: 2.5, // blocks from the target a bystander must be before a sword swings
};

// mobs that walk up and hit: worth standing for
const MELEE = new Set(["zombie", "husk", "drowned", "zombie_villager", "spider", "cave_spider", "silverfish", "endermite", "slime", "magma_cube"]);
// shoot from range: closed on only one at a time
const RANGED = new Set(["skeleton", "stray", "bogged"]);
// never attacked: hitting one brings the rest (they still count as a threat for running)
const NEUTRAL = new Set(["enderman", "zombified_piglin", "piglin"]);
// everything else hostile (creepers, blazes, witches, vindicators, wardens...) is run from

export function armourPoints(worn: string[]): number {
  let total = 0;
  for (const name of worn) {
    if (name === "turtle_helmet") total += 2;
    const [material, piece] = name.split("_");
    const slot = PIECES.indexOf(piece);
    if (slot >= 0 && ARMOUR[material]) total += ARMOUR[material][slot];
  }
  return total;
}

// Who a sweep must not touch: players, pets and other animals, villagers, golems, neutrals. Not the
// mobs being fought, not projectiles or items.
export function isBystander(type: string, name: string): boolean {
  if (type === "player" || NEUTRAL.has(name)) return true;
  if (type === "other" || type === "projectile" || type === "hostile") return false;
  return !MELEE.has(name) && !RANGED.has(name);
}

// A full-charge sword hit on the ground sweeps the entities around the target for 1 health
// (minecraft.wiki Melee attack, Sword, read 2026-11-23; the radius, about a block round the target, is
// not on those pages). With a bystander that close it takes a weapon that doesn't sweep, or waits.
export function weaponFor(items: string[], bystanderNear: boolean): string | null | "wait" {
  const best = bestWeapon(items);
  if (!bystanderNear || !best?.endsWith("_sword")) return best;
  return bestWeapon(items.filter((n) => !n.endsWith("_sword"))) ?? "wait";
}

// the weapon that does the most damage over time, or null for bare hands
export function bestWeapon(items: string[]): string | null {
  let best: string | null = null;
  let bestRate = 0;
  for (const name of items) {
    const w = WEAPONS[name];
    if (w && w.damage * w.speed > bestRate) {
      best = name;
      bestRate = w.damage * w.speed;
    }
  }
  return best;
}

// how long a full swing takes to charge, plus the jitter
export function cooldownMs(weapon: string | null, random: () => number = Math.random): number {
  const speed = (weapon && WEAPONS[weapon]?.speed) || FIST.speed;
  return (1000 / speed) * (1 + random() * POLICY.cooldownJitter);
}

export interface Fighter {
  health: number;
  weapon: string | null;
  armour: number;
  x: number;
  y: number;
  z: number;
}

export type Stance = { act: "fight"; target: Mob } | { act: "flee"; why: string };

const dist = (f: Fighter, m: Mob) => Math.hypot(m.x - f.x, m.y - f.y, m.z - f.z);

// `fighting` is whether the body is fighting now: it keeps on down to retreatBelow, but starts only
// from fightFrom
export function chooseStance(self: Fighter, threats: Mob[], fighting: boolean): Stance {
  if (!self.weapon) return { act: "flee", why: "bare hands" };
  if (self.health < (fighting ? POLICY.retreatBelow : POLICY.fightFrom)) return { act: "flee", why: "low health" };
  const other = threats.find((m) => !MELEE.has(m.name) && !RANGED.has(m.name));
  if (other) return { act: "flee", why: NEUTRAL.has(other.name) ? `${other.name} is left alone` : `${other.name} is not fought` };

  const byDistance = [...threats].sort((a, b) => dist(self, a) - dist(self, b));
  const ranged = byDistance.filter((m) => RANGED.has(m.name));
  if (ranged.length > 0) {
    if (threats.length > 1) return { act: "flee", why: "a skeleton and company" };
    if (self.health < (fighting ? POLICY.retreatBelow : POLICY.rangedFrom)) return { act: "flee", why: "too hurt for a skeleton" };
    if (dist(self, ranged[0]) > POLICY.chase) return { act: "flee", why: "skeleton out of reach" };
    return { act: "fight", target: ranged[0] };
  }
  const most = self.armour >= POLICY.armouredAt ? POLICY.maxMeleeArmoured : POLICY.maxMelee;
  if (threats.length > most) return { act: "flee", why: "outnumbered" };
  return { act: "fight", target: byDistance[0] };
}
