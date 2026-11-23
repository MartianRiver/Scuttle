// The general-purpose hands: recipe, craft, collect, equip, store, take, stash and explore. Facts come from the
// server (what the inventory and the chest hold, which blocks are gone, where the body ended up); what the body
// says is checked against them. Everything placed is taken away again, and the grove is regrown where it was cut.
import { home } from "../../src/lib/home";
import { arena, C, tidy } from "./arena";
import { growNaturalTrees } from "./get_wood.scenario";
import { sleep, type BodyEvent, type Ctx, type Observation, type Scenario } from "./lib";

const chests = [home.stashChests[0], home.stashChests[1]];
const TABLE = home.craftingTable;
const HOME_BOT = "0.5 68 -10";
const OUT = { x1: -4, x2: -2, y1: 68, y2: 69, z1: -7, z2: -6 }; // the outcrop, 12 stone blocks inside the grove
const outcrop = (c: Ctx, block: string) => c.world.run(`fill ${OUT.x1} ${OUT.y1} ${OUT.z1} ${OUT.x2} ${OUT.y2} ${OUT.z2} ${block}`);
const outcropLeft = (c: Ctx) => c.world.countBlocks({ x: OUT.x1, y: OUT.y1, z: OUT.z1 }, { x: OUT.x2, y: OUT.y2, z: OUT.z2 }, "stone");

async function calm(c: Ctx) {
  await c.body.send({ intent: "stop" });
  await sleep(1500);
  await c.world.run(`gamemode survival ${c.bot}`);
  await c.world.run(`clear ${c.bot}`);
  await c.world.run(`effect clear ${c.bot}`);
  await c.world.run(`effect give ${c.bot} minecraft:instant_health 1 10 true`);
  await c.world.run(`effect give ${c.bot} minecraft:saturation 5 10 true`);
  await c.world.run("time set day");
  await c.world.run("weather clear");
}

async function observe(c: Ctx): Promise<Observation> {
  const r = await c.body.send({ intent: "observe" });
  if (r.type !== "observation" || !r.observation) throw new Error(`observe answered ${r.type} ${r.reason ?? ""}`);
  return r.observation;
}

// one action to its end: the reply, and the finish or failure event
async function run(c: Ctx, intent: object, ms = 120_000): Promise<{ reply: string; end: BodyEvent | null; events: BodyEvent[] }> {
  const from = c.body.mark();
  const r = await c.body.send(intent);
  if (r.type !== "accepted") return { reply: r.type === "rejected" ? `rejected ${r.reason}` : r.type, end: null, events: [] };
  const stop = Date.now() + ms;
  let end: BodyEvent | undefined;
  while (!end && Date.now() < stop) {
    end = c.body.events.slice(from).find((e) => e.taskId === r.taskId && (e.event === "task_finished" || e.event === "task_failed" || e.event === "task_stopped"));
    if (!end) await sleep(100);
  }
  await sleep(400);
  return { reply: "accepted", end: end ?? null, events: c.body.events.slice(from) };
}

const said = (e: BodyEvent | null) => `${e?.event ?? "no end"} ${e?.reason ?? ""} ${e?.detail ?? ""}`.trim();

const regrow = async (c: Ctx) => {
  await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
  await growNaturalTrees(c);
};

