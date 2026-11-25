import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPhysicsRounding } from "../src/lib/physics-fix";

const AABB = require("prismarine-physics/lib/aabb");
const body = (x: number, y: number, z: number) => new AABB(-0.3, 0, -0.3, 0.3, 1.8, 0.3).offset(x, y, z);

test("unpatched, a body at x 512.3 slides into the block behind the face at 512 (the bug the patch is for)", () => {
  const wall = new AABB(511, 60, 400, 512, 61, 401);
  assert.ok(512.3 - 0.3 < 512);
  assert.ok(wall.computeOffsetX(body(512.3, 60, 400.5), -0.0255) < 0);
});

test("patched, the same push stops at the face, from both sides and on the other axes", () => {
  fixPhysicsRounding();
  const west = new AABB(511, 60, 400, 512, 61, 401);
  assert.equal(west.computeOffsetX(body(512.3, 60, 400.5), -0.0255), 0);
  const east = new AABB(-512, 60, 400, -511, 61, 401); // the mirror: the body's east side against a face at -512
  assert.ok(-512.3 + 0.3 > -512);
  assert.equal(east.computeOffsetX(body(-512.3, 60, 400.5), 0.05), 0);
  const north = new AABB(400, 60, 511, 401, 61, 512);
  assert.equal(north.computeOffsetZ(body(400.5, 60, 512.3), -0.05), 0);
  const floor = new AABB(400, 59, 400, 401, 60, 401);
  assert.ok(Math.abs(floor.computeOffsetY(body(400.5, 60.2, 400.5), -1) + 0.2) < 1e-9);
});

test("patched, a body free of the block is not held and a gap closes exactly", () => {
  fixPhysicsRounding();
  const wall = new AABB(511, 60, 400, 512, 61, 401);
  assert.equal(wall.computeOffsetX(body(513.3, 60, 400.5), -0.05), -0.05);
  assert.ok(Math.abs(wall.computeOffsetX(body(512.5, 60, 400.5), -1) + 0.2) < 1e-9);
  assert.equal(wall.computeOffsetX(body(512.3, 62, 400.5), -0.05), -0.05); // over the top of it
  assert.equal(wall.computeOffsetX(body(512.3, 60, 405.5), -0.05), -0.05); // beside it
});
