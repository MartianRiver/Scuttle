import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { logger } from "../lib/logger";
import { setStatus } from "../lib/status";
import { rconConfigured, sendRcon } from "../lib/rcon";

const log = logger("guard");

// The plugin is the one tracking strikes and deciding who Scuttle should
// actually be fighting (see GuardListener/FightState in the Java side) — this
// just polls that decision and turns it into real swings. Detection never
// happens here; a hit that shouldn't be a real fight yet gets cancelled
// before this bot even sees its health drop.
const POLL_INTERVAL_MS = 3000;
const ATTACK_INTERVAL_MS = 650;
const ENGAGE_RANGE_BLOCKS = 20;
const ATTACK_REACH_BLOCKS = 3;
const FIGHT_LEASE_MS = 10_000;

let currentTarget: string | null = null;
let attackTimer: ReturnType<typeof setInterval> | null = null;
let chaseGoal: goals.GoalFollow | null = null;
let chaseEntityId: number | null = null;
let lastConfirmedAt = 0;
let pollInFlight = false;
let attackInFlight = false;

export function isGuardFighting(): boolean {
  return currentTarget !== null;
}

export function startGuard(bot: Bot): () => void {
  if (!rconConfigured()) {
    log.warn("RCON not configured — guard duty combat stays off, nothing to poll fightstate from");
    return () => {};
  }

  bot.on("death", () => stopFighting(bot));

  const runPoll = (): void => {
    if (pollInFlight) return;
    pollInFlight = true;
    poll(bot)
      .catch((err) => log.error("guard poll failed", { message: (err as Error).message }))
      .finally(() => {
        pollInFlight = false;
      });
  };

  runPoll();
  const timer = setInterval(runPoll, POLL_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    stopFighting(bot);
  };
}

async function poll(bot: Bot): Promise<void> {
  const raw = (await sendRcon("scuttle guard fightstate")).trim();
  const value = raw.startsWith("FIGHT:") ? raw.slice("FIGHT:".length) : null;
  const target = value && /^[A-Za-z0-9_]{1,16}$/.test(value) ? value : null;

  if (raw !== "NONE" && !target) throw new Error(`unexpected fightstate reply: ${raw}`);
  if (target === bot.username) throw new Error("plugin returned the bot as its own fight target");

  lastConfirmedAt = Date.now();

  if (target === currentTarget) return;
  if (!target) {
    stopFighting(bot);
    return;
  }
  startFighting(bot, target);
}

function startFighting(bot: Bot, username: string): void {
  clearChase(bot);
  currentTarget = username;
  log.info("engaging", { username });
  setStatus({ task: `fighting ${username}` });

  equipWeapon(bot).catch((err) =>
    log.error("couldn't equip a weapon", { message: (err as Error).message })
  );

  if (attackTimer) clearInterval(attackTimer);
  attackTimer = setInterval(() => attackTick(bot), ATTACK_INTERVAL_MS);
}

function stopFighting(bot: Bot): void {
  if (!currentTarget) return;
  log.info("disengaging", { username: currentTarget });
  currentTarget = null;
  if (attackTimer) clearInterval(attackTimer);
  attackTimer = null;
  attackInFlight = false;
  clearChase(bot);
  setStatus({ task: "idle" });
}

function attackTick(bot: Bot): void {
  if (!currentTarget) return;
  if (Date.now() - lastConfirmedAt > FIGHT_LEASE_MS) {
    log.warn("fightstate lease expired — disengaging", { username: currentTarget });
    stopFighting(bot);
    return;
  }

  const target = bot.players[currentTarget]?.entity;
  if (!target) {
    clearChase(bot);
    return;
  }

  const distance = bot.entity.position.distanceTo(target.position);
  if (distance > ENGAGE_RANGE_BLOCKS) {
    clearChase(bot);
    return;
  }

  if (distance > ATTACK_REACH_BLOCKS) {
    if (!chaseGoal || chaseEntityId !== target.id || bot.pathfinder.goal !== chaseGoal) {
      chaseGoal = new goals.GoalFollow(target, 2);
      chaseEntityId = target.id;
      bot.pathfinder.setGoal(chaseGoal, true);
    }
    return;
  }
  clearChase(bot);
  if (attackInFlight) return;

  attackInFlight = true;
  bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true)
    .then(() => {
      if (bot.players[currentTarget ?? ""]?.entity === target
          && bot.entity.position.distanceTo(target.position) <= ATTACK_REACH_BLOCKS) {
        bot.attack(target);
      }
    })
    .catch((err) => log.error("couldn't face fight target", { message: (err as Error).message }))
    .finally(() => {
      attackInFlight = false;
    });
}

function clearChase(bot: Bot): void {
  if (chaseGoal && bot.pathfinder.goal === chaseGoal) bot.pathfinder.setGoal(null);
  chaseGoal = null;
  chaseEntityId = null;
}

async function equipWeapon(bot: Bot): Promise<void> {
  const items = bot.inventory.items();
  const tiers = ["netherite", "diamond", "iron", "stone", "golden", "wooden"];
  const weapon = tiers
    .map((tier) => items.find((item) => item.name === `${tier}_sword`))
    .find(Boolean)
    ?? tiers.map((tier) => items.find((item) => item.name === `${tier}_axe`)).find(Boolean);
  if (weapon) await bot.equip(weapon, "hand");
}
