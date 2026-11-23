// Line of sight over a grid of blocks, so what the observation lists is what a player standing in
// the bot's boots could see, not what mineflayer happens to have loaded. Pure: the caller says which
// cells are opaque (and treats an unloaded cell as opaque).

export interface Vec {
  x: number;
  y: number;
  z: number;
}
export type Opaque = (x: number, y: number, z: number) => boolean;

// true when no opaque cell lies strictly between the cell holding `from` and the cell holding `to`
// (voxel walk after Amanatides and Woo; both end cells are left to the caller)
export function rayClear(from: Vec, to: Vec, opaque: Opaque): boolean {
  let x = Math.floor(from.x);
  let y = Math.floor(from.y);
  let z = Math.floor(from.z);
  const ex = Math.floor(to.x);
  const ey = Math.floor(to.y);
  const ez = Math.floor(to.z);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);
  const next = (p: number, d: number, s: number, c: number) => (d === 0 ? Infinity : (c + (s > 0 ? 1 : 0) - p) / d);
  // an axis already at its end cell never steps again, whatever the rounding says
  let tx = x === ex ? Infinity : next(from.x, dx, sx, x);
  let ty = y === ey ? Infinity : next(from.y, dy, sy, y);
  let tz = z === ez ? Infinity : next(from.z, dz, sz, z);
  const stepX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const stepY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const stepZ = dz === 0 ? Infinity : Math.abs(1 / dz);

  const cells = Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z);
  for (let i = 0; i < cells; i++) {
    if (tx <= ty && tx <= tz) {
      x += sx;
      tx = x === ex ? Infinity : tx + stepX;
    } else if (ty <= tz) {
      y += sy;
      ty = y === ey ? Infinity : ty + stepY;
    } else {
      z += sz;
      tz = z === ez ? Infinity : tz + stepZ;
    }
    if (x === ex && y === ey && z === ez) return true;
    if (opaque(x, y, z)) return false;
  }
  return true;
}

// an entity is seen when the eye reaches its feet, middle or head
export function entityVisible(eye: Vec, feet: Vec, height: number, opaque: Opaque): boolean {
  return [0.2, height / 2, height * 0.9].some((up) => rayClear(eye, { x: feet.x, y: feet.y + up, z: feet.z }, opaque));
}

const FACES: ReadonlyArray<{ n: readonly [number, number, number]; axis: "x" | "y" | "z" }> = [
  { n: [1, 0, 0], axis: "x" },
  { n: [-1, 0, 0], axis: "x" },
  { n: [0, 1, 0], axis: "y" },
  { n: [0, -1, 0], axis: "y" },
  { n: [0, 0, 1], axis: "z" },
  { n: [0, 0, -1], axis: "z" },
];
const SPOTS = [0.5, 0.15, 0.85]; // across a face: the middle, then near each edge

// A block is seen through one of its faces: the cell beside it is open, the eye is on that side
// of the face, and the eye reaches a point on it. A buried block has no open face, and one behind a
// wall has no clear ray, so neither is ever listed.
export function blockVisible(eye: Vec, block: Vec, opaque: Opaque): boolean {
  for (const { n, axis } of FACES) {
    const [nx, ny, nz] = n;
    if (opaque(block.x + nx, block.y + ny, block.z + nz)) continue;
    const face = { x: block.x + (nx > 0 ? 1 : 0), y: block.y + (ny > 0 ? 1 : 0), z: block.z + (nz > 0 ? 1 : 0) };
    if ((eye[axis] - face[axis]) * (nx + ny + nz) <= 0) continue;
    for (const a of SPOTS) {
      for (const b of SPOTS) {
        // a point just outside the face, inside the open cell
        const p = {
          x: nx ? face.x + nx * 0.01 : block.x + a,
          y: ny ? face.y + ny * 0.01 : block.y + (nx ? a : b),
          z: nz ? face.z + nz * 0.01 : block.z + b,
        };
        if (rayClear(eye, p, opaque)) return true;
      }
    }
  }
  return false;
}

// no open face at all: the cheap test that throws most buried ore out before any ray is cast
export const hasOpenFace = (block: Vec, opaque: Opaque): boolean =>
  FACES.some(({ n }) => !opaque(block.x + n[0], block.y + n[1], block.z + n[2]));
