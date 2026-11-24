// Hands C: `tunnel`, the ore its walls show, `collect` that says why it ended short, `where` underground and the pit fill.
// Facts come from the server (where the body is, what it holds, which blocks are there); what the body says is checked
// against them. Everything is built inside the grove region (x -18..26, z -8..10, y 40..100: a dig anywhere else is undone
// and leaves a refused zone) and put back after, with handsb's helpers.
import { calmHome, go, GROUND, observe, restoreGround, said, stand, strata, SX, SZ, X0, X1, Z0, Z1 } from "./handsb.scenario";
import { sleep, type BodyEvent, type Ctx, type Scenario } from "./lib";

const words = (s: unknown) => typeof s === "string" && s.length > 0 && !/\d/.test(s);

// ---- a hill to dig into ----

// a stone hill on the grass, x 4..16, z -2..2, y 68..71; the body stands west of it at (3, 68, 0)
const START = { x: 3, y: 68, z: 0 };
async function hill(c: Ctx, x1 = 16) {
  await calmHome(c);
  await c.world.run(`fill 4 68 -2 ${x1} 71 2 stone`);
  await c.world.run(`give ${c.bot} stone_pickaxe 1`);
  await c.world.run(`tp ${c.bot} ${START.x}.5 ${START.y} ${START.z}.5 -90 0`);
  await sleep(2500);
}

const view = { x: 0, y: 74, z: 0 };

