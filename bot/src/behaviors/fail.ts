// How a task or walk says why it ended: the reason the API reports, plus words about the cause. The
// dispatcher copies `detail` (and `got`, which the task runner adds) onto the task_failed event.
export interface FailInfo {
  detail?: string; // words only, no digits
  got?: Record<string, number>; // items gained in the run, by name
}

export class TaskError extends Error implements FailInfo {
  constructor(
    readonly reason: string,
    readonly detail?: string
  ) {
    super(reason);
  }
}
