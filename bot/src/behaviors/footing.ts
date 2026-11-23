// Where the body last stood on dry ground. Kept in the body only, so a swim out of water that starts far from any
// bank can still head for ground it knows (bank.ts findRouteBack). Updated by the hazard tick, which looks every 100 ms.
import type { Pos } from "./hazard";

const FORGET_MS = 10 * 60_000;
let spot: { at: Pos; when: number } | null = null;

export function noteFooting(p: Pos, now: number = Date.now()): void {
  spot = { at: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, when: now };
}

export function lastFooting(now: number = Date.now()): Pos | null {
  return spot && now - spot.when <= FORGET_MS ? spot.at : null;
}

export function forgetFooting(): void {
  spot = null;
}
