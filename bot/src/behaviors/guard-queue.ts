// Who waits for the guard while someone else has it. Pure: the dispatcher asks it what a request or a
// stop means and does the rest (events, speech, starting the next guard).

export const QUEUE_CAP = 4;

export type Ask = "start" | "same" | "waiting" | "queued" | "full";
export type StopAction = "dequeue" | "handover" | "all";

export class GuardQueue {
  private line: string[] = [];

  get size(): number {
    return this.line.length;
  }

  // `ward` is who the body guards now, null when nobody
  ask(ward: string | null, player: string): Ask {
    if (ward === null) return "start";
    if (player === ward) return "same";
    if (this.line.includes(player)) return "waiting";
    if (this.line.length >= QUEUE_CAP) return "full";
    this.line.push(player);
    return "queued";
  }

  // `speaker` is undefined for a stop over the API, which stops everything and empties the queue
  stop(ward: string | null, speaker: string | undefined): StopAction {
    if (speaker !== undefined) {
      if (speaker === ward) return "handover";
      const at = this.line.indexOf(speaker);
      if (at >= 0) {
        this.line.splice(at, 1);
        return "dequeue";
      }
    }
    this.line = [];
    return "all";
  }

  // the first waiting player `here` says is in view; those who are gone are dropped on the way
  next(here: (player: string) => boolean): string | null {
    while (this.line.length > 0) {
      const player = this.line.shift() as string;
      if (here(player)) return player;
    }
    return null;
  }

  clear(): void {
    this.line = [];
  }
}