const blocked: Scenario = (() => {
  let end: BodyEvent | null = null;
  let tunnelWet = -1;
  let source = false;
  let wall = false;
  let health = 0;
  let pos: number[] = [];
  return {
    name: "handsc: a tunnel toward water behind the wall ends blocked before it, and nothing is wet",
    timeoutMs: 150_000,
    view,
    async setup(c) {
      await hill(c);
      await c.world.run("setblock 8 68 0 water");
    },
    async act(c) {
      end = (await go(c, { intent: "tunnel", dir: "east", length: 12 }, 120_000)).end;
      tunnelWet = await c.world.countBlocks({ x: 3, y: 67, z: -1 }, { x: 7, y: 70, z: 1 }, "water");
      source = await c.world.blockIs({ x: 8, y: 68, z: 0 }, "water");
      wall = await c.world.blockIs({ x: 7, y: 68, z: 0 }, "stone");
      health = await c.world.health(c.bot);
      pos = await c.world.pos(c.bot);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "blocked", `blocked (${said(end)})`);
      c.check(/water/.test(String(end?.detail ?? "")) && words(end?.detail), `says water, in words (${end?.detail})`);
      c.check(tunnelWet === 0 && source && wall, `the wall before the water is still there and nothing flowed (wet ${tunnelWet}, source ${source}, wall ${wall})`);
      c.check(health >= 19 && pos[0] >= 5 && pos[0] < 7.9, `it is dry, unhurt and stopped short (health ${health}, x ${pos[0]?.toFixed(1)})`);
      c.check(!!(end?.got as Record<string, number> | undefined)?.cobblestone, `what it dug is in got (${JSON.stringify(end?.got)})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const built: Scenario = (() => {
  let end: BodyEvent | null = null;
  let planks = 0;
  return {
    name: "handsc: a tunnel toward a plank wall ends refused and leaves it alone",
    timeoutMs: 150_000,
    view,
    async setup(c) {
      await hill(c);
      await c.world.run("fill 9 68 -2 9 71 2 oak_planks");
    },
    async act(c) {
      end = (await go(c, { intent: "tunnel", dir: "east", length: 12 }, 120_000)).end;
      planks = await c.world.countBlocks({ x: 9, y: 68, z: -2 }, { x: 9, y: 71, z: 2 }, "oak_planks");
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "refused", `refused (${said(end)})`);
      c.check(/built/.test(String(end?.detail ?? "")) && words(end?.detail), `says a build, in words (${end?.detail})`);
      c.check(planks === 20, `the planks are all there (${planks} of 20)`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const through: Scenario = (() => {
  let end: BodyEvent | null = null;
  let stopEnd: BodyEvent | null = null;
  let listed: Array<{ h: string; what: string }> = [];
  return {
    name: "handsc: tunnel stops at the first ore by default, and with through: true goes on, takes the ore in its way and lists what it passed",
    timeoutMs: 300_000,
    view,
    async setup(c) {
      await hill(c);
      await c.world.run("setblock 6 68 1 coal_ore");
      await c.world.run("setblock 9 69 -1 coal_ore");
      await c.world.run("setblock 11 67 0 iron_ore"); // in the floor
      await c.world.run("setblock 13 68 0 coal_ore"); // in the way, which a stone pickaxe can take
    },
    async act(c) {
      stopEnd = (await go(c, { intent: "tunnel", dir: "east", length: 3 }, 90_000)).end;
      // from the start again, the same tunnel, through
      await c.world.run(`tp ${c.bot} ${START.x}.5 ${START.y} ${START.z}.5 -90 0`);
      await sleep(1500);
      end = (await go(c, { intent: "tunnel", dir: "east", length: 10, through: true }, 180_000)).end;
      listed = (await observe(c)).blocks;
    },
    async verify(c) {
      c.check(stopEnd?.event === "task_finished" && /coal ore in the wall/.test(String(stopEnd.detail ?? "")) && words(stopEnd.detail), `the first run stops at the coal (${said(stopEnd)})`);
      c.check(end?.event === "task_finished", `the second finished (${said(end)})`);
      c.check(end?.detail === "ran out of length", `by running out of length (${end?.detail})`);
      const saw = String(end?.saw ?? "");
      c.check(/two coal ore/.test(saw) && /iron ore/.test(saw) && words(saw), `saw lists the two new coal ores and the iron, not the coal the first run told of, in words (${saw})`);
      c.check(((end?.got ?? {}) as Record<string, number>).coal === 1, `the coal in its way was dug and picked up (${JSON.stringify(end?.got)})`);
      const what = listed.map((b) => b.what);
      c.check(what.includes("coal_ore") && what.includes("iron_ore") && listed.every((b) => !!b.h), `observe lists the ore beside and under it, with handles (${what.join(", ")})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const noTool: Scenario = (() => {
  let end: BodyEvent | null = null;
  let still = false;
  return {
    name: "handsc: a tunnel into iron ore with only a wooden pickaxe ends no_tool and leaves the ore alone",
    timeoutMs: 120_000,
    view,
    async setup(c) {
      await hill(c);
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
      await c.world.run("setblock 6 68 0 iron_ore");
    },
    async act(c) {
      end = (await go(c, { intent: "tunnel", dir: "east", length: 8, through: true }, 90_000)).end;
      still = await c.world.blockIs({ x: 6, y: 68, z: 0 }, "iron_ore");
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "no_tool", `no_tool (${said(end)})`);
      c.check(/pickaxe/.test(String(end?.detail ?? "")) && words(end?.detail), `says which, in words (${end?.detail})`);
      c.check(still, "the iron ore was not broken for nothing");
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const dropAhead: Scenario = (() => {
  let end: BodyEvent | null = null;
  return {
    name: "handsc: a tunnel into a hole in its floor ends blocked, 'a drop ahead'",
    timeoutMs: 120_000,
    view,
    async setup(c) {
      await hill(c);
      await c.world.run("fill 7 66 -2 7 67 2 air"); // a trench across the way, grass and dirt gone
    },
    async act(c) {
      end = (await go(c, { intent: "tunnel", dir: "east", length: 10 }, 90_000)).end;
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "blocked" && /drop/.test(String(end.detail ?? "")), `blocked on a drop (${said(end)})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

// ---- from the foot of a stair ----

// the stair as handsb cuts it: west from the top at (16, 68, 0), four steps through dirt to stone, the foot at (12, 64, 0)
const FOOT = { x: SX - 4, y: 64, z: SZ };

async function stairFoot(c: Ctx, ms = 150_000) {
  await calmHome(c);
  await strata(c);
  await stand(c);
  await c.world.run(`give ${c.bot} stone_pickaxe 1`);
  await sleep(2500);
  return go(c, { intent: "dig_down" }, ms);
}

const chain: Scenario = (() => {
  let down: BodyEvent | null = null;
  let end: BodyEvent | null = null;
  let events: BodyEvent[] = [];
  let ore: { h: string; d: string; dir: string } | undefined;
  let col: BodyEvent | null = null;
  let raw = 0;
  return {
    name: "handsc: from a stair foot, tunnel stops at an iron ore, observe lists it with a handle, collect takes it with a stone pickaxe",
    timeoutMs: 360_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async act(c) {
      const d = await stairFoot(c);
      down = d.end;
      // rock to the south of the foot with an iron ore six blocks in, in line with the tunnel
      await c.world.run(`fill ${FOOT.x - 1} 64 1 ${FOOT.x + 1} 66 9 stone`);
      await c.world.run(`fill ${FOOT.x} 64 7 ${FOOT.x} 65 7 iron_ore`); // a vein of two, one over the other
      const t = await go(c, { intent: "tunnel", dir: "south", length: 12 }, 150_000);
      end = t.end;
      events = t.events;
      const o = await observe(c);
      ore = o.blocks.find((b) => b.what === "iron_ore");
      if (ore) {
        col = (await go(c, { intent: "collect", handle: ore.h, count: 4 }, 90_000)).end;
        raw = await c.world.count(c.bot, "raw_iron");
      }
    },
    async verify(c) {
      c.check(down?.event === "task_finished", `dig_down finished (${said(down)})`);
      c.check(end?.event === "task_finished" && /iron ore in the wall/.test(String(end.detail ?? "")) && words(end.detail), `tunnel stopped at the iron, with a reason in words (${said(end)})`);
      const got = (end?.got ?? {}) as Record<string, number>;
      c.check((got.cobblestone ?? 0) >= 6, `it took what it dug (${JSON.stringify(got)})`);
      const prog = events.filter((e) => e.event === "task_progress").map((e) => String(e.step));
      c.check(prog.length > 0 && prog.every((s) => /^tunnelling(, [a-z-]+ blocks?)?$/.test(s)), `progress says how far, in words (${prog.join(" | ")})`);
      c.check(!!ore && words(ore.d) && words(ore.dir), `observe lists the ore with a handle and no number (${JSON.stringify(ore)})`);
      c.check(col?.event === "task_finished", `collect finished (${said(col)})`);
      c.check(raw === 2, `and the server says it holds the vein's two raw iron (${raw})`);
      c.check(col?.detail === "no more in reach", `collect says why it got fewer than four (${col?.detail})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const back: Scenario = (() => {
  let down: BodyEvent | null = null;
  let end: BodyEvent | null = null;
  let in0: number[] = [];
  let up: BodyEvent | null = null;
  let out: number[] = [];
  return {
    name: "handsc: a tunnel dug off a stair foot goes on the way the stair faced, and climb_up walks back along it and out",
    timeoutMs: 360_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async act(c) {
      down = (await stairFoot(c)).end;
      await c.world.run(`fill ${FOOT.x - 7} 64 -1 ${FOOT.x - 1} 66 1 stone`); // rock to the west
      end = (await go(c, { intent: "tunnel", length: 5 }, 150_000)).end;
      in0 = await c.world.pos(c.bot);
      up = (await go(c, { intent: "climb_up" }, 120_000)).end;
      out = await c.world.pos(c.bot);
    },
    async verify(c) {
      c.check(down?.event === "task_finished", `dig_down finished (${said(down)})`);
      c.check(end?.event === "task_finished" && end.detail === "ran out of length", `the tunnel ran its length (${said(end)})`);
      c.check(in0[0] <= FOOT.x - 4 && Math.abs(in0[2] - SZ - 0.5) < 1.2 && in0[1] < 65, `it went west, on from the stair (x ${in0[0]?.toFixed(1)}, z ${in0[2]?.toFixed(1)})`);
      c.check(up?.event === "task_finished", `climb_up finished (${said(up)})`);
      c.check(out[1] >= 67.5 && Math.hypot(out[0] - SX - 0.5, out[2] - SZ - 0.5) <= 3, `it is back at the top (${out.map((n) => n.toFixed(1)).join(" ")})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

// ---- collect that ends short ----

const short: Scenario = (() => {
  let end: BodyEvent | null = null;
  return {
    name: "handsc: collect of eleven with three stones in reach ends with fewer and says why",
    timeoutMs: 150_000,
    view,
    async setup(c) {
      await calmHome(c);
      await c.world.run("fill 4 68 0 6 68 0 stone");
      await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
      await c.world.run(`tp ${c.bot} ${START.x}.5 ${START.y} ${START.z}.5 -90 0`);
      await sleep(2500);
    },
    async act(c) {
      const o = await observe(c);
      const stone = o.blocks.find((b) => b.what === "stone");
      if (stone) end = (await go(c, { intent: "collect", handle: stone.h, count: 11 }, 90_000)).end;
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `finished (${said(end)})`);
      c.check((end?.got as Record<string, number> | undefined)?.cobblestone === 3, `with the three it could reach (${JSON.stringify(end?.got)})`);
      c.check(end?.detail === "no more in reach", `and the reason (${end?.detail})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

// ---- where, underground ----

const deepStair: Scenario = (() => {
  let before = "";
  let after = "";
  let end: BodyEvent | null = null;
  return {
    name: "handsc: observe where says underground, several blocks down, at the foot of an eight-step stair",
    timeoutMs: 240_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async act(c) {
      await calmHome(c);
      await strata(c);
      await c.world.run(`fill ${X0} 60 ${Z0} ${X1} 63 ${Z1} dirt`); // the stone is under y 60 here, so the stair has eight steps
      await stand(c);
      await c.world.run(`give ${c.bot} stone_pickaxe 1`);
      await sleep(2500);
      before = (await observe(c)).where;
      end = (await go(c, { intent: "dig_down" }, 200_000)).end;
      after = (await observe(c)).where;
    },
    async verify(c) {
      c.check(before === "on the surface", `on top it says the surface (${before})`);
      c.check(end?.event === "task_finished", `dig_down finished (${said(end)})`);
      c.check(after === "underground, several blocks down", `at the foot it says how far down, in words (${after})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`fill ${X0} 60 ${Z0} ${X1} 61 ${Z1} stone`);
      await restoreGround(c);
    },
  };
})();

// ---- the pit fill ----

const pit: Scenario = (() => {
  let down: BodyEvent | null = null;
  let col: BodyEvent | null = null;
  let hole = "";
  let up: BodyEvent | null = null;
  let out: number[] = [];
  let filled = "";
  return {
    name: "handsc: after the floor of the stair foot is collected, climb_up sets a block in the pit and gets out",
    timeoutMs: 300_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async act(c) {
      down = (await stairFoot(c)).end;
      const o = await observe(c);
      const stone = o.blocks.find((b) => b.what === "stone");
      if (stone) col = (await go(c, { intent: "collect", handle: stone.h }, 90_000)).end;
      hole = (await c.world.blockIs({ x: FOOT.x, y: 63, z: FOOT.z }, "air")) ? "air" : "filled";
      up = (await go(c, { intent: "climb_up" }, 90_000)).end;
      out = await c.world.pos(c.bot);
      for (const name of ["dirt", "stone", "cobblestone"]) if (await c.world.blockIs({ x: FOOT.x, y: 63, z: FOOT.z }, name)) filled = name;
    },
    async verify(c) {
      c.check(down?.event === "task_finished", `dig_down finished (${said(down)})`);
      c.check(col?.event === "task_finished" && hole === "air", `the floor of the foot was collected, leaving a pit (${said(col)}, ${hole})`);
      c.check(up?.event === "task_finished", `climb_up finished (${said(up)})`);
      c.check(out[1] >= 67.5 && Math.hypot(out[0] - SX - 0.5, out[2] - SZ - 0.5) <= 3, `it is out (${out.map((n) => n.toFixed(1)).join(" ")})`);
      c.check(filled === "dirt", `and the pit has a block of dirt in it, on the server (${filled || "nothing"})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

export default [blocked, built, through, noTool, dropAhead, chain, back, short, deepStair, pit] satisfies Scenario[];
