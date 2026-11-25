// Senses: what `observe` lists and what it must not, and `go_to` a handle. Facts about the world come
// from the server (where things were put, where the body ended up); what the body says is checked
// against that. Mobs are NoAI so they stay where they were put, and the zombie stands 14 blocks out,
// past the 10 at which the defence reflex would move the body mid-check.
// The last scenario restarts the bot process; the runner's socket is replaced, the bot ends idle.
import { arena, C, tidy } from "./arena";
import { restartBot as restart, sleep, type Ctx, type Observation, type Scenario } from "./lib";

const MOB = "NoAI:1b,PersistenceRequired:1b";
const at = (dx: number, dz: number, dy = 0) => `${C.x + dx + 0.5} ${C.y + dy} ${C.z + dz + 0.5}`;

async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

// a block change needs a moment to reach the body
const settle = () => sleep(800);

const clearMobs = async (c: Ctx) => {
  for (const t of ["cow", "zombie", "chicken"]) await c.world.run(`kill @e[type=${t},x=${C.x},y=${C.y},z=${C.z},distance=..60]`);
};

const walkEnd = async (c: Ctx, from: number, ms: number) => {
  const end = await c.body.waitEvent("task_finished", from, ms);
  const failed = c.body.events.slice(from).find((e) => e.event === "task_failed");
  return { end, failed };
};

// scenarios that put things in the arena all tidy up the same way
const arenaScenario = (name: string, o: Pick<Scenario, "act" | "verify"> & { setup?(c: Ctx): Promise<void>; timeoutMs?: number }): Scenario => ({
  name,
  timeoutMs: o.timeoutMs ?? 60_000,
  async setup(c) {
    await arena(c);
    await o.setup?.(c);
    await settle();
  },
  act: o.act,
  verify: o.verify,
  async cleanup(c) {
    await clearMobs(c);
    await c.world.run(`clear ${c.bot}`);
    await tidy(c);
  },
});

const WALL = "fill 72 67 55 72 69 65 stone";
const NO_WALL = "fill 72 67 55 72 69 65 air";

