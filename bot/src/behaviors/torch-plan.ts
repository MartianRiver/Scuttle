// When a stair or tunnel sets a torch down: one on a wall every few blocks of travel, and one at the start when the
// light there is low. Pure, so the pacing is tested without a world; the cell is put-plan's `wall` choice.
import { numberWords } from "./dig-down-plan";

export const TORCH_EVERY = 8; // blocks of travel between torches
export const DARK_BELOW = 8; // block light under this at the start earns a torch there

export class TorchPacer {
  private owed: boolean;
  private travel = 0;
  private dry: number | null = null; // blocks since the last torch when it first had none to set

  constructor(lightAtStart: number | null, private readonly every = TORCH_EVERY) {
    this.owed = lightAtStart !== null && lightAtStart < DARK_BELOW;
  }

  // a block of travel
  step(): void {
    this.travel++;
    if (this.travel >= this.every) this.owed = true;
  }

  // a torch is due: set one now, and again on the next block while it could not be
  due(): boolean {
    return this.owed && this.dry === null;
  }

  placed(): void {
    this.owed = false;
    this.travel = 0;
  }

  // it was due and it carries none
  outOfTorches(): void {
    this.dry ??= this.travel;
  }

  get ranOut(): boolean {
    return this.dry !== null;
  }

  // "out of torches six blocks back": the dark stretch since the last one, as the run ends
  words(): string | null {
    return this.dry === null ? null : `out of torches ${numberWords(this.travel)} ${this.travel === 1 ? "block" : "blocks"} back`;
  }
}

// the ending's detail with the torch note added
export const withTorchNote = (detail: string, pacer: TorchPacer | null): string => {
  const note = pacer?.words();
  return note ? `${detail}, ${note}` : detail;
};