const recipes: Scenario = {
  name: "hands: recipe says what a craft takes and what is missing, and refuses an item that does not exist",
  timeoutMs: 60_000,
  async setup(c) {
    await calm(c);
  },
  async act() {},
  async verify(c) {
    const table = (await c.body.send({ intent: "recipe", item: "crafting_table" })).recipe;
    c.check(table?.table === false && table.makes === 1 && table.needs?.planks === 4, `crafting_table: four planks, no table needed (${JSON.stringify(table)})`);
    c.check(table?.missing?.planks === 4 && table?.have?.planks === 0, "and with an empty inventory all four are missing");
    await c.world.run(`give ${c.bot} cobblestone 1`);
    await c.world.run(`give ${c.bot} stick 1`);
    await sleep(500);
    const pick = (await c.body.send({ intent: "recipe", item: "stone_pickaxe" })).recipe;
    c.check(pick?.table === true && pick.needs?.cobblestone === 3 && pick.needs?.stick === 2, `stone_pickaxe: three cobblestone and two sticks at a table (${JSON.stringify(pick)})`);
    c.check(pick?.missing?.cobblestone === 2 && pick?.missing?.stick === 1, `holding one of each it lacks two and one (${JSON.stringify(pick?.missing)})`);
    await c.world.run(`give ${c.bot} birch_planks 4`);
    await sleep(500);
    const named = (await c.body.send({ intent: "recipe", item: "crafting_table" })).recipe;
    c.check(named?.needs?.birch_planks === 4 && Object.keys(named?.missing ?? {}).length === 0, `holding birch planks it names them and lacks nothing (${JSON.stringify(named)})`);
    c.check((await c.body.send({ intent: "recipe", item: "iron_ore" })).recipe?.craftable === false, "an item nothing crafts answers craftable false");
    const none = await c.body.send({ intent: "recipe", item: "no_such_item" });
    c.check(none.type === "rejected" && none.reason === "unknown_item", `unknown_item (${none.type} ${none.reason})`);
  },
  async cleanup(c) {
    await c.world.run(`clear ${c.bot}`);
  },
};

const chain: Scenario = {
  name: "hands: with 4 logs, craft planks, a crafting table, sticks and a wooden pickaxe at the home table",
  timeoutMs: 240_000,
  async setup(c) {
    await calm(c);
    await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
    await c.world.run(`give ${c.bot} oak_log 4`);
    await sleep(1000);
  },
  async act(c) {
    const step = async (intent: object, want: Record<string, number>) => {
      const { reply, end, events } = await run(c, intent);
      c.check(reply === "accepted" && end?.event === "task_finished", `${JSON.stringify(intent)} finished (${reply} ${said(end)})`);
      for (const [item, n] of Object.entries(want)) c.check((await c.world.count(c.bot, item)) === n, `${item} is ${n} on the server (${await c.world.count(c.bot, item)})`);
      return { end, events };
    };
    const planks = await step({ intent: "craft", item: "oak_planks", count: 16 }, { oak_planks: 16, oak_log: 0 });
    c.check((planks.end?.got as Record<string, number> | undefined)?.oak_planks === 16, `the end carries got (${JSON.stringify(planks.end?.got)})`);
    await step({ intent: "craft", item: "crafting_table" }, { crafting_table: 1, oak_planks: 12 });
    await step({ intent: "craft", item: "stick", count: 4 }, { stick: 4, oak_planks: 10 });
    await step({ intent: "craft", item: "wooden_pickaxe" }, { wooden_pickaxe: 1, oak_planks: 7, stick: 2 });
    c.check(await c.world.nearBlock(c.bot, TABLE, 6), "it stood at the home table to make the pickaxe");
  },
  async verify() {},
  async cleanup(c) {
    await c.world.run(`clear ${c.bot}`);
  },
};