export default [
  (() => {
    let obs: Observation | null = null;
    let json = "";
    return {
      name: "senses: at home it lists the table, stash and furnace as handles, its inventory grouped, inside the budget",
      timeoutMs: 40_000,
      async setup(c) {
        await c.world.run("time set day");
        await c.world.run("weather clear");
        await c.world.run(`gamemode survival ${c.bot}`);
        await c.world.run(`clear ${c.bot}`);
        await c.world.run(`give ${c.bot} oak_log 12`);
        await c.world.run(`give ${c.bot} oak_log 30`); // two stacks of one item: one count
        await c.world.run(`give ${c.bot} cobblestone 40`);
        await c.world.run(`give ${c.bot} iron_pickaxe 1`);
        await c.world.run(`tp ${c.bot} 0.5 68 -26`);
        await sleep(6000); // the rain fades out over a few seconds
      },
      async act(c) {
        obs = await observe(c);
        json = JSON.stringify(obs);
      },
      async verify(c) {
        c.check(obs?.where === "at home, on the surface", `where is "at home, on the surface" (${obs?.where})`);
        for (const place of ["home", "table", "stash", "furnace", "bed"]) c.check(typeof obs?.places?.[place] === "string", `places has ${place} (${JSON.stringify(obs?.places)})`);
        c.check(obs?.places?.table === "close south", `the table is close, south (${obs?.places?.table})`);
        c.check(obs?.inv?.oak_log === 42 && obs?.inv?.cobblestone === 40, `inventory grouped: 42 oak_log, 40 cobblestone (${JSON.stringify(obs?.inv)})`);
        c.check(obs?.tools?.[0] === "iron_pickaxe 100%", `the pickaxe is listed with its durability (${JSON.stringify(obs?.tools)})`);
        c.check(!("iron_pickaxe" in (obs?.inv ?? {})), "a tool is not counted among the items");
        c.check(obs?.time === "day" && obs?.weather === "clear", `time day, weather clear (${obs?.time} ${obs?.weather})`);
        c.check(obs?.health === 20, `health 20 (${obs?.health})`);
        c.check(json.length <= 1200, `fits the budget: ${json.length} chars`);
        const { pos: _own, ...rest } = obs as unknown as Record<string, unknown>;
        c.check(!/"(x|y|z|dx|dy|dz|position)"/.test(JSON.stringify(rest)), "no coordinate key beyond the body's own pos");
      },
      async cleanup(c) {
        await c.world.run(`clear ${c.bot}`);
        await c.world.run(`tp ${c.bot} 0.5 68 -10`);
      },
    } satisfies Scenario;
  })(),

  (() => {
    let obs: Observation | null = null;
    return arenaScenario("senses: cows 6, 12 and 24 blocks off are listed with their band and compass point", {
      async setup(c) {
        await c.world.run(`summon cow ${at(6, 0)} {${MOB}}`); // east
        await c.world.run(`summon cow ${at(0, -12)} {${MOB},Health:3f}`); // north, hurt
        await c.world.run(`summon cow ${at(-24, 0)} {${MOB}}`); // west
        await c.world.run(`summon cow ${at(28, 28)} {${MOB}}`); // beyond sight
      },
      async act(c) {
        obs = await observe(c);
      },
      async verify(c) {
        const cows = (obs?.near ?? []).filter((e) => e.what === "cow");
        const find = (dir: string) => cows.find((e) => e.dir === dir);
        c.check(cows.length === 3, `three cows listed, the fourth is out of range (${cows.length})`);
        c.check(find("east")?.d === "close", `the east cow is close (${JSON.stringify(find("east"))})`);
        c.check(find("north")?.d === "near" && find("north")?.hp === "low", `the north cow is near and low (${JSON.stringify(find("north"))})`);
        c.check(find("west")?.d === "a short walk", `the west cow is a short walk (${JSON.stringify(find("west"))})`);
        c.check(cows.every((e) => /^e\d+[a-z]{2}$/.test(e.h)), "each has an entity handle");
        c.check(find("east")?.hp === undefined, "a cow at full health has no hp");
        c.check(obs?.time === "night", `it is night (${obs?.time})`);
      },
    });
  })(),

  (() => {
    let before: Observation | null = null;
    let after: Observation | null = null;
    return arenaScenario("senses: a zombie behind a 3-high stone wall is not listed, and is once the wall is gone", {
      async setup(c) {
        await c.world.run(WALL);
        await c.world.run(`summon zombie ${at(14, 0)} {${MOB}}`);
      },
      async act(c) {
        before = await observe(c);
        await c.world.run(NO_WALL);
        await settle();
        after = await observe(c);
      },
      async verify(c) {
        c.check(!before?.near.some((e) => e.what === "zombie"), `behind the wall: not listed (${JSON.stringify(before?.near)})`);
        const z = after?.near.find((e) => e.what === "zombie");
        c.check(z?.k === "hostile" && z?.dir === "east" && z?.d === "near", `wall gone: listed as a hostile, east, near (${JSON.stringify(z)})`);
      },
    });
  })(),

  (() => {
    let hidden: Observation | null = null;
    let seen: Observation | null = null;
    const ores = (o: Observation | null) => (o?.blocks ?? []).filter((b) => b.what === "diamond_ore");
    return arenaScenario("senses: diamond ore buried in stone or behind a wall is not listed, exposed ore in view is", {
      async setup(c) {
        // a 3-cube of stone with ore at its middle, north of the body
        await c.world.run(`fill ${C.x + 4} ${C.y} ${C.z - 8} ${C.x + 6} ${C.y + 2} ${C.z - 6} stone`);
        await c.world.run(`setblock ${C.x + 5} ${C.y + 1} ${C.z - 7} diamond_ore`);
        // ore with all its faces open, but a wall in the way
        await c.world.run(WALL);
        await c.world.run(`setblock ${C.x + 15} ${C.y} ${C.z} diamond_ore`);
      },
      async act(c) {
        hidden = await observe(c);
        await c.world.run(`setblock ${C.x - 4} ${C.y} ${C.z - 3} diamond_ore`);
        await settle();
        seen = await observe(c);
      },
      async verify(c) {
        c.check(ores(hidden).length === 0, `buried and walled ore not listed (${JSON.stringify(ores(hidden))})`);
        c.check(ores(seen).length === 1, `only the exposed ore is listed (${JSON.stringify(ores(seen))})`);
        c.check(ores(seen)[0]?.dir === "north-west" && ores(seen)[0]?.d === "close", `it is close, north-west (${JSON.stringify(ores(seen)[0])})`);
        c.check(/^b\d+[a-z]{2}$/.test(ores(seen)[0]?.h ?? ""), "with a block handle");
      },
    });
  })(),

  (() => {
    let table: { reply: string; finished: boolean; failed?: string } | null = null;
    let cow: { reply: string; finished: boolean; failed?: string } | null = null;
    let startKind = "";
    let tableDist = false;
    let cowDist = false;
    const go = async (c: Ctx, handle: string) => {
      const mark = c.body.mark();
      const r = await c.body.send({ intent: "go_to", handle });
      const reply = r.type === "rejected" ? `rejected ${r.reason}` : r.type;
      if (r.type !== "accepted") return { reply, finished: false };
      startKind = String(c.body.events.slice(mark).find((e) => e.event === "task_started")?.kind ?? startKind);
      const { end, failed } = await walkEnd(c, mark, 40_000);
      return { reply, finished: Boolean(end), failed: failed?.reason };
    };
    return arenaScenario("senses: go_to a block handle and an entity handle walks there and finishes", {
      timeoutMs: 120_000,
      async setup(c) {
        await c.world.run(`setblock ${C.x} ${C.y} ${C.z - 12} crafting_table`);
        await c.world.run(`summon cow ${at(8, 4)} {${MOB}}`);
      },
      async act(c) {
        const obs = await observe(c);
        const tableH = obs.blocks.find((b) => b.what === "crafting_table")?.h;
        const cowH = obs.near.find((e) => e.what === "cow")?.h;
        if (!tableH || !cowH) throw new Error(`no handles: ${JSON.stringify(obs)}`);
        table = await go(c, tableH);
        tableDist = await c.world.nearBlock(c.bot, { x: C.x, y: C.y, z: C.z - 12 }, 5);
        cow = await go(c, cowH);
        cowDist = await c.world.nearBlock(c.bot, { x: C.x + 8, y: C.y, z: C.z + 4 }, 5);
      },
      async verify(c) {
        c.check(table?.reply === "accepted" && table.finished, `go_to the table finished (${JSON.stringify(table)})`);
        c.check(tableDist, "the body stands within 5 blocks of the table");
        c.check(startKind.startsWith("go_to:"), `the task is a go_to (${startKind})`);
        c.check(cow?.reply === "accepted" && cow.finished, `go_to the cow finished (${JSON.stringify(cow)})`);
        c.check(cowDist, "the body stands within 5 blocks of the cow");
      },
    });
  })(),

  (() => {
    let reply = "";
    let known = "";
    let fresh = "";
    let walked = false;
    const restartBot = (c: Ctx) => restart(c, "/tmp/scuttle-run/bot-senses.log");
    return arenaScenario("senses: a handle from before a bot restart answers stale_handle, a new one works", {
      timeoutMs: 120_000,
      async setup(c) {
        await c.world.run(`summon cow ${at(6, 0)} {${MOB}}`);
      },
      async act(c) {
        const obs = await observe(c);
        known = obs.near.find((e) => e.what === "cow")?.h ?? "";
        await restartBot(c);
        await c.world.run(`tp ${c.bot} ${C.x} ${C.y} ${C.z}`);
        await sleep(2500);
        const again = await observe(c); // the new process mints its own handles, which is when a collision would show
        fresh = again.near.find((e) => e.what === "cow")?.h ?? "";
        const r = await c.body.send({ intent: "go_to", handle: known });
        reply = r.type === "rejected" ? `rejected ${r.reason}` : r.type;
        const mark = c.body.mark();
        const ok = await c.body.send({ intent: "go_to", handle: fresh });
        walked = ok.type === "accepted" && Boolean((await walkEnd(c, mark, 30_000)).end);
      },
      async verify(c) {
        c.check(/^e\d+[a-z]{2}$/.test(known) && /^e\d+[a-z]{2}$/.test(fresh), `both are entity handles (${known}, ${fresh})`);
        c.check(known !== fresh, `the new handle differs from the old (${known}, ${fresh})`);
        c.check(reply === "rejected stale_handle", `the old handle is stale_handle (${reply})`);
        c.check(walked, "the new handle works");
      },
    });
  })(),
] satisfies Scenario[];
