// Fight or run, with an iron sword in the inventory (not in hand: equipping is the body's job). Facts
// from the server: deaths, lowest health, which mobs are still alive at the end. Nothing here says how
// to fight, only who is left standing. The mobs that should be run from are the policy's half.
import { arena, C, leave, onPlatform, rel } from "./arena";
import { sleep, type Ctx, type Scenario } from "./lib";

const RUN_MS = 30_000;

const alive = (c: Ctx, type: string) => c.world.passes(`execute if entity @e[type=${type},x=${C.x},y=${C.y},z=${C.z},distance=..60]`);

interface Opts {
  mobs: Array<[string, number, number]>;
  minHealth: number;
  maxHealth?: number; // the bot's max health for the run, to be hurt without the health coming back
  killed?: string[]; // mob types that must be gone at the end
  spared?: string[]; // mob types that must still be there: the body ran instead
  give?: string[]; // more than the sword
  bystander?: boolean; // a cow pinned beside the bot, which a sword's sweep would hit
}

const cowHealth = async (c: Ctx) =>
  Number((await c.world.run(`data get entity @e[type=cow,x=${C.x},y=${C.y},z=${C.z},distance=..10,limit=1] Health`)).match(/(-?[\d.]+)f\s*$/)?.[1] ?? NaN);

function scenario(name: string, o: Opts): Scenario {
  let lowest = 20;
  return {
    name,
    timeoutMs: 90_000,
    view: rel(-12, 0),
    async setup(c) {
      await arena(c);
      await c.world.run(`give ${c.bot} iron_sword`);
      for (const item of o.give ?? []) await c.world.run(`give ${c.bot} ${item}`);
      if (o.bystander) await c.world.run(`summon minecraft:cow ${C.x + 1} ${C.y} ${C.z + 1} {NoAI:1b,PersistenceRequired:1b}`);
      if (o.maxHealth) await c.world.run(`attribute ${c.bot} minecraft:max_health base set ${o.maxHealth}`);
      await sleep(500);
    },
    async act(c) {
      for (const [type, dx, dz] of o.mobs) {
        const p = rel(dx, dz);
        await c.world.run(`summon minecraft:${type} ${p.x} ${p.y} ${p.z} {PersistenceRequired:1b,IsBaby:0b}`);
      }
      lowest = 20;
      for (const end = Date.now() + RUN_MS; Date.now() < end; await sleep(500)) {
        lowest = Math.min(lowest, await c.world.health(c.bot));
      }
    },
    async verify(c) {
      c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
      c.check(await onPlatform(c), "the bot is still on the platform");
      c.check(lowest >= o.minHealth, `health stayed at ${o.minHealth} or more (lowest ${lowest})`);
      for (const t of o.killed ?? []) c.check(!(await alive(c, t)), `no ${t} left`);
      for (const t of o.spared ?? []) c.check(await alive(c, t), `the ${t} was left alone`);
      if (o.bystander) c.check((await cowHealth(c)) === 10, `the cow beside it was not hit (health ${await cowHealth(c)})`);
    },
    async cleanup(c) {
      await c.world.run(`attribute ${c.bot} minecraft:max_health base set 20`);
      await c.world.run(`tp @e[type=cow,x=${C.x},y=${C.y},z=${C.z},distance=..30] ${C.x} -500 ${C.z}`);
      await leave(c);
    },
  };
}

export default [
  scenario("sword: one zombie is fought and killed", { mobs: [["zombie", 6, 0]], minHealth: 12, killed: ["zombie"] }),
  scenario("sword: two zombies are fought and killed", { mobs: [["zombie", 6, 0], ["zombie", -6, 3]], minHealth: 8, killed: ["zombie"] }),
  scenario("sword: a creeper is still run from", { mobs: [["creeper", 7, 0]], minHealth: 12, spared: ["creeper"] }),
  scenario("sword: too hurt to fight, a zombie is run from", { mobs: [["zombie", 6, 0]], minHealth: 4, maxHealth: 10, spared: ["zombie"] }),
  // passes with the sweep guard turned off too (2026-11-23): no sweep happened in this setup, so it shows
  // the cow comes to no harm, not that the guard works; that rests on the unit tests for now
  scenario("sword: a cow beside the fight is not hurt", { mobs: [["zombie", 2, 0]], minHealth: 4, bystander: true }),
  scenario("sword and axe: with a cow beside it the axe kills the zombie", { mobs: [["zombie", 2, 0]], minHealth: 10, bystander: true, give: ["stone_axe"], killed: ["zombie"] }),
  scenario("sword: two skeletons are run from", { mobs: [["skeleton", 14, 3], ["skeleton", -14, -3]], minHealth: 8, spared: ["skeleton"] }),
];
