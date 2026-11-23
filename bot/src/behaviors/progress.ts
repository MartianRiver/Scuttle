// When a running task says where it is: on a change of step, and at least every PERIOD_MS while one
// step goes on. A change is held back for MIN_GAP_MS after the last line, so a step that flaps (a meal
// in the middle of mining) does not make a line each time. Pure and clock-injected.
export const PERIOD_MS = 15_000;
export const MIN_GAP_MS = 2_000;

export class ProgressGate {
  private last = -Infinity;
  private step = "";

  offer(step: string, now: number): boolean {
    const since = now - this.last;
    if (!((step !== this.step && since >= MIN_GAP_MS) || since >= PERIOD_MS)) return false;
    this.last = now;
    this.step = step;
    return true;
  }
}
