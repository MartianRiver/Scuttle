// Guarding a player: a second offline bot, Ward, stands in the arena and ScuttleTest is told to guard
// it. Facts from the server only: which mobs are alive, who died, who stands where, plus the body's own
// events (a guard that a reflex ended would have said so). The bot has an iron sword and axe in the
// inventory and iron armour on; equipping the weapon is its own job. The Ward is in survival and not
// buffed: a guard that fails here really does lose it.
import mineflayer from "mineflayer";
import { mcPort } from "../slot";
import { arena, C, leave, rel } from "./arena";
import { sleep, type Ctx, type Scenario } from "./lib";

const WARD = "Ward";
const ARMOUR = ["head helmet", "chest chestplate", "legs leggings", "feet boots"];

// the Ward's own connection; quit() is safe to call any number of times and from cleanup after a failure
class WardBot {
  private bot: mineflayer.Bot | null = null;

  async join(): Promise<void> {
    const bot = mineflayer.createBot({ host: "127.0.0.1", port: mcPort, username: WARD, auth: "offline" });
    this.bot = bot; // kept before spawn, so a join that times out is still quit by cleanup
    bot.on("error", () => {});
    bot.on("kicked", () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Ward did not spawn within 20 s")), 20_000);
      bot.once("spawn", () => {
        clearTimeout(timer);
        resolve();
      });
      bot.once("end", () => {
        clearTimeout(timer);
        reject(new Error("Ward's connection ended before it spawned"));
      });
    });
  }

  say(msg: string): void {
    this.bot?.chat(msg);
  }

  async quit(): Promise<void> {
    const bot = this.bot;
    this.bot = null;
    if (!bot) return;
    const ended = new Promise<void>((resolve) => bot.once("end", () => resolve()));
    bot.quit();
    // a socket that never closes must not hold the next scenario up
    await Promise.race([ended, sleep(5000)]);
  }
}

const wardSpot = (dx: number, dz: number) => `${C.x + dx + 0.5} ${C.y} ${C.z + dz + 0.5}`;
const aliveNear = (c: Ctx, type: string) =>
  c.world.passes(`execute if entity @e[type=${type},x=${C.x},y=${C.y},z=${C.z},distance=..60]`);
const botNearWard = (c: Ctx, blocks: number) => c.world.passes(`execute at ${WARD} if entity @a[name=${c.bot},distance=..${blocks}]`);

async function until(ms: number, test: () => Promise<boolean>): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await test()) return Date.now() - t0;
    await sleep(500);
  }
  return null;
}

interface Opts {
  timeoutMs?: number;
  run(c: Ctx, g: Guard): Promise<void>;
  verify(c: Ctx, g: Guard): void | Promise<void>;
}

// what a scenario can do once the Ward is in place; `mark` is where the body's events start
interface Guard {
  ward: WardBot;
  mark: number;
  taskId?: string;
  start(c: Ctx, how: "chat" | "intent"): Promise<void>;
}

function scenario(name: string, o: Opts): Scenario {
  const ward = new WardBot();
  const g: Guard = {
    ward,
    mark: 0,
    start: async (c, how) => {
      g.mark = c.body.mark();
      if (how === "chat") {
        // a chat the bot rejects (the Ward not in view yet) is silent, so say it again a couple of times
        let started = null;
        for (let i = 0; i < 3 && !started; i++) {
          ward.say("guard me");
          started = await c.body.waitEvent("task_started", g.mark, 3000);
        }
        c.check(started?.kind === `guard:${WARD}`, `"guard me" in chat started a guard (got ${started?.kind ?? "nothing"})`);
        g.taskId = started?.taskId;
        return;
      }
      // the Ward may not have loaded for the bot yet
      for (let i = 0; i < 6; i++) {
        const reply = await c.body.send({ intent: "guard", player: WARD });
        if (reply.type === "accepted") {
          g.taskId = reply.taskId;
          return;
        }
        await sleep(1000);
      }
      c.check(false, "the guard intent was accepted");
    },
  };
  return {
    name,
    timeoutMs: o.timeoutMs ?? 60_000,
    view: rel(-12, 0),
    async setup(c) {
      await arena(c);
      await c.world.run(`give ${c.bot} iron_sword`);
      await c.world.run(`give ${c.bot} iron_axe`);
      for (const piece of ARMOUR) {
        const [slot, item] = piece.split(" ");
        await c.world.run(`item replace entity ${c.bot} armor.${slot} with minecraft:iron_${item}`);
      }
      await ward.join();
      await c.world.run(`gamemode survival ${WARD}`);
      await c.world.run(`tp ${WARD} ${wardSpot(3, 0)}`);
      await c.world.trackDeaths(WARD);
      await sleep(1500); // the bot has to have the Ward in view
    },
    async act(c) {
      await o.run(c, g);
    },
    async verify(c) {
      await o.verify(c, g);
    },
    async cleanup(c) {
      await ward.quit();
      await c.world.run(`clear ${c.bot}`);
      await leave(c);
    },
  };
}

