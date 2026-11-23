// What the mind is shown and told so it can act: trees in `observe`, a task aimed with `near`, why a
// task failed (`got`, `detail`) and the places the server refused, progress lines, and getting out of
// water. Facts come from the server (where blocks are, where the body ended up); what the body says is
// checked against them. The grove is used up by earlier scenarios, so it is rebuilt first, and put back.
import { BodyClient } from "../../src/mcp/client";
import { TOOLS } from "../../src/mcp/tools";
import { readFileSync } from "node:fs";
import path from "node:path";
import { arena, C, tidy } from "./arena";
import { growNaturalTrees } from "./get_wood.scenario";
import { restartBot, sleep, type Ctx, type Observation, type Scenario } from "./lib";

const OUTSIDE = [[-20, -14], [20, -14], [0, -17]] as const; // outside the grove and the home region
const HOME_BOT = "0.5 68 -10";
const settle = () => sleep(800);

async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

async function calm(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`gamemode survival ${c.bot}`);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`effect clear ${c.bot}`);
  await c.world.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await c.world.run("time set day");
  await c.world.run("weather clear");
}

// a tree the way build_home.py grows them: natural leaves unless told otherwise
async function tree(c: Ctx, x: number, z: number, persistent = false) {
  const leaf = persistent ? "oak_leaves[persistent=true]" : "oak_leaves";
  await c.world.run(`fill ${x - 2} 70 ${z - 2} ${x + 2} 71 ${z + 2} ${leaf}`);
  await c.world.run(`fill ${x - 1} 72 ${z - 1} ${x + 1} 73 ${z + 1} ${leaf}`);
  await c.world.run(`fill ${x} 68 ${z} ${x} 72 ${z} oak_log`);
}

const logsAt = (c: Ctx, x: number, z: number) => c.world.countBlocks({ x, y: 68, z }, { x, y: 72, z }, "oak_log");

// the grove, empty (everything a scenario built in it gone), and everything put back as the others expect it
const clearGrove = (c: Ctx) => c.world.run("fill -24 68 -10 24 95 12 air");
const endOf = (c: Ctx, from: number, ms: number) => Promise.race([c.body.waitEvent("task_finished", from, ms), c.body.waitEvent("task_failed", from, ms)]);
const ended = (c: Ctx, from: number) => c.body.events.slice(from).find((e) => e.event === "task_finished" || e.event === "task_failed");

// feet and the cell under them hold no water
const dry = (c: Ctx) => c.world.passes(`execute as ${c.bot} at @s unless block ~ ~ ~ water unless block ~ ~-0.5 ~ water`);

async function dryWithin(c: Ctx, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
    if (await dry(c)) {
      await sleep(3000); // and it stays out
      return dry(c);
    }
  }
  return false;
}

// a pool 21 wide and 3 deep (floor y 63, water y 64 to 66, level with the grass), in the arena
async function pool(c: Ctx) {
  await c.world.run("fill 50 58 50 70 63 70 stone");
  await c.world.run("fill 50 64 50 70 66 70 water");
  await c.world.run("kill @e[type=cod,x=60,y=65,z=60,distance=..40]");
}

// the trees outside the grove that the protected scenario grows, and whatever stood in their place
const outsideTrees = async (c: Ctx) => {
  for (const [x, z] of OUTSIDE) await c.world.run(`fill ${x - 2} 68 ${z - 2} ${x + 2} 74 ${z + 2} air`);
};

const regrow = async (c: Ctx) => {
  await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
  await growNaturalTrees(c);
};

