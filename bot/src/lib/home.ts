import { Vec3 } from "vec3";

// fixed coordinates in the home base above the shop (world-kids), placed 2026-09-11.
// scuttle-home is a WorldGuard region owned by ScuttleMC — no flags needed, ownership alone
// keeps kids out of the chests/doors, same mechanism ClaimBook relies on for kid claims.
export const home = {
  bed: [new Vec3(4, 68, -28), new Vec3(3, 68, -28)] as [Vec3, Vec3],
  // where gathered raw materials/finished goods get dropped off
  stashChests: [new Vec3(-4, 68, -28), new Vec3(4, 68, -25), new Vec3(4, 68, -24)],
  furnaces: [new Vec3(1, 68, -23), new Vec3(-1, 68, -23)],
  craftingTable: new Vec3(0, 68, -23),
};
