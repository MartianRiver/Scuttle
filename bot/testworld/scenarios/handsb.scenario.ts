// Hands B: explore stops at the shore, in_danger says why and a reflex ends with an event, fish are one line, the
// stair dig_down cuts and climb_up, and the idle hand. Facts come from the server (where the body is, what it holds,
// which blocks are gone); what the body says is checked against them. Everything built is taken away again.
import { arena, C, tidy } from "./arena";
import { growNaturalTrees } from "./get_wood.scenario";
import { sleep, type BodyEvent, type Ctx, type Observation, type Scenario } from "./lib";

const at = (x: number, y: number, z: number) => `${x} ${y} ${z}`;

export async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

// one action to its end: the reply, and the finish or failure event
export async function go(c: Ctx, intent: object, ms = 120_000, every?: () => Promise<void>) {
  const from = c.body.mark();
  const r = await c.body.send(intent);
  if (r.type !== "accepted") return { reply: r.type === "rejected" ? `rejected ${r.reason}` : r.type, end: null as BodyEvent | null, events: [] as BodyEvent[] };
  const stop = Date.now() + ms;
  let end: BodyEvent | undefined;
  while (!end && Date.now() < stop) {
    end = c.body.events.slice(from).find((e) => e.taskId === r.taskId && (e.event === "task_finished" || e.event === "task_failed" || e.event === "task_stopped"));
    if (!end) {
      await every?.();
      await sleep(250);
    }
  }
  await sleep(400);
  return { reply: "accepted", end: end ?? null, events: c.body.events.slice(from) };
}

export const said = (e: BodyEvent | null) => `${e?.event ?? "no end"} ${e?.reason ?? ""} ${e?.detail ?? ""}`.trim();

// the arena with the body set up for a calm run: fed, healed, nothing carried
async function calm(c: Ctx) {
  await arena(c);
  await c.world.run("difficulty peaceful");
  await c.world.run("gamerule spawn_mobs false");
}

// z ranges of at most 20 rows, so a fill stays under the server's block limit
function slabs(z0: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = z0; z <= z1; z += 20) out.push([z, Math.min(z + 19, z1)]);
  return out;
}

// a body of liquid x0..x1 over the whole depth of the arena, held in by tall walls and a stone floor
async function fillBasin(c: Ctx, x0: number, x1: number, z0: number, z1: number, liquid: string) {
  const w = c.world;
  for (const [a, b] of slabs(z0 - 1, z1 + 1)) await w.run(`fill ${x0 - 1} 59 ${a} ${x1 + 1} 72 ${b} stone`);
  for (const [a, b] of slabs(z0, z1)) {
    await w.run(`fill ${x0} 60 ${a} ${x1} 66 ${b} ${liquid}`);
    await w.run(`fill ${x0} 67 ${a} ${x1} 72 ${b} air`);
  }
}

async function clearBasin(c: Ctx, x0: number, x1: number, z0: number, z1: number) {
  const w = c.world;
  for (const [a, b] of slabs(z0 - 1, z1 + 1)) {
    await w.run(`fill ${x0 - 1} 59 ${a} ${x1 + 1} 66 ${b} stone`);
    await w.run(`fill ${x0 - 1} 67 ${a} ${x1 + 1} 72 ${b} air`);
    await w.run(`fill ${x0 - 1} 66 ${a} ${x1 + 1} 66 ${b} grass_block`);
  }
}

// ---- explore ----

// samples the body's position; true when it was ever down in the liquid column (the floor is y 66, feet at 67)
function wetWatch(x0: number, x1: number) {
  let wet = false;
  let lowest = 99;
  return {
    sample: async (c: Ctx) => {
      const [x, y] = await c.world.pos(c.bot);
      if (x >= x0 && x <= x1 + 1) lowest = Math.min(lowest, y);
      if (x >= x0 && x <= x1 + 1 && y < 66.95) wet = true;
    },
    wet: () => wet,
    lowest: () => lowest,
  };
}