// a guard that was ended by anything (a reflex included) leaves one of these in the events
const ended = (c: Ctx, g: Guard) => c.body.events.slice(g.mark).filter((e) => e.event === "task_failed" || e.event === "task_stopped");

const noDeaths = async (c: Ctx) => {
  c.check((await c.world.deaths(c.bot)) === 0, "the bot did not die");
  c.check((await c.world.deaths(WARD)) === 0, "the Ward did not die");
};

// a zombie 6 blocks from the Ward, on the side away from the bot
const zombieAtWard = (c: Ctx) =>
  c.world.run(`summon minecraft:zombie ${wardSpot(3, 6)} {PersistenceRequired:1b,IsBaby:0b}`);

export default [
  (() => {
    let killedIn: number | null = null;
    return scenario("guard: a zombie 6 blocks from the ward is killed", {
      async run(c, g) {
        await g.start(c, "chat");
        await sleep(2500);
        await zombieAtWard(c);
        killedIn = await until(25_000, async () => !(await aliveNear(c, "zombie")));
      },
      async verify(c, g) {
        c.check(killedIn !== null, "the zombie was dead within 25 s");
        await noDeaths(c);
        c.check(ended(c, g).length === 0, `the guard was still on at the end (${JSON.stringify(ended(c, g))})`);
      },
    });
  })(),

  (() => {
    let arrivedIn: number | null = null;
    return scenario("guard: follows the ward 15 blocks away", {
      async run(c, g) {
        await g.start(c, "intent");
        await sleep(1500);
        await c.world.run(`tp ${WARD} ${wardSpot(18, 0)}`);
        arrivedIn = await until(15_000, () => botNearWard(c, 4));
      },
      verify(c, g) {
        c.check(arrivedIn !== null, "within 4 blocks of the Ward within 15 s");
        c.check(ended(c, g).length === 0, "the guard was still on at the end");
      },
    });
  })(),

  (() => {
    let killedIn: number | null = null;
    let arrivedIn: number | null = null;
    return scenario("guard: still follows after a fight", {
      timeoutMs: 90_000,
      async run(c, g) {
        await g.start(c, "intent");
        await sleep(2500);
        await zombieAtWard(c);
        killedIn = await until(25_000, async () => !(await aliveNear(c, "zombie")));
        await sleep(2000);
        await c.world.run(`tp ${WARD} ${wardSpot(3, -15)}`);
        arrivedIn = await until(15_000, () => botNearWard(c, 4));
      },
      async verify(c, g) {
        c.check(killedIn !== null, "the zombie was dead within 25 s");
        c.check(arrivedIn !== null, "within 4 blocks of the Ward within 15 s after the fight");
        await noDeaths(c);
        c.check(ended(c, g).length === 0, `the guard was still on at the end (${JSON.stringify(ended(c, g))})`);
      },
    });
  })(),

  // a creeper that reaches the Ward blows up too, so "gone" alone proves little: both players must be alive
  (() => {
    let goneIn: number | null = null;
    return scenario("guard: a creeper 7 blocks from the ward is dealt with, the ward lives", {
      timeoutMs: 90_000,
      async run(c, g) {
        await g.start(c, "intent");
        await sleep(2500);
        await c.world.run(`summon minecraft:creeper ${wardSpot(3, 7)} {PersistenceRequired:1b}`);
        goneIn = await until(25_000, async () => !(await aliveNear(c, "creeper")));
      },
      async verify(c, g) {
        c.check(goneIn !== null, "the creeper was gone within 25 s");
        await noDeaths(c);
        c.check(ended(c, g).length === 0, `the guard was still on at the end (${JSON.stringify(ended(c, g))})`);
      },
    });
  })(),

  (() => {
    let stopped = false;
    let followed = true;
    return scenario("guard: stop ends it, the bot stays put when the ward walks off", {
      async run(c, g) {
        await g.start(c, "intent");
        await sleep(2500);
        const mark = c.body.mark();
        await c.body.send({ intent: "stop" });
        stopped = (await c.body.waitEvent("task_stopped", mark, 3000))?.taskId === g.taskId;
        await c.world.run(`tp ${WARD} ${wardSpot(20, 0)}`);
        await sleep(6000);
        followed = await botNearWard(c, 8);
      },
      verify(c) {
        c.check(stopped, "stop ended the guard with task_stopped");
        c.check(!followed, "the bot did not follow the Ward after stop");
      },
    });
  })(),

  (() => {
    let failure: { reason?: string; taskId?: string } | null = null;
    return scenario("guard: the ward leaving ends it as lost_ward", {
      async run(c, g) {
        await g.start(c, "intent");
        await sleep(2000);
        const mark = c.body.mark();
        await g.ward.quit();
        failure = await c.body.waitEvent("task_failed", mark, 22_000);
      },
      verify(c, g) {
        c.check(failure !== null, "task_failed within 22 s of the Ward leaving");
        c.check(failure?.reason === "lost_ward", `the reason was lost_ward (got ${failure?.reason})`);
        c.check(failure?.taskId === g.taskId, "it ended the guard's own task");
      },
    });
  })(),
] satisfies Scenario[];