const short: Scenario = (() => {
  const ends: Record<string, string> = {};
  const details: Record<string, unknown> = {};
  const missing: Record<string, unknown> = {};
  return {
    name: "hands: a craft short of ingredients ends missing with the list, one with no table or no recipe says so",
    timeoutMs: 120_000,
    async setup(c) {
      await calm(c);
      await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
    },
    async act(c) {
      const note = async (key: string, intent: object) => {
        const r = await run(c, intent, 40_000);
        ends[key] = r.end?.reason ? `${r.end.event} ${r.end.reason}` : r.reply === "accepted" ? said(r.end) : r.reply;
        details[key] = r.end?.detail;
        missing[key] = r.end?.missing;
      };
      await note("table", { intent: "craft", item: "crafting_table" });
      await c.world.run(`give ${c.bot} cobblestone 1`);
      await c.world.run(`give ${c.bot} stick 1`);
      await sleep(500);
      await note("pick", { intent: "craft", item: "stone_pickaxe" });
      await note("many", { intent: "craft", item: "stick", count: 8 });
      await note("diamond", { intent: "craft", item: "iron_ore" });
      await note("nonsense", { intent: "craft", item: "no_such_item" });
      // a pickaxe it has the planks and sticks for, with the home table gone and no other near
      await c.world.run(`give ${c.bot} oak_planks 3`);
      await c.world.run(`give ${c.bot} stick 2`);
      await c.world.run(`setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} air`);
      await sleep(500);
      await note("notable", { intent: "craft", item: "wooden_pickaxe" });
    },
    async verify(c) {
      c.check(ends.table === "task_failed missing" && JSON.stringify(missing.table) === '{"planks":4}', `crafting_table: missing four planks (${ends.table} ${JSON.stringify(missing.table)})`);
      c.check(ends.pick === "task_failed missing" && JSON.stringify(missing.pick) === '{"cobblestone":2,"stick":1}', `stone_pickaxe: missing two cobblestone and a stick (${ends.pick} ${JSON.stringify(missing.pick)})`);
      c.check(typeof details.pick === "string" && /short of/.test(details.pick as string) && !/\d/.test(details.pick as string), `with a detail in words (${details.pick})`);
      c.check(ends.many === "task_failed missing" && JSON.stringify(missing.many) === '{"planks":4}', `eight sticks are two crafts, four planks it has not (${ends.many} ${JSON.stringify(missing.many)})`);
      c.check(ends.diamond === "task_failed no_recipe", `iron_ore: no_recipe (${ends.diamond})`);
      c.check(ends.nonsense === "rejected unknown_item", `an unknown item is refused at once (${ends.nonsense})`);
      c.check(ends.notable === "task_failed no_table", `no table in reach and none at home: no_table (${ends.notable})`);
      c.check((await c.world.count(c.bot, "wooden_pickaxe")) === 0, "nothing was made");
    },
    async cleanup(c) {
      await c.world.run(`setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} crafting_table`);
      await c.world.run(`clear ${c.bot}`);
    },
  } satisfies Scenario;
})();

// a tree the way build_home.py grows them
async function tree(c: Ctx, x: number, z: number) {
  await c.world.run(`fill ${x - 2} 70 ${z - 2} ${x + 2} 71 ${z + 2} oak_leaves`);
  await c.world.run(`fill ${x - 1} 72 ${z - 1} ${x + 1} 73 ${z + 1} oak_leaves`);
  await c.world.run(`fill ${x} 68 ${z} ${x} 72 ${z} oak_log`);
}

const collectTree: Scenario = (() => {
  let end: BodyEvent | null = null;
  let handle = "";
  return {
    name: "hands: collect a tree handle takes that tree's logs and not the build against it",
    timeoutMs: 180_000,
    async setup(c) {
      await calm(c);
      await c.world.run("fill -24 68 -10 24 95 12 air");
      await tree(c, 12, 4);
      await c.world.run("fill 13 68 4 13 70 4 oak_log"); // a cabin post against the trunk, under the same leaves
      await c.world.run(`tp ${c.bot} 4.5 68 -2.5`);
      await sleep(2000);
    },
    async act(c) {
      const obs = await observe(c);
      handle = obs.blocks.find((b) => b.what === "oak_log")?.h ?? "";
      c.check(handle !== "", `the tree is listed (${JSON.stringify(obs.blocks)})`);
      const r = await run(c, { intent: "collect", handle }, 150_000);
      end = r.end;
      c.check(r.reply === "accepted", `collect accepted (${r.reply})`);
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `finished (${said(end)})`);
      const got = (end?.got as Record<string, number> | undefined)?.oak_log ?? 0;
      c.check(got >= 4 && got <= 5, `got the tree's logs, not more (${JSON.stringify(end?.got)})`);
      c.check((await c.world.countBlocks({ x: 12, y: 68, z: 4 }, { x: 12, y: 72, z: 4 }, "oak_log")) <= 1, "the trunk is gone");
      c.check((await c.world.countBlocks({ x: 13, y: 68, z: 4 }, { x: 13, y: 70, z: 4 }, "oak_log")) === 3, "the post against it is untouched");
      c.check((await c.world.count(c.bot, "oak_log")) === got, "and the logs are in the inventory");
    },
    async cleanup(c) {
      await regrow(c);
    },
  } satisfies Scenario;
})();

