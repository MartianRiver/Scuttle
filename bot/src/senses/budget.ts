// Keeps the observation inside its size budget. Pure.

export type Lists = Record<string, unknown[]>;

// Takes the last item off the longest list until `render(lists, trimmed)` fits in `max` characters
// of JSON, or nothing is left to take. Lists come nearest or most useful first, so the end goes. The
// count taken off each list is handed to `render` so the output can say what was left out.
export function fitBudget<L extends Lists, T>(
  lists: L,
  render: (lists: L, trimmed: Record<string, number>) => T,
  max: number
): { out: T; trimmed: Record<string, number> } {
  const kept = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, [...v]])) as L;
  const trimmed: Record<string, number> = {};
  for (;;) {
    const out = render(kept, trimmed);
    if (JSON.stringify(out).length <= max) return { out, trimmed };
    let longest: string | null = null;
    for (const k of Object.keys(kept)) if (kept[k].length > (longest ? kept[longest].length : 0)) longest = k;
    if (!longest) return { out, trimmed };
    kept[longest].pop();
    trimmed[longest] = (trimmed[longest] ?? 0) + 1;
  }
}
