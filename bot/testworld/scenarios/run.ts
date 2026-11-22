// Scenario runner: set up, act, verify, one pass/fail line per scenario, exit 1 if any failed.
// Needs the test server (start.sh, build_home.py --member) and the bot (bot.sh) running.
// Run from bot/: npx tsx testworld/scenarios/run.ts [name-filter] [--checks]
//   --checks also runs the older check_*.ts scripts, each as one pass/fail line.
// Scenarios assert world facts read from the server, never how the bot got there.
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { Body, Rcon, sleep, World, type Ctx, type Scenario } from "./lib";

const BOT = "ScuttleTest";
const OLD_CHECKS = ["check_movement.ts", "check_craft.ts", "check_body.ts"];
const out = (s: string) => process.stdout.write(s + "\n");

async function load(): Promise<Scenario[]> {
  const found: Scenario[] = [];
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith(".scenario.ts")).sort()) {
    const mod = await import(path.join(__dirname, file));
    found.push(...[mod.default].flat());
  }
  return found;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);
}

async function runOne(s: Scenario, ctx: Ctx, failures: string[]): Promise<void> {
  const ms = s.timeoutMs ?? 180_000;
  try {
    await withTimeout((async () => {
      await s.setup?.(ctx);
      await s.act(ctx);
      await s.verify(ctx);
    })(), ms, s.name);
  } catch (e) {
    failures.push(`threw: ${(e as Error).message}`);
  } finally {
    // leave the bot idle for whatever runs next
    await ctx.body.send({ intent: "stop" }).catch(() => {});
    await sleep(1500);
  }
}

function runCheckScript(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("npx", ["tsx", `testworld/${file}`], { timeout: 600_000 }, (err, stdout) => {
      if (err) out(stdout.trim().split("\n").slice(-6).join("\n"));
      resolve(!err);
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith("--"));
  const scenarios = (await load()).filter((s) => !filter || s.name.includes(filter));

  const rcon = new Rcon();
  await rcon.connect();
  const body = new Body();
  await body.connect();
  const world = new World(rcon);

  let failed = 0;
  for (const s of scenarios) {
    const failures: string[] = [];
    const ctx: Ctx = {
      world,
      body,
      bot: BOT,
      check: (ok, what) => {
        if (!ok) failures.push(what);
      },
    };
    const t0 = Date.now();
    await runOne(s, ctx, failures);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    out(failures.length ? `FAIL ${s.name} (${secs} s)\n${failures.map((f) => `     - ${f}`).join("\n")}` : `PASS ${s.name} (${secs} s)`);
    if (failures.length) failed++;
  }
  rcon.close();
  body.close();

  if (args.includes("--checks")) {
    for (const file of OLD_CHECKS) {
      const ok = await runCheckScript(file);
      out(`${ok ? "PASS" : "FAIL"} ${file}`);
      if (!ok) failed++;
    }
  }
  out(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  out(`FAIL runner: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