const collectStone: Scenario = (() => {
  let bare: BodyEvent | null = null;
  let armed: BodyEvent | null = null;
  let handle = "";
  return {
    name: "hands: collect a stone handle with no pickaxe ends no_tool, with one it takes that stone and its neighbours",
    timeoutMs: 180_000,
    async setup(c) {
      await calm(c);
      await outcrop(c, "stone");
      await c.world.run(`tp ${c.bot} -2.5 68 -10.5`);
      await sleep(2000);
    },
    async act(c) {
      const obs = await observe(c);
      const stone = obs.blocks.find((b) => b.what === "stone");
      handle = stone?.h ?? "";
      c.check(handle !== "" && obs.stone !== undefined, `the stone is listed with a handle (${JSON.stringify(stone)}, stone ${obs.stone})`);
      c.check(JSON.stringify(obs).length <= 1200, "within the budget");
      bare = (await run(c, { intent: "collect", handle }, 30_000)).end;
      await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
      await sleep(500);
      armed = (await run(c, { intent: "collect", handle, count: 3 }, 150_000)).end;
    },
    async verify(c) {
      c.check(bare?.event === "task_failed" && bare.reason === "no_tool", `no pickaxe: no_tool (${said(bare)})`);
      c.check(/pickaxe/.test(String(bare?.detail)) && !/\d/.test(String(bare?.detail)), `the detail says which tool ("${bare?.detail}")`);
      c.check(armed?.event === "task_finished", `with a pickaxe it finished (${said(armed)})`);
      c.check((await c.world.count(c.bot, "cobblestone")) === 3, `three cobblestone (${await c.world.count(c.bot, "cobblestone")})`);
      c.check((await outcropLeft(c)) === 9, `three of twelve stone blocks gone (${await outcropLeft(c)} left)`);
      c.check((armed?.got as Record<string, number> | undefined)?.cobblestone === 3, `got says so (${JSON.stringify(armed?.got)})`);
    },
    async cleanup(c) {
      await outcrop(c, "air");
      await c.world.run(`kill @e[type=item,x=-3,y=68,z=-6,distance=..20]`);
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
    },
  } satisfies Scenario;
})();

const collectRefused: Scenario = (() => {
  let ore: BodyEvent | null = null;
  let table: BodyEvent | null = null;
  return {
    name: "hands: collect refuses a placed block and an ore with a player's build against it",
    timeoutMs: 120_000,
    async setup(c) {
      await calm(c);
      await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
      await c.world.run("setblock -8 68 -8 coal_ore");
      await c.world.run("setblock -8 68 -7 oak_planks");
      await c.world.run("setblock -5 68 -12 crafting_table");
      await c.world.run(`tp ${c.bot} -6.5 68 -10.5`);
      await sleep(2000);
    },
    async act(c) {
      const obs = await observe(c);
      const coal = obs.blocks.find((b) => b.what === "coal_ore")?.h ?? "";
      const bench = obs.blocks.find((b) => b.what === "crafting_table")?.h ?? "";
      c.check(coal !== "" && bench !== "", `both are listed (${JSON.stringify(obs.blocks)})`);
      ore = (await run(c, { intent: "collect", handle: coal }, 30_000)).end;
      table = (await run(c, { intent: "collect", handle: bench }, 30_000)).end;
    },
    async verify(c) {
      c.check(ore?.event === "task_failed" && ore.reason === "refused" && /built/.test(String(ore.detail)), `the ore beside planks: refused, a build near (${said(ore)})`);
      c.check(table?.event === "task_failed" && table.reason === "refused" && /natural/.test(String(table.detail)), `the table: refused, not natural (${said(table)})`);
      c.check(await c.world.blockIs({ x: -8, y: 68, z: -8 }, "coal_ore"), "the ore is still there");
      c.check(await c.world.blockIs({ x: -5, y: 68, z: -12 }, "crafting_table"), "and so is the table");
    },
    async cleanup(c) {
      for (const p of ["-8 68 -8", "-8 68 -7", "-5 68 -12"]) await c.world.run(`setblock ${p} air`);
      await c.world.run(`clear ${c.bot}`);
      await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
    },
  } satisfies Scenario;
})();

