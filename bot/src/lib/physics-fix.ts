// prismarine-physics decides a block face is behind the body with an exact comparison, so a body pushed flat against a
// wall can be a rounding error inside it: at x 512.3 the box starts at 511.99999999999994, "not behind the face at 512",
// and the next tick walks 0.03 into the stone. The server rejects that ("moved wrongly!") and rubber-bands it, which
// is what stopped the climb at one stair cell (x 512, found 2026-11-25). A scan of x and z to 30000 finds eight faces
// that do it, 2, 32, 512, 8192 and their mirrors; vanilla's own collision allows 1e-7. Applied once, before the bot is made.
export const EPS = 1e-7;

interface Box {
  computeOffsetX(other: Box, offset: number): number;
  computeOffsetY(other: Box, offset: number): number;
  computeOffsetZ(other: Box, offset: number): number;
}
// no types ship with it
const AABB = require("prismarine-physics/lib/aabb") as { prototype: Box };
type Axis = "X" | "Y" | "Z";
const AXES: Record<Axis, [Axis, Axis]> = { X: ["Y", "Z"], Y: ["X", "Z"], Z: ["X", "Y"] };

// how far `other` can move by `offset` along an axis before this box stops it, tolerating a hair of overlap
function computeOffset(self: Box, axis: Axis, other: Box, offset: number): number {
  const b = self as unknown as Record<string, number>;
  const o = other as unknown as Record<string, number>;
  for (const t of AXES[axis]) if (!(o[`max${t}`] > b[`min${t}`] + EPS && o[`min${t}`] < b[`max${t}`] - EPS)) return offset;
  if (offset > 0 && o[`max${axis}`] <= b[`min${axis}`] + EPS) return Math.min(Math.max(b[`min${axis}`] - o[`max${axis}`], 0), offset);
  if (offset < 0 && o[`min${axis}`] >= b[`max${axis}`] - EPS) return Math.max(Math.min(b[`max${axis}`] - o[`min${axis}`], 0), offset);
  return offset;
}

let applied = false;
export function fixPhysicsRounding(): void {
  if (applied) return;
  applied = true;
  const proto = AABB.prototype;
  proto.computeOffsetX = function (other, offset) {
    return computeOffset(this, "X", other, offset);
  };
  proto.computeOffsetY = function (other, offset) {
    return computeOffset(this, "Y", other, offset);
  };
  proto.computeOffsetZ = function (other, offset) {
    return computeOffset(this, "Z", other, offset);
  };
}