function shore(name: string, liquid: string, x0: number, x1: number, dir: string, far: string, words: RegExp): Scenario {
  let end: BodyEvent | null = null;
  let at0: number[] = [];
  const watch = wetWatch(x0, x1);
  return {
    name,
    timeoutMs: 200_000,
    view: { x: 44, y: 72, z: 60 },
    async setup(c) {
      await calm(c);
      await fillBasin(c, x0, x1, 30, 90, liquid);
      await c.world.run(`tp ${c.bot} 40.5 67 60.5`);
      await sleep(2500);
    },
    async act(c) {
      const r = await go(c, { intent: "explore", dir, far }, 180_000, () => watch.sample(c));
      end = r.end;
      at0 = await c.world.pos(c.bot);
      c.check(r.reply === "accepted", `explore accepted (${r.reply})`);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "blocked", `ended blocked (${said(end)})`);
      c.check(words.test(String(end?.detail ?? "")) && !/\d/.test(String(end?.detail)), `detail says what it is, in words (${end?.detail})`);
      c.check(at0[1] >= 66.95, `it ended on dry ground (y ${at0[1]?.toFixed(2)})`);
      c.check(!watch.wet(), `it never went into the liquid (lowest y ${watch.lowest()})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    async cleanup(c) {
      await clearBasin(c, x0, x1, 30, 90);
      await tidy(c);
    },
  };
}

const sea = shore("handsb: explore east into the sea ends blocked on the shore, 'the sea to the east'", "water", 50, 90, "east", "a fair way", /the sea to the east/);
const lake = shore("handsb: explore east into a lake that spans the arena ends blocked, 'a lake to the east'", "water", 50, 57, "east", "a fair way", /a lake to the east/);
const lava = shore("handsb: explore west into lava ends blocked, 'lava to the west'", "lava", 30, 38, "west", "a short walk", /lava to the west/);

const around: Scenario = (() => {
  let end: BodyEvent | null = null;
  let at0: number[] = [];
  const watch = wetWatch(52, 58);
  return {
    name: "handsb: explore east round a small pond arrives and never wets its feet",
    timeoutMs: 200_000,
    view: { x: 44, y: 72, z: 60 },
    async setup(c) {
      await calm(c);
      await c.world.run("fill 51 59 54 59 66 66 stone"); // walls and floor for it to sit in
      await c.world.run("fill 52 60 55 58 66 65 water");
      await c.world.run(`tp ${c.bot} 40.5 67 60.5`);
      await sleep(2500);
    },
    async act(c) {
      const r = await go(c, { intent: "explore", dir: "east" }, 180_000, () => watch.sample(c));
      end = r.end;
      at0 = await c.world.pos(c.bot);
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `finished (${said(end)})`);
      c.check(at0[0] - 40.5 >= 16 && at0[0] - 40.5 <= 34, `ended 16 to 32 blocks east (${(at0[0] - 40.5).toFixed(1)})`);
      c.check(!watch.wet(), `it never went into the pond (lowest y ${watch.lowest()})`);
    },
    async cleanup(c) {
      await c.world.run("fill 51 59 54 59 66 66 stone");
      await tidy(c);
    },
  };
})();

// ---- in_danger says why, and the reflex ends with an event ----

const mobs: Scenario = (() => {
  let refused: { reason?: string; detail?: string } = {};
  let ended: BodyEvent | null = null;
  return {
    name: "handsb: an order refused while mobs are close says which, and reflex_ended follows when they are gone",
    timeoutMs: 90_000,
    view: { x: C.x - 10, y: C.y + 3, z: C.z },
    setup: arena,
    async act(c) {
      await c.world.run("difficulty normal");
      const from = c.body.mark();
      await c.world.run(`summon zombie ${at(C.x + 6, C.y, C.z)}`);
      for (const stop = Date.now() + 15_000; Date.now() < stop; await sleep(300)) {
        const r = await c.body.send({ intent: "equip", item: "stone" });
        if (r.reason === "in_danger") {
          refused = { reason: r.reason, detail: (r as { detail?: string }).detail };
          break;
        }
      }
      await c.world.run("kill @e[type=zombie]");
      ended = await c.body.waitEvent("reflex_ended", from, 30_000);
    },
    async verify(c) {
      c.check(refused.reason === "in_danger", `refused in_danger (${refused.reason})`);
      c.check(/zombie/.test(refused.detail ?? "") && !/\d/.test(refused.detail ?? ""), `with what it is (${refused.detail})`);
      c.check(ended?.what === "mobs" && ended?.ok === true, `then one reflex_ended for the mobs (${JSON.stringify(ended)})`);
      const after = await c.body.send({ intent: "equip", item: "stone" });
      c.check(after.reason !== "in_danger", `and it takes orders again (${after.reason})`);
    },
    cleanup: tidy,
  };
})();

const drowning: Scenario = (() => {
  let refused: { reason?: string; detail?: string } = {};
  let ended: BodyEvent | null = null;
  return {
    name: "handsb: on the bottom of a deep pool the refusal says so, and reflex_ended ok follows once out",
    timeoutMs: 90_000,
    view: { x: C.x - 10, y: C.y + 3, z: C.z },
    setup: arena,
    async act(c) {
      await c.world.run("fill 54 58 56 62 58 64 stone");
      await c.world.run("fill 55 59 57 61 66 63 water");
      const from = c.body.mark();
      await c.world.run(`tp ${c.bot} 58.5 59 60.5`);
      for (const stop = Date.now() + 25_000; Date.now() < stop; await sleep(300)) {
        const r = await c.body.send({ intent: "equip", item: "stone" });
        if (r.reason === "in_danger") {
          refused = { reason: r.reason, detail: (r as { detail?: string }).detail };
          break;
        }
      }
      ended = await c.body.waitEvent("reflex_ended", from, 40_000);
    },
    async verify(c) {
      c.check(refused.detail === "in deep water, swimming out", `the refusal names the water (${refused.reason} ${refused.detail})`);
      c.check(ended?.what === "drowning" && ended?.ok === true, `reflex_ended ok (${JSON.stringify(ended)})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    cleanup: tidy,
  };
})();

