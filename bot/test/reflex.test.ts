import assert from "node:assert/strict";
import { test } from "node:test";
import { findBank } from "../src/behaviors/bank";
import { PRESSED, STALL_MS, watchFlee } from "../src/behaviors/danger";
import { starvingStep, mayEatWhileFleeing } from "../src/behaviors/food";
import { Closing, type Cell, type Grid } from "../src/behaviors/hazard";
import { GATE_MS, HurtGate, hurtCause, type HurtContext } from "../src/behaviors/hurt";
import { fallWords, stanceWords } from "../src/behaviors/reflex-words";
import { corneredStance, type Fighter } from "../src/behaviors/stance";
import { createDispatcher } from "../src/api/dispatch";
import { EventLog } from "../src/api/events";
import { wakeReason } from "../src/mcp/wait";

const ev = (event: string, f: object = {}) => ({ seq: 1, ts: 0, event, ...f });

const here = { x: 0, z: 0 };
const at = (x: number, z: number) => ({ x, z });

test("flee watchdog: a run that gains distance is never cornered", () => {
  let w = watchFlee(null, 4, 20, here, 0);
  for (let t = 1000; t <= 20_000; t += 1000) {
    w = watchFlee(w.watch, 4 + t / 1000, 20, at(t / 100, 0), t);
    assert.equal(w.cornered, false);
  }
});

test("flee watchdog: going nowhere with the threat on top of the body is cornered after the stall", () => {
  let w = watchFlee(null, 3, 20, here, 0);
  w = watchFlee(w.watch, 3.2, 20, at(1, 1), STALL_MS - 1);
  assert.equal(w.cornered, false);
  w = watchFlee(w.watch, 3.2, 20, at(2, 1), STALL_MS);
  assert.equal(w.cornered, true);
});

test("flee watchdog: a chase round a circle covers ground and is left alone", () => {
  let w = watchFlee(null, 3, 20, here, 0);
  for (let t = 500; t <= 60_000; t += 500) {
    const a = t / 2000;
    w = watchFlee(w.watch, 3 + Math.sin(a), 20, at(Math.cos(a) * 12, Math.sin(a) * 12), t);
    assert.equal(w.cornered, false);
  }
});

test("flee watchdog: a threat that stays far off does not corner the body, but being hurt does", () => {
  let w = watchFlee(null, PRESSED + 6, 20, here, 0);
  w = watchFlee(w.watch, PRESSED + 6, 20, here, STALL_MS * 2);
  assert.equal(w.cornered, false);
  w = watchFlee(w.watch, PRESSED + 6, 14, here, STALL_MS * 2 + 100);
  assert.equal(w.cornered, true);
});

const me = (over: Partial<Fighter> = {}): Fighter => ({ health: 20, weapon: null, armour: 0, x: 0, y: 0, z: 0, ...over });
const mob = (name: string, x: number) => ({ name, x, y: 0, z: 0 });

test("cornered: fights plain melee mobs whatever the odds, lets go when a creeper or skeleton is among them", () => {
  const s = corneredStance(me(), [mob("zombie", 5), mob("zombie", 2)]);
  assert.deepEqual(s, { act: "fight", target: mob("zombie", 2) });
  assert.deepEqual(corneredStance(me({ health: 5 }), [mob("spider", 2)]), { act: "fight", target: mob("spider", 2) });
  assert.equal(corneredStance(me(), [mob("zombie", 2), mob("creeper", 3)]), null);
  assert.equal(corneredStance(me(), [mob("skeleton", 3)]), null);
});

const cx = (over: Partial<HurtContext> = {}): HurtContext => ({ hazard: null, burning: false, drowning: false, falling: false, mobs: [], food: 20, ...over });

test("hurt cause in words", () => {
  assert.equal(hurtCause(cx({ mobs: ["zombie"] })), "hurt by a zombie");
  assert.equal(hurtCause(cx({ mobs: ["enderman"] })), "hurt by an enderman");
  assert.equal(hurtCause(cx({ burning: true, mobs: ["zombie"] })), "burning");
  assert.equal(hurtCause(cx({ hazard: "lava" })), "in lava");
  assert.equal(hurtCause(cx({ hazard: "drowning" })), "drowning");
  assert.equal(hurtCause(cx({ drowning: true })), "drowning");
  assert.equal(hurtCause(cx({ falling: true, mobs: ["zombie"] })), "falling");
  assert.equal(hurtCause(cx({ food: 0 })), "starving");
  assert.equal(hurtCause(cx()), "hurt by something");
  assert.ok(!/\d/.test(hurtCause(cx({ mobs: ["cave_spider"] }))));
});