const aTree: Scenario = (() => {
  let obs: Observation | null = null;
  return {
    name: "insight: observe lists a grove tree with a handle, not a trunk under placed leaves, a bare trunk or a stripped one",
    timeoutMs: 60_000,
    async setup(c) {
      await calm(c);
      await clearGrove(c);
      await tree(c, 12, 4); // the tree, 7 east and 6 south of where the body stands
      await tree(c, 1, 0, true); // a trunk under placed leaves, nearer
      await c.world.run("fill 3 68 3 3 70 3 oak_log"); // a bare trunk (a cabin post), nearer
      await c.world.run("fill -3 68 0 -3 70 0 stripped_oak_log");
      await c.world.run(`tp ${c.bot} 4.5 68 -2.5`);
      await sleep(2000);
    },
    async act(c) {
      obs = await observe(c);
    },
    async verify(c) {
      const trees = (obs?.blocks ?? []).filter((b) => b.what === "oak_log");
      c.check(trees.length === 1, `one tree is listed, the three decoys are not (${JSON.stringify(trees)})`);
      c.check(/^b\d+[a-z]{2}$/.test(trees[0]?.h ?? ""), "with a block handle");
      c.check(trees[0]?.dir === "south-east" && ["close", "near"].includes(trees[0]?.d), `east and south, within a few blocks (${JSON.stringify(trees[0])})`);
      c.check(!JSON.stringify(obs).includes("stripped"), "the stripped trunk is not listed");
      c.check(JSON.stringify(obs).length <= 1200, `fits the budget (${JSON.stringify(obs).length} chars)`);
      // it is the same handle go_to takes, and what it points at is the log
      const go = await c.body.send({ intent: "go_to", handle: trees[0]?.h ?? "b0zz" });
      c.check(go.type === "accepted", `go_to the tree handle is accepted (${go.type} ${go.reason ?? ""})`);
    },
    async cleanup(c) {
      await regrow(c);
    },
  } satisfies Scenario;
})();

// Aimed at the farther of two listed trees while the nearer is in reach too: it is the far one that is cut.
const aimed: Scenario = {
  name: "insight: get_wood near a tree handle cuts that tree, not the nearest one",
  timeoutMs: 240_000,
  async setup(c) {
    await calm(c);
    await clearGrove(c);
    await tree(c, 12, 4); // A: nearest to the body
    await tree(c, 17, -3); // B
    await c.world.run(`give ${c.bot} oak_log 12`); // 4 short of the 16 it gathers up to
    await c.world.run(`tp ${c.bot} 6.5 68 -2.5`);
    await sleep(2000);
  },
  async act(c) {
    const obs = await observe(c);
    const logs = obs.blocks.filter((b) => b.what === "oak_log");
    c.check(logs.length === 2, `both trees are listed (${JSON.stringify(logs)})`);
    const far = logs.at(-1);
    const from = c.body.mark();
    const r = await c.body.send({ intent: "task", name: "get_wood", near: far?.h });
    c.check(r.type === "accepted", `accepted (${r.type} ${r.reason ?? ""})`);
    const end = await endOf(c, from, 200_000);
    c.check(end?.event === "task_finished", `finished (${end?.event} ${end?.reason ?? ""} ${end?.detail ?? ""})`);
    const done = ended(c, from);
    const got = done?.got as Record<string, number> | undefined;
    c.check(typeof got === "object" && Object.values(got).every((n) => Number.isInteger(n) && n > 0), `the end carries got (${JSON.stringify(got)})`);
  },
  async verify(c) {
    c.check((await logsAt(c, 17, -3)) <= 3, `tree B was cut (${await logsAt(c, 17, -3)} of 5 logs left)`);
    c.check((await logsAt(c, 12, 4)) === 5, "tree A, the nearest to the body, was left alone");
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "it still crafted at the home table");
  },
  async cleanup(c) {
    await regrow(c);
  },
};

// Through the adapter's own tools: a wait on the task is not woken by its progress lines, and they come in few.
const progress: Scenario = {
  name: "insight: a task sends a few task_progress lines, and wait on its taskId does not wake for them",
  timeoutMs: 240_000,
  async setup(c) {
    await calm(c);
    await clearGrove(c);
    await tree(c, 12, 4);
    await tree(c, 17, -3);
    await c.world.run(`give ${c.bot} oak_log 12`);
    await c.world.run(`tp ${c.bot} 6.5 68 -2.5`);
    await sleep(1500);
  },
  async act(c) {
    const env = readFileSync(path.join(__dirname, "..", "..", "..", "run", "bot.env"), "utf8");
    const token = env.match(/^API_TOKENS=[^:]+:(\S+)/m)?.[1] ?? "";
    const port = env.match(/^API_PORT=(\d+)/m)?.[1] ?? "8787";
    const client = new BodyClient({ url: `ws://127.0.0.1:${port}`, token });
    client.start();
    try {
      c.check(await client.ready(5000), "the adapter's client connects");
      const run = (name: string, args: object) => TOOLS.find((t) => t.name === name)!.run({ client }, args).then((r) => r.out as any);
      const act = await run("act", { action: "task", task: "get_wood", rationale: "scenario" });
      c.check(act.accepted === true && act.taskId, `accepted (${JSON.stringify(act)})`);
      const wakes: string[] = [];
      const progressed: string[] = [];
      const t0 = Date.now();
      let last: any;
      do {
        last = await run("wait", { taskId: act.taskId, timeout_s: 8 });
        wakes.push(last.reason);
        if (last.progress) progressed.push(last.progress);
      } while (last.reason === "timeout" && Date.now() - t0 < 200_000);
      const lines = client.eventsAfter(0).filter((e) => e.event === "task_progress" && e.taskId === act.taskId);
      c.check(last.reason === "task_ended", `wait ended with the task (${wakes.join(", ")})`);
      c.check(wakes.slice(0, -1).every((w) => w === "timeout"), `it never woke for a progress line (${wakes.join(", ")})`);
      c.check(lines.length >= 2 && lines.length <= 12, `a few progress lines, not dozens (${lines.length})`);
      c.check(lines.some((e) => e.step === "gathering wood") && lines.some((e) => e.step === "crafting tools"), `with steps (${lines.map((e) => e.step).join(" | ")})`);
      c.check(lines.every((e) => !/\d/.test(String(e.step))), "a step has no digit");
      c.check(String(last.ended).startsWith(`#`) && last.ended.includes("task_finished"), `the end is a finish (${last.ended})`);
      c.check(wakes.length < 2 || progressed.length > 0, `a timeout reply carries the last progress line (${progressed.at(-1)})`);
    } finally {
      client.close();
    }
  },
  async verify() {},
  async cleanup(c) {
    await regrow(c);
  },
};

