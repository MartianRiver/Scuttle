// The whole access shaft dug for real, then the landing kit, a restart and the walk both ways: about twelve minutes, so it only
// runs when named: --file=minefull.manual. The quick
// scenarios in mine.scenario.ts start from a shaft cut by fill instead. Same column as strip's.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { go, said } from "./handsb.scenario";
import { checkpoint, feet, tidy, X0, Z0, TOP } from "./strip.scenario";
import { restartBot, type BodyEvent, type Ctx, type Observation, type Pos, type Scenario } from "./lib";

const siteFile = (c: Ctx) => path.join(process.cwd(), ".auth-cache", `sites-${c.bot}.json`);

const full: Scenario = (() => {
  let first: BodyEvent | null = null;
  let second: BodyEvent | null = null;
  let kit: BodyEvent | null = null;
  let foot: Pos = { x: 0, y: 0, z: 0 };
  let site: { shaft: Pos[]; landing: Pos | null; kit: Record<string, Pos> } | null = null;
  let torches = 0;
  let places: Observation["places"];
  let up: BodyEvent | null = null;
  let down: BodyEvent | null = null;
  let top: Pos = { x: 0, y: 0, z: 0 };
  let end: Pos = { x: 0, y: 0, z: 0 };
  return {
    name: "mine: dig_shaft to -50 in two calls records every step, make_mine sets the landing, and after a restart go_to shaft and go_to mine walk the whole length",
    timeoutMs: 2_400_000,
    view: { x: X0, y: 75, z: Z0 },
    async setup(c) {
      rmSync(siteFile(c), { force: true });
      await restartBot(c); // no mine in memory from an earlier scenario
      await checkpoint(c, ["iron_pickaxe 1", "iron_pickaxe 1", "torch 48", "bread 8", "chest 1", "crafting_table 1", "furnace 1"]);
    },
    async act(c) {
      first = (await go(c, { intent: "dig_shaft", to: -50, torches: true }, 700_000)).end;
      second = (await go(c, { intent: "dig_shaft", to: -50, torches: true }, 700_000)).end;
      foot = await feet(c);
      kit = (await go(c, { intent: "make_mine" }, 180_000)).end;
      site = JSON.parse(readFileSync(siteFile(c), "utf8")).mine;
      // a torch is a wall torch in a stair cell, one every few steps
      for (let x = X0; x <= foot.x; x += 16) torches += await c.world.countBlocks({ x, y: TOP - (x - X0) - 17, z: Z0 }, { x: x + 15, y: TOP - (x - X0) + 3, z: Z0 }, "wall_torch");
      await restartBot(c);
      places = (await c.body.send({ intent: "observe" })).observation?.places;
      up = (await go(c, { intent: "go_to", handle: "shaft" }, 900_000)).end;
      top = await feet(c);
      down = (await go(c, { intent: "go_to", handle: "mine" }, 900_000)).end;
      end = await feet(c);
    },
    async verify(c) {
      c.check(first?.event === "task_finished" && /sixty-four steps down, not at the depth yet/.test(String(first.detail ?? "")), `the first call stops at sixty-four steps (${said(first)})`);
      c.check(second?.event === "task_finished" && /at the depth asked/.test(String(second.detail ?? "")), `the second goes on from the foot and finishes (${said(second)})`);
      c.check(foot.y === -50 && foot.x === X0 + (TOP + 50), `it stands on y -50 (${JSON.stringify(foot)})`);
      c.check(site?.shaft.length === TOP + 50 + 1 && site.shaft[0].x === X0 && site.shaft[site.shaft.length - 1].y === -50, `the site file has every step (${site?.shaft.length})`);
      c.check(torches >= 12, `with torches on the way (${torches})`);
      c.check(kit?.event === "task_finished", `make_mine finished at the depth (${said(kit)})`);
      c.check(!!site?.landing && !!site.kit.chest && !!site.kit.table && !!site.kit.furnace, `and the landing and its kit are in the file (${JSON.stringify(site?.kit)})`);
      c.check(existsSync(siteFile(c)) && !!places?.shaft && !!places.mine, `after a restart the shaft and the mine are places (${JSON.stringify(places)})`);
      c.check(up?.event === "task_finished" && Math.hypot(top.x - X0, top.z - Z0) <= 3 && Math.abs(top.y - TOP) <= 1, `go_to shaft climbs the whole shaft (${said(up)}, ${JSON.stringify(top)})`);
      c.check(down?.event === "task_finished" && end.y === -50 && Math.abs(end.x - foot.x) <= 3, `and go_to mine goes all the way down again (${said(down)}, ${JSON.stringify(end)})`);
    },
    async cleanup(c) {
      await tidy(c, 540);
      rmSync(siteFile(c), { force: true });
      await restartBot(c);
    },
  };
})();

export default full;
