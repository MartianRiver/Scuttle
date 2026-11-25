// Whether a sheep can be shorn, from what the server says about it: the entity's name and its metadata, with the
// slots found by key name (minecraft-data lists them per entity, so a version that moves them does not break this).
// Pure and tested; shear.ts is the walk and the shears.

export interface SheepRead {
  baby: boolean;
  sheared: boolean;
}

// the sheep's wool byte: bits 0 to 3 are the colour, bit 4 is "sheared"
export const SHEARED_BIT = 0x10;

// `keys` is the registry's metadataKeys for a sheep. A slot the server did not send holds its default (an adult with wool)
export function readSheep(metadata: readonly unknown[] | undefined, keys: readonly string[] | undefined): SheepRead | null {
  const baby = keys?.indexOf("baby") ?? -1;
  const wool = keys?.indexOf("wool") ?? -1;
  if (baby < 0 || wool < 0) return null;
  const b = metadata?.[baby];
  const w = metadata?.[wool];
  return { baby: b === true || b === 1, sheared: typeof w === "number" && (w & SHEARED_BIT) !== 0 };
}

export type ShearRefusal = { reason: string; detail: string };

// null when it can be shorn; `read` is null for a sheep whose slots cannot be read
export function shearRefusal(name: string | undefined, read: SheepRead | null): ShearRefusal | null {
  if (name !== "sheep") return { reason: "not_allowed", detail: "it only shears sheep" };
  if (!read) return { reason: "stuck", detail: "it cannot tell if the sheep has wool" };
  if (read.baby) return { reason: "refused", detail: "a lamb has no wool to take" };
  if (read.sheared) return { reason: "no_wool", detail: "that sheep has been shorn and its wool has not grown back" };
  return null;
}

export const isWool = (name: string): boolean => name.endsWith("_wool");