// Three trees outside the grove, where the server undoes every dig, after one inside it that gives 5 logs.
const protectedRun: Scenario = (() => {
  let end: { event: string; reason?: string; detail?: unknown; got?: unknown } | undefined;
  let after: Observation | null = null;
  return {
    name: "insight: a get_wood the server keeps undoing ends protected with got and detail, and the refused places show in observe",
    timeoutMs: 240_000,
    async setup(c) {
      await calm(c);
      await clearGrove(c);
      await outsideTrees(c);
      await tree(c, 0, 0); // inside the grove: 5 logs it may take
      for (const [x, z] of OUTSIDE) await tree(c, x, z); // outside it: the digs are undone
      await c.world.run(`tp ${c.bot} 0.5 68 -3.5`);
      await sleep(2000);
    },
    async act(c) {
      const from = c.body.mark();
      c.check(await c.body.startTask(), "task accepted");
      await endOf(c, from, 200_000);
      end = ended(c, from);
      await c.body.send({ intent: "stop" });
      await sleep(1500);
      after = await observe(c);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "protected", `ended protected (${end?.event} ${end?.reason} ${end?.detail ?? ""})`);
      const got = end?.got as Record<string, number> | undefined;
      c.check((got?.oak_log ?? 0) >= 5, `got reports the logs it did get (${JSON.stringify(got)})`);
      const detail = String(end?.detail ?? "");
      c.check(/digs? undone near the trees/.test(detail) && !/\d/.test(detail), `detail says what happened, words only ("${detail}")`);
      c.check((after?.refused?.length ?? 0) >= 1 && after!.refused!.every((r) => r.d && r.dir), `observe lists the refused places (${JSON.stringify(after?.refused)})`);
      c.check(JSON.stringify(after).length <= 1200, "and still fits the budget");
      c.check(!/"(x|z|dx|dz)"/.test(JSON.stringify(after?.refused)), "with no coordinate");
      c.check((await logsAt(c, -20, -14)) === 5 && (await logsAt(c, 20, -14)) === 5 && (await logsAt(c, 0, -17)) === 5, "the outside trees still stand");
    },
    async cleanup(c) {
      await outsideTrees(c);
      await regrow(c);
      await restartBot(c); // the refused places live in the bot's memory; the next scenarios start without them
    },
  } satisfies Scenario;
})();

