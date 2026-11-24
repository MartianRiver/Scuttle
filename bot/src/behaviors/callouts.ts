// What the body says while it guards. Fixed phrases only: nothing a model or a player wrote ever
// reaches chat from here, the player name is the one already checked against the API's name rule.

const MOB_WORD: Record<string, string> = {
  zombie: "Zombie",
  husk: "Zombie",
  drowned: "Zombie",
  zombie_villager: "Zombie",
  skeleton: "Skeleton",
  stray: "Skeleton",
  bogged: "Skeleton",
  spider: "Spider",
  cave_spider: "Spider",
  creeper: "Creeper",
};

const word = (mobName: string): string => MOB_WORD[mobName] ?? "Something nasty";

export function warnLine(mobName: string, player: string): string {
  return `${word(mobName)} near you, ${player}!`;
}

export const clearLine = (player: string): string => `All clear, ${player}.`;

export const CALLOUT_GAP_MS = 5000; // at most one line this often, whatever happens
const QUIET_MS = 2000; // no threat this long before a fight counts as over

// One line per mob, one every 5 s, one all-clear per fight. An all-clear that is blocked by the gap
// waits for it instead of being dropped, and a new threat cancels it.
export class CalloutLimiter {
  private said = new Set<number>();
  private lastAt = -Infinity;
  private fought = false;
  private quietSince: number | null = null;
  private before: { said: Set<number>; lastAt: number; fought: boolean; quietSince: number | null } | null = null;

  // `mobs` are the hostile mobs near the ward right now; returns the line to say, if any
  next(now: number, mobs: Array<{ id?: number; name: string }>, player: string): string | null {
    this.before = { said: new Set(this.said), lastAt: this.lastAt, fought: this.fought, quietSince: this.quietSince };
    if (mobs.length > 0) {
      this.fought = true;
      this.quietSince = null;
      if (now - this.lastAt < CALLOUT_GAP_MS) return null;
      // a creeper is the one to hear about first
      const fresh = mobs
        .filter((m) => m.id !== undefined && !this.said.has(m.id))
        .sort((a, b) => Number(b.name === "creeper") - Number(a.name === "creeper"))[0];
      if (!fresh || fresh.id === undefined) return null;
      this.said.add(fresh.id);
      this.lastAt = now;
      return warnLine(fresh.name, player);
    }
    if (!this.fought) return null;
    this.quietSince ??= now;
    if (now - this.quietSince < QUIET_MS || now - this.lastAt < CALLOUT_GAP_MS) return null;
    this.fought = false;
    this.said.clear();
    this.lastAt = now;
    return clearLine(player);
  }

  // the line next() just gave was never said (the speech clock dropped it): as if it hadn't been asked, so a later
  // tick tries again instead of the warning or the all-clear being lost
  unsay(): void {
    if (!this.before) return;
    ({ said: this.said, lastAt: this.lastAt, fought: this.fought, quietSince: this.quietSince } = this.before);
    this.before = null;
  }
}
