// How a task or walk says why it ended: the reason the API reports, plus words about the cause. The
// dispatcher copies `detail` (and `got`, which the task runner adds) onto the task_failed event.
export interface FailInfo {
  detail?: string; // words only, no digits
  got?: Record<string, number>; // items gained in the run, by name
  missing?: Record<string, number>; // a craft that was short: what it lacked
}

export class TaskError extends Error implements FailInfo {
  constructor(
    readonly reason: string,
    readonly detail?: string,
    readonly missing?: Record<string, number>
  ) {
    super(reason);
  }
}
