// Health loss as an event: the mind that waits has to wake when the body is being hurt, and know by what.
// This half is pure: the cause in words and the rate limit. hurt-watch.ts reads the body.
import { mobList } from "./reflex-words";

export interface HurtContext {
  hazard: "lava" | "fire" | "burning" | "drowning" | null;
  burning: boolean; // the entity flags say on fire
  drowning: boolean; // head under water with no air left
  falling: boolean; // landed from a fall that hurts, just now
  mobs: string[]; // hostile kinds that were close in the last moment, nearest first
  food: number;
}

// the cause of a loss of health, in words with no number
export function hurtCause(c: HurtContext): string {
  if (c.hazard === "lava") return "in lava";
  if (c.hazard === "fire" || c.hazard === "burning" || c.burning) return "burning";
  if (c.hazard === "drowning" || c.drowning) return "drowning";
  if (c.falling) return "falling";
  if (c.mobs.length > 0) return `hurt by ${mobList(c.mobs.slice(0, 1))}`;
  if (c.food <= 0) return "starving";
  return "hurt by something";
}

export const GATE_MS = 3000; // one event per cause in this long: a creeper blast is one wake, not twenty
export const CHANGE_MS = 1000; // a different cause may speak sooner
export const LOW_HEALTH = 6; // crossing under this always speaks

// whether a loss of health is worth an event now
export class HurtGate {
  private at = -Infinity;
  private cause = "";
  private health = 20;

  offer(cause: string, health: number, now: number): boolean {
    const since = now - this.at;
    const crossed = health <= LOW_HEALTH && this.health > LOW_HEALTH;
    const ok = crossed || since >= GATE_MS || (cause !== this.cause && since >= CHANGE_MS);
    if (ok) {
      this.at = now;
      this.cause = cause;
      this.health = health;
    }
    return ok;
  }

  // a heal or a respawn starts the gate over
  reset(): void {
    this.at = -Infinity;
    this.health = 20;
  }
}