const gaveUp: Scenario = (() => {
  let gave: BodyEvent | null = null;
  let after = "";
  return {
    name: "handsb: sealed in water under a roof with no way out the reflex gives up, says so, and the body takes orders again",
    timeoutMs: 120_000,
    view: { x: 38, y: 80, z: 60 },
    async setup(c) {
      await calm(c);
      // a chamber of water under a stone roof, with deep water over the roof: no air, no bank and no standing room within reach
      // (wider than the 8 blocks the body's quick look reaches, so no wall or roof top counts as somewhere to head for)
      await c.world.run("fill 39 59 49 61 80 71 stone");
      await c.world.run("fill 40 60 50 60 66 70 water");
      await c.world.run("fill 40 68 50 60 79 70 water");
      await c.world.run(`tp ${c.bot} 34.5 67 60.5`); // on the grass beside it, which is where it last stood
      await sleep(2500);
    },
    async act(c) {
      const from = c.body.mark();
      await c.world.run(`tp ${c.bot} 50.5 62 60.5`);
      gave = await c.body.waitEvent("reflex_ended", from, 30_000);
      await c.world.run(`tp ${c.bot} 34.5 67 60.5`);
      await sleep(1500);
      after = String((await c.body.send({ intent: "equip", item: "stone" })).reason);
    },
    async verify(c) {
      c.check(gave?.ok === false && gave?.what === "drowning", `reflex_ended with ok false (${JSON.stringify(gave)})`);
      c.check(/no way out/.test(String(gave?.detail ?? "")), `and the reason in words (${gave?.detail})`);
      c.check(after !== "in_danger", `danger is over, orders are taken (${after})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    async cleanup(c) {
      await c.world.run(`tp ${c.bot} 0.5 68 -10`);
      await c.world.run("fill 39 59 49 61 66 71 stone");
      await c.world.run("fill 39 67 49 61 81 71 air");
      await c.world.run("fill 39 66 49 61 66 71 grass_block");
      await tidy(c);
    },
  };
})();

// ---- fish ----

const school: Scenario = {
  name: "handsb: a school of cod is one line, a count and the nearest band, with a handle only when nothing else is near",
  timeoutMs: 60_000,
  view: { x: C.x - 6, y: C.y + 3, z: C.z },
  async setup(c) {
    await calm(c);
    await c.world.run("fill 66 65 58 70 65 62 stone");
    await c.world.run("fill 66 66 58 70 66 62 water");
    await sleep(500);
  },
  async act() {},
  async verify(c) {
    for (let i = 0; i < 7; i++) await c.world.run(`summon cod ${68 + (i % 3) - 1}.5 66.2 ${60 + (i % 3) - 1}.5`);
    await sleep(1500);
    const o = await observe(c);
    const cod = o.near.filter((e) => e.what.startsWith("cod"));
    c.check(cod.length === 1 && /^cod x[3-7]$/.test(cod[0].what), `one line with a count (${JSON.stringify(o.near)})`);
    c.check(!!cod[0] && !!cod[0].d && !/\d/.test(cod[0].d), `with the nearest band (${cod[0]?.d})`);
    c.check(!!cod[0]?.h, "and the nearest has a handle when nothing else is near");
    await c.world.run(`summon cow ${C.x - 3} ${C.y} ${C.z}`);
    await sleep(1500);
    const o2 = await observe(c);
    const cod2 = o2.near.find((e) => e.what.startsWith("cod"));
    c.check(!!cod2 && cod2.h === undefined, `no handle on the school with a cow in view (${JSON.stringify(o2.near)})`);
    c.check(o2.near.some((e) => e.what === "cow" && e.h), "the cow keeps its handle");
  },
  async cleanup(c) {
    await c.world.run("kill @e[type=cod]");
    await c.world.run("kill @e[type=cow]");
    await tidy(c);
  },
};

// ---- the stair ----

// The stair is dug inside the grove region, the only place the test body may dig (the world is build:deny elsewhere,
// and a dig there is undone: see the last scenario of this group). Ground there is grass at y 67, dirt 62 to 66.
export const X0 = 0, X1 = 22, Z0 = -6, Z1 = 6;
export const SX = 16, SZ = 0;
export const GROUND = 67;

export async function calmHome(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  const w = c.world;
  await w.run(`gamemode survival ${c.bot}`);
  await w.run(`clear ${c.bot}`);
  await w.run(`effect clear ${c.bot}`);
  await w.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await w.run(`effect give ${c.bot} minecraft:saturation 5 10 true`);
  await w.run("time set day");
  await w.run("weather clear");
  await w.run("gamerule spawn_mobs false");
}

// stone from y 62 to 63 under dirt, grass on top at `top`; air over it
export async function strata(c: Ctx, top = GROUND) {
  const w = c.world;
  await w.run(`fill ${X0} 68 ${Z0} ${X1} 100 ${Z1} air`);
  await w.run(`fill ${X0} 62 ${Z0} ${X1} 63 ${Z1} stone`);
  await w.run(`fill ${X0} 64 ${Z0} ${X1} ${top - 1} ${Z1} dirt`);
  await w.run(`fill ${X0} ${top} ${Z0} ${X1} ${top} ${Z1} grass_block`);
  await w.run(`fill ${X0} ${top + 1} ${Z0} ${X1} 100 ${Z1} air`);
}

// the grove ground as build_home.py leaves it, and its trees grown back
export async function restoreGround(c: Ctx) {
  const w = c.world;
  await w.run(`fill ${X0} 62 ${Z0} ${X1} 66 ${Z1} dirt`);
  await w.run(`fill ${X0} 67 ${Z0} ${X1} 67 ${Z1} grass_block`);
  await w.run(`fill ${X0} 68 ${Z0} ${X1} 100 ${Z1} air`);
  await w.run(`tp ${c.bot} 0.5 68 -10`);
  await growNaturalTrees(c);
}

// facing west (yaw 90), so a long stair has ground to run through
export const stand = (c: Ctx, top = GROUND) => c.world.run(`tp ${c.bot} ${SX}.5 ${top + 1} ${SZ}.5 90 0`);

const stair: Scenario = (() => {
  let end: BodyEvent | null = null;
  let events: BodyEvent[] = [];
  let down: number[] = [];
  let places: Record<string, string> | undefined;
  let nearStone = false;
  let got: Record<string, number> | undefined;
  let up: number[] = [];
  let upEnd: BodyEvent | null = null;
  let goEnd: BodyEvent | null = null;
  let afterGo: number[] = [];
  let colEnd: BodyEvent | null = null;
  return {
    name: "handsb: dig_down cuts a stair to stone, observe offers the stone, collect takes it, climb_up and go_to stair lead back out",
    timeoutMs: 300_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async setup(c) {
      await calmHome(c);
      await strata(c);
      await stand(c);
      await c.world.run(`give ${c.bot} stone_pickaxe 1`);
      await sleep(2500);
    },
    async act(c) {
      const r = await go(c, { intent: "dig_down" }, 150_000);
      end = r.end;
      events = r.events;
      down = await c.world.pos(c.bot);
      const o = await observe(c);
      places = o.places;
      const stone = o.blocks.find((b) => b.what === "stone");
      nearStone = !!stone;
      if (stone) {
        const col = await go(c, { intent: "collect", handle: stone.h }, 90_000);
        colEnd = col.end;
        got = col.end?.got as Record<string, number> | undefined;
      }
      const climb = await go(c, { intent: "climb_up" }, 90_000);
      upEnd = climb.end;
      up = await c.world.pos(c.bot);
      // away from the stair, then back to it by name
      await c.world.run(`tp ${c.bot} ${X0 + 1}.5 ${GROUND + 1} ${Z0 + 1}.5`);
      await sleep(1500);
      const back = await go(c, { intent: "go_to", handle: "stair" }, 60_000);
      goEnd = back.end;
      afterGo = await c.world.pos(c.bot);
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `dig_down finished (${said(end)})`);
      c.check(/stone/.test(String(end?.detail ?? "")) && !/\d/.test(String(end?.detail)), `detail says where it stopped, in words (${end?.detail})`);
      c.check(down[1] >= 63.9 && down[1] <= 64.7, `it is down at the stone, y ${down[1]?.toFixed(1)}`);
      const prog = events.filter((e) => e.event === "task_progress").map((e) => String(e.step));
      c.check(prog.some((s) => /^digging down, \w+ steps?$/.test(s)), `progress says the steps in words (${prog.slice(-2).join(" | ")})`);
      const stairWords = places?.stair ?? "";
      c.check(/stair/.test(stairWords) && !/\d/.test(stairWords), `observe lists the stair among the places, in words (${stairWords})`);
      c.check(nearStone, "and the stone it stopped on is a block with a handle");
      c.check(colEnd?.event === "task_finished", `collect finished (${said(colEnd)})`);
      c.check((got?.cobblestone ?? 0) >= 1 && (await c.world.count(c.bot, "cobblestone")) >= 1, `collect took it (${JSON.stringify(got)}, ${await c.world.count(c.bot, "cobblestone")} on the server)`);
      c.check(upEnd?.event === "task_finished", `climb_up finished (${said(upEnd)})`);
      c.check(up[1] >= 67.5 && Math.hypot(up[0] - SX - 0.5, up[2] - SZ - 0.5) <= 3, `it is back at the top (${up.map((n) => n.toFixed(1)).join(" ")})`);
      c.check(goEnd?.event === "task_finished", `go_to stair finished (${said(goEnd)})`);
      c.check(Math.hypot(afterGo[0] - SX - 0.5, afterGo[2] - SZ - 0.5) <= 4, "and it stands at the stair");
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const refusedBuild: Scenario = (() => {
  let end: BodyEvent | null = null;
  let r0 = "";
  return {
    name: "handsb: dig_down beside a build is refused at once, with a reason, and nothing is dug",
    timeoutMs: 60_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async setup(c) {
      await calmHome(c);
      await strata(c);
      await c.world.run(`setblock ${SX + 2} ${GROUND + 1} ${SZ + 1} crafting_table`);
      await stand(c);
      await sleep(2000);
    },
    async act(c) {
      const r = await go(c, { intent: "dig_down" }, 40_000);
      r0 = r.reply;
      end = r.end;
    },
    async verify(c) {
      c.check(r0 === "accepted" && end?.event === "task_failed" && end.reason === "refused", `refused (${r0} ${said(end)})`);
      c.check(/built/.test(String(end?.detail ?? "")) && !/\d/.test(String(end?.detail)), `the reason is in words (${end?.detail})`);
      c.check(await c.world.blockIs({ x: SX, y: GROUND, z: SZ }, "grass_block"), "the ground under it is untouched");
    },
    async cleanup(c) {
      await restoreGround(c);
    },
  };
})();

const wet: Scenario = (() => {
  let end: BodyEvent | null = null;
  let health = 20;
  return {
    name: "handsb: dig_down toward water under the stair stops with blocked and the body stays dry",
    timeoutMs: 120_000,
    view: { x: SX - 8, y: GROUND + 4, z: SZ },
    async setup(c) {
      await calmHome(c);
      await strata(c);
      // water in a ring at the depth the stair would reach, all four ways
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) await c.world.run(`setblock ${SX + dx} 65 ${SZ + dz} water`);
      await c.world.run(`give ${c.bot} stone_pickaxe 1`);
      await stand(c);
      await sleep(2000);
    },
    async act(c) {
      const r = await go(c, { intent: "dig_down" }, 100_000);
      end = r.end;
      health = await c.world.health(c.bot);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "blocked", `blocked (${said(end)})`);
      c.check(/water/.test(String(end?.detail ?? "")) && !/\d/.test(String(end?.detail)), `says water, in words (${end?.detail})`);
      const [, y] = await c.world.pos(c.bot);
      c.check(health >= 19 && y >= 65.5, `it is dry and unhurt (health ${health}, y ${y?.toFixed(1)})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const deep: Scenario = (() => {
  let end: BodyEvent | null = null;
  const TOP = 91;
  return {
    name: "handsb: dig_down through dirt with no stone in twelve steps ends stuck, 'no stone within twelve steps'",
    timeoutMs: 280_000,
    view: { x: SX - 8, y: TOP + 4, z: SZ },
    async setup(c) {
      await calmHome(c);
      await strata(c, TOP);
      await c.world.run(`give ${c.bot} stone_shovel 1`);
      await stand(c, TOP);
      await sleep(2000);
    },
    async act(c) {
      end = (await go(c, { intent: "dig_down" }, 240_000)).end;
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "stuck", `stuck (${said(end)})`);
      c.check(/no stone within twelve steps/.test(String(end?.detail ?? "")), `with the cap in words (${end?.detail})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await restoreGround(c);
    },
  };
})();

const outside: Scenario = (() => {
  let end: BodyEvent | null = null;
  return {
    name: "handsb: a stair dug where the server undoes digs ends protected, with words",
    timeoutMs: 90_000,
    view: { x: 52, y: 72, z: 60 },
    async setup(c) {
      await arena(c);
      await c.world.run("fill 50 50 50 70 61 70 stone");
      await c.world.run("fill 50 62 50 70 65 70 dirt");
      await c.world.run("fill 50 66 50 70 66 70 grass_block");
      await c.world.run(`give ${c.bot} stone_pickaxe 1`);
      await c.world.run(`tp ${c.bot} ${C.x}.5 ${C.y} ${C.z}.5`);
      await sleep(2000);
    },
    async act(c) {
      end = (await go(c, { intent: "dig_down" }, 60_000)).end;
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "protected", `protected (${said(end)})`);
      c.check(!/\d/.test(String(end?.detail ?? "")) && !!end?.detail, `with a detail in words (${end?.detail})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await tidy(c);
    },
  };
})();

// ---- the idle hand ----

async function held(c: Ctx): Promise<string> {
  const out = await c.world.run(`data get entity ${c.bot} SelectedItem`);
  return out.match(/id: "minecraft:([a-z_]+)"/)?.[1] ?? "nothing";
}

const idle: Scenario = (() => {
  const seen: Record<string, string> = {};
  return {
    name: "handsb: the idle body holds its best pickaxe, not the sapling it was handed, and leaves an equipped item alone",
    timeoutMs: 90_000,
    async setup(c) {
      await calm(c);
      await c.world.run(`give ${c.bot} oak_sapling 4`);
      await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
      await c.world.run(`give ${c.bot} iron_pickaxe 1`);
      await c.world.run(`give ${c.bot} stone_axe 1`);
    },
    async act(c) {
      await c.world.run(`item replace entity ${c.bot} weapon.mainhand with oak_sapling 4`);
      await sleep(5000);
      seen.idle = await held(c);
      const eq = await c.body.send({ intent: "equip", item: "oak_sapling" });
      seen.eq = eq.type;
      await sleep(7000);
      seen.pinned = await held(c);
    },
    async verify(c) {
      c.check(seen.idle === "iron_pickaxe", `idle it holds the iron pickaxe (${seen.idle})`);
      c.check(seen.eq === "accepted" && seen.pinned === "oak_sapling", `an equip order stays in hand (${seen.eq} ${seen.pinned})`);
    },
    async cleanup(c) {
      await c.world.run(`clear ${c.bot}`);
      await tidy(c);
    },
  };
})();

export default [sea, lake, lava, around, mobs, drowning, gaveUp, school, stair, refusedBuild, wet, deep, outside, idle] satisfies Scenario[];