const idleInPool: Scenario = (() => {
  let seen: Observation | null = null;
  let out = false;
  let lowest = 20;
  return {
    name: "insight: idle in the middle of a 3-deep pool, the body swims out to a bank",
    timeoutMs: 90_000,
    view: { x: C.x - 12, y: C.y + 4, z: C.z },
    async setup(c) {
      await arena(c);
      await c.world.run("time set day");
      await pool(c);
      await c.world.run(`tp ${c.bot} 60.5 67 60.5`);
      await sleep(1500);
    },
    async act(c) {
      seen = await observe(c);
      for (const end = Date.now() + 45_000; Date.now() < end && !out; await sleep(1000)) {
        lowest = Math.min(lowest, await c.world.health(c.bot));
        if (await dry(c)) out = await dryWithin(c, 5000);
      }
    },
    async verify(c) {
      c.check(seen?.in === "deep_water", `observe says it is in deep water (${seen?.in})`);
      c.check(out, "it ends on dry ground and stays there");
      c.check(lowest >= 12, `it never came close to drowning (lowest health ${lowest})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    cleanup: tidy,
  } satisfies Scenario;
})();

// A river 7 wide and 3 deep across the whole arena, the table on the far side: the way there is through it.
const walkIntoPool: Scenario = (() => {
  let finished: string | undefined;
  let out = false;
  const riverOff = (c: Ctx) => c.world.run("fill 57 58 30 63 65 90 stone");
  return {
    name: "insight: a walk across a 3-deep river ends, and the body is out of the water after",
    timeoutMs: 150_000,
    view: { x: C.x - 12, y: C.y + 4, z: C.z },
    async setup(c) {
      await arena(c);
      await c.world.run("time set day");
      await c.world.run("fill 57 58 30 63 63 90 stone");
      await c.world.run("fill 57 64 30 63 66 90 water");
      await c.world.run("setblock 67 67 60 crafting_table");
      await c.world.run(`tp ${c.bot} 54.5 67 60.5`);
      await sleep(2000);
    },
    async act(c) {
      const obs = await observe(c);
      const table = obs.blocks.find((b) => b.what === "crafting_table");
      if (!table) throw new Error(`no table in view: ${JSON.stringify(obs.blocks)}`);
      const from = c.body.mark();
      const r = await c.body.send({ intent: "go_to", handle: table.h });
      if (r.type !== "accepted") throw new Error(`go_to ${r.type} ${r.reason}`);
      const end = await endOf(c, from, 90_000);
      finished = end ? `${end.event} ${end.reason ?? ""} ${end.detail ?? ""}` : undefined;
      out = await dryWithin(c, 20_000);
    },
    async verify(c) {
      c.check(finished !== undefined, "the walk ended");
      c.check(out, `the body is out of the water and stays out (the walk: ${finished})`);
      c.check(await c.world.nearBlock(c.bot, { x: 67, y: 67, z: 60 }, 6), `and it is on the far side (${finished})`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    async cleanup(c) {
      await riverOff(c);
      await tidy(c);
    },
  } satisfies Scenario;
})();

// 1 deep in water at the bottom of a shaft whose walls rise 3 above the water: no bank, no path
const walledPit: Scenario = (() => {
  let end: { event: string; reason?: string; detail?: unknown } | null = null;
  return {
    name: "insight: stuck in the water of a walled pit, the walk ends stuck and says water",
    timeoutMs: 120_000,
    view: { x: C.x - 8, y: C.y + 4, z: C.z },
    async setup(c) {
      await arena(c);
      await c.world.run("time set day");
      await c.world.run("fill 50 58 50 70 65 70 stone");
      await c.world.run(`fill ${C.x} 65 ${C.z} ${C.x} 66 ${C.z} air`);
      await c.world.run(`setblock ${C.x} 65 ${C.z} water`);
      await c.world.run(`fill ${C.x - 1} 67 ${C.z - 1} ${C.x + 1} 69 ${C.z + 1} stone`);
      await c.world.run(`fill ${C.x} 67 ${C.z} ${C.x} 69 ${C.z} air`);
      await c.world.run(`tp ${c.bot} ${C.x}.5 65 ${C.z}.5`);
      await sleep(2500);
    },
    async act(c) {
      const from = c.body.mark();
      const t0 = Date.now();
      const r = await c.body.send({ intent: "go_to", handle: "table" });
      if (r.type !== "accepted") throw new Error(`go_to ${r.type} ${r.reason}`);
      end = await endOf(c, from, 60_000);
      c.check(Date.now() - t0 < 60_000, `ended within 60 s (${Math.round((Date.now() - t0) / 1000)} s)`);
    },
    async verify(c) {
      c.check(end?.event === "task_failed" && end.reason === "stuck", `task_failed stuck (${end?.event} ${end?.reason})`);
      const detail = String(end?.detail ?? "");
      c.check(/water/.test(detail) && /table/.test(detail) && !/\d/.test(detail), `the detail says water and what it was doing ("${detail}")`);
      c.check((await c.world.deaths(c.bot)) === 0, "it did not die");
    },
    cleanup: tidy,
  } satisfies Scenario;
})();

export default [aTree, aimed, progress, protectedRun, idleInPool, walkIntoPool, walledPit] satisfies Scenario[];
