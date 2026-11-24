// What is over the body's head, for the observation's `where`: whether it is under rock, and how far below the open
// air. Pure, on a column of cell kinds, so it is tested without a world.

export type Over = "rock" | "open" | "foliage" | "made";

export const COVER_SCAN = 40; // cells looked at above the head
export const COVER_MIN = 3; // more than two solid blocks over it

// `column` runs up from the cell over the head (the feet are two below its first). null when it is not under rock:
// fewer than three solid blocks over it, or a player's build among them (a roof is not a hill). Leaves and logs are a tree
// and do not count. Otherwise how many blocks down it is from the top of that rock, which is what depthWords takes.
export function coverDepth(column: readonly Over[]): number | null {
  if (column.includes("made")) return null;
  const rock = column.filter((c) => c === "rock").length;
  if (rock < COVER_MIN) return null;
  return column.lastIndexOf("rock") + 3;
}