const equip: Scenario = {
  name: "hands: equip puts armour on its slot and a sword in the hand, and idle code leaves it there",
  timeoutMs: 90_000,
  async setup(c) {
    await calm(c);
    await c.world.run(`give ${c.bot} iron_chestplate 1`);
    await c.world.run(`give ${c.bot} iron_sword 1`);
    await c.world.run(`give ${c.bot} wooden_pickaxe 1`);
    await sleep(800);
  },
  async act() {},
  async verify(c) {
    const none = await c.body.send({ intent: "equip", item: "diamond_sword" });
    c.check(none.type === "rejected" && none.reason === "none_held", `none_held (${none.type} ${none.reason})`);
    const armour = await c.body.send({ intent: "equip", item: "iron_chestplate" });
    c.check(armour.type === "accepted" && armour.taskId === undefined, `accepted at once with no task (${armour.type} ${armour.taskId})`);
    await sleep(1500);
    c.check((await observe(c)).armor === 6, "observe shows armour 6");
    c.check((await c.world.run(`data get entity ${c.bot} equipment.chest.id`)).includes("iron_chestplate"), "the server has it on the chest slot");
    await c.body.send({ intent: "equip", item: "iron_sword" });
    await sleep(1500);
    c.check((await observe(c)).held === "iron_sword", "the sword is in the hand");
    await sleep(12_000); // a meal or an idle tick must not put the pickaxe back
    c.check((await observe(c)).held === "iron_sword", "and still there after 12 s idle");
    await c.world.run(`item replace entity ${c.bot} weapon.mainhand with minecraft:bread 3`);
    await sleep(800);
  },
  async cleanup(c) {
    await c.world.run(`item replace entity ${c.bot} armor.chest with minecraft:air`);
    await c.world.run(`clear ${c.bot}`);
  },
};