test("hurt gate: a blast is one wake, a new cause or low health speaks sooner", () => {
  const g = new HurtGate();
  assert.equal(g.offer("hurt by a creeper", 14, 0), true);
  assert.equal(g.offer("hurt by a creeper", 12, 200), false);
  assert.equal(g.offer("hurt by a creeper", 10, 900), false);
  assert.equal(g.offer("burning", 9, 1200), true); // different cause, past CHANGE_MS
  assert.equal(g.offer("burning", 8, 1400), false);
  assert.equal(g.offer("burning", 5, 1500), true); // crossed 6
  assert.equal(g.offer("burning", 4, 1600), false);
  assert.equal(g.offer("burning", 3, 1500 + GATE_MS), true);
});

test("starving is said once per episode, from critical hunger", () => {
  assert.deepEqual(starvingStep(false, 10), { emit: false, next: false });
  assert.deepEqual(starvingStep(false, 6), { emit: true, next: true });
  assert.deepEqual(starvingStep(true, 4), { emit: false, next: true });
  assert.deepEqual(starvingStep(true, 10), { emit: false, next: true }); // still the same episode
  assert.deepEqual(starvingStep(true, 15), { emit: false, next: false });
});

test("a meal while running: only far from the threat and really hungry, never mid-fight", () => {
  assert.equal(mayEatWhileFleeing(null, 2), false);
  assert.equal(mayEatWhileFleeing(20, 12), false);
  assert.equal(mayEatWhileFleeing(8, 2), false);
  assert.equal(mayEatWhileFleeing(20, 4), true);
});

test("wake reasons: hurt, starving and a reflex starting wake; a meal does not", () => {
  assert.equal(wakeReason(ev("hurt", { cause: "burning", health: 12 })), "hurt");
  assert.equal(wakeReason(ev("starving", { food: 5 })), "starving");
  assert.equal(wakeReason(ev("reflex_started", { what: "mobs", why: "running from a zombie" })), "reflex_started");
  assert.equal(wakeReason(ev("reflex_started", { what: "eating", why: "eating bread" })), undefined);
  assert.equal(wakeReason(ev("reflex_changed", { what: "mobs", why: "fighting a zombie" })), undefined);
});

test("the dispatcher says a reflex started and changed, in words with no number", () => {
  const log = new EventLog();
  const d = createDispatcher({ interrupt() {}, vitals: () => ({ health: 20, food: 20 }), inGame: () => true } as never, log);
  d.reflexStarted("mobs", "running from 3 zombies, bare hands");
  d.reflexChanged("mobs", "cornered, fighting a zombie");
  const [a, b] = log.since(0).events;
  assert.deepEqual({ event: a.event, what: a.what, why: a.why }, { event: "reflex_started", what: "mobs", why: "running from zombies, bare hands" });
  assert.deepEqual({ event: b.event, what: b.what, why: b.why }, { event: "reflex_changed", what: "mobs", why: "cornered, fighting a zombie" });
});

test("stance and fall words", () => {
  assert.equal(stanceWords("flee", ["zombie", "skeleton"], "bare hands"), "running from a zombie and a skeleton, bare hands");
  assert.equal(stanceWords("fight", ["zombie"], undefined, "cornered"), "cornered, fighting a zombie");
  assert.equal(fallWords("water", 0), "landed in water, unhurt");
  assert.equal(fallWords("hard", 12), "landed hard, badly hurt");
  assert.equal(fallWords("soft", 2), "landed softly, a little hurt");
});

test("closing: a way out that gets no nearer for the window is stalled", () => {
  const c = new Closing(3000, 0.5);
  assert.equal(c.stalled(5, 0), false);
  assert.equal(c.stalled(4, 1000), false);
  assert.equal(c.stalled(4.2, 3999), false);
  assert.equal(c.stalled(4.1, 4000), true);
  c.reset();
  assert.equal(c.stalled(4.1, 4100), false);
});

// stone all round, a water volume under a ceiling and a shaft three blocks off that rises to open air
test("swimming search finds the shaft under a ceiling, never the roof over it", () => {
  const water: Cell = { solid: false, fluid: "water", fire: false };
  const stone: Cell = { solid: true, fluid: null, fire: false };
  const air: Cell = { solid: false, fluid: null, fire: false };
  // pool: x 0..6, z 0..2, y 1..4 water, ceiling at y 5 over x 0..4; shaft at x 5..6 open to y 8 (water to y 4, air above, stone rim at y 5 beside it)
  const g: Grid = (x, y, z) => {
    if (y <= 0) return stone;
    if (z < 0 || z > 2 || x < -1 || x > 7) return y <= 6 ? stone : air;
    if (x === -1 || x === 7) return y <= 6 ? stone : air;
    if (y >= 1 && y <= 4) return water;
    if (y === 5) return x <= 4 ? stone : water; // ceiling, then the shaft
    if (y === 6) return x <= 4 ? stone : water; // the shaft's water surface is at 6
    if (y === 7) return x <= 4 ? air : air;
    return air;
  };
  const route = findBank(g, { x: 1.5, y: 2, z: 1.5 });
  assert.ok(route, "a route exists");
  assert.ok(route.bank.x >= 4, `the bank is by the shaft, not over the ceiling (x ${route.bank.x})`);
});