const stash: Scenario = (() => {
  let stored: BodyEvent | null = null;
  let taken: BodyEvent | null = null;
  let none: BodyEvent | null = null;
  const wipe = async (c: Ctx) => {
    for (const p of chests) await c.world.run(`data modify block ${p.x} ${p.y} ${p.z} Items set value []`);
  };
  return {
    name: "hands: store puts the spare in the stash, stash lists it, take brings some back",
    timeoutMs: 240_000,
    async setup(c) {
      await calm(c);
      await wipe(c);
      await c.world.run(`tp ${c.bot} ${HOME_BOT}`);
      await c.world.run(`give ${c.bot} oak_log 20`);
      await c.world.run(`give ${c.bot} cobblestone 10`);
      await c.world.run(`give ${c.bot} iron_pickaxe 1`);
      await c.world.run(`give ${c.bot} bread 20`);
      await sleep(1000);
    },
    async act(c) {
      stored = (await run(c, { intent: "store" }, 150_000)).end;
      const s = (await c.body.send({ intent: "stash" })).stash;
      c.check(s?.items.oak_log === 20 && s?.items.cobblestone === 6 && s?.items.bread === 4, `stash lists what went in (${JSON.stringify(s)})`);
      c.check(s?.looked === "just now", `it says it looked just now (${s?.looked}; unseen and fresh depend on what earlier runs opened)`);
      c.check(s !== undefined && !("iron_pickaxe" in s.items), "the pickaxe is not in it");
      taken = (await run(c, { intent: "take", item: "oak_log", count: 8 }, 150_000)).end;
      none = (await run(c, { intent: "take", item: "iron_ore" }, 120_000)).end;
    },
    async verify(c) {
      c.check(stored?.event === "task_finished", `store finished (${said(stored)})`);
      const st = stored?.stored as Record<string, number> | undefined;
      c.check(st?.oak_log === 20 && st?.cobblestone === 6 && st?.bread === 4, `stored= says what went in (${JSON.stringify(st)})`);
      c.check((await c.world.count(c.bot, "iron_pickaxe")) === 1 && (await c.world.count(c.bot, "cobblestone")) === 4 && (await c.world.count(c.bot, "bread")) === 16, "it kept the pickaxe, 4 cobblestone and 16 bread");
      c.check(taken?.event === "task_finished" && (taken.got as Record<string, number> | undefined)?.oak_log === 8, `take 8 finished with got (${said(taken)} ${JSON.stringify(taken?.got)})`);
      c.check((await c.world.count(c.bot, "oak_log")) === 8 && (await c.world.chestCount(chests[0], "oak_log")) === 12, "8 logs in the inventory, 12 left in the chest");
      c.check((await c.body.send({ intent: "stash" })).stash?.items.oak_log === 12, "stash now says 12");
      c.check(none?.event === "task_failed" && none.reason === "none_stashed", `take of what is not there: none_stashed (${said(none)})`);
    },
    async cleanup(c) {
      await wipe(c);
      await c.world.run(`clear ${c.bot}`);
    },
  } satisfies Scenario;
})();

const explore: Scenario = (() => {
  let end: BodyEvent | null = null;
  let events: BodyEvent[] = [];
  let at: number[] = [];
  let far = "";
  let south = "";
  return {
    name: "hands: explore east a short walk ends 16 to 32 blocks east and says what it saw, and past 160 from home is too_far",
    timeoutMs: 150_000,
    view: { x: 45, y: 72, z: 50 },
    async setup(c) {
      await arena(c);
      await c.world.run("time set day");
      await c.world.run(`tp ${c.bot} 40.5 67 60.5`);
      await c.world.run("setblock 58 67 64 coal_ore");
      await sleep(2000);
    },
    async act(c) {
      const r = await run(c, { intent: "explore", dir: "east" }, 120_000);
      end = r.end;
      events = r.events;
      at = await c.world.pos(c.bot);
      const f = await c.body.send({ intent: "explore", dir: "east", far: "far" });
      far = f.type === "rejected" ? `rejected ${f.reason}` : f.type;
      const s = await c.body.send({ intent: "explore", dir: "south", far: "far" });
      south = s.type === "rejected" ? `rejected ${s.reason}` : s.type;
    },
    async verify(c) {
      c.check(end?.event === "task_finished", `finished (${said(end)})`);
      const dx = at[0] - 40.5;
      c.check(dx >= 16 && dx <= 32 && Math.abs(at[2] - 60.5) <= 6, `ended 16 to 32 blocks east of where it started (${dx.toFixed(1)} east, z ${at[2]?.toFixed(1)})`);
      c.check(String(end?.saw ?? "").includes("coal ore") && !/\d/.test(String(end?.saw)), `saw names the ore placed there ("${end?.saw}")`);
      c.check(events.some((e) => e.event === "task_progress" && /exploring/.test(String(e.step))), "it sent a progress line");
      c.check(far === "rejected too_far" && south === "rejected too_far", `a target past the leash from home is too_far (${far}, ${south})`);
    },
    async cleanup(c) {
      await c.world.run("setblock 58 67 64 air");
      await tidy(c);
    },
  } satisfies Scenario;
})();

export default [recipes, chain, short, collectTree, collectStone, collectRefused, equip, stash, explore] satisfies Scenario[];
