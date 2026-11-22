// get_wood takes logs from natural trees and from nothing else. Four grown-looking trees are
// rebuilt each run beside three decoys (a stripped tree, a bare trunk, a trunk under placed
// leaves) inside the grove region; the checks are on blocks the server holds. (Was a one-off diff.)
import { sleep, type Pos, type Scenario } from "./lib";

const NATURAL = [[12, 4], [17, -3], [20, 5], [-14, 3]] as const; // same trees build_home.py grows
const STRIPPED: Pos = { x: 4, y: 68, z: 6 };
const BARE: Pos = { x: -8, y: 68, z: 6 };
const PLACED: Pos = { x: 4, y: 68, z: -6 };
const tall = 5;

const column = (p: Pos, h: number): [Pos, Pos] => [p, { ...p, y: p.y + h - 1 }];

export const get_wood: Scenario = {
  name: "get_wood takes natural logs only",
  timeoutMs: 300_000,
  async setup(c) {
    await c.body.send({ intent: "stop" });
    await sleep(1500);
    await c.world.run(`clear ${c.bot}`);
    await c.world.run(`tp ${c.bot} 0.5 68 -10`);
    // earlier runs and demos leave grown trees about; a decoy beside one would turn natural
    await c.world.run("fill -24 68 -10 24 95 12 air");
    for (const [tx, tz] of NATURAL) {
      await c.world.run(`fill ${tx - 2} 70 ${tz - 2} ${tx + 2} 71 ${tz + 2} oak_leaves`);
      await c.world.run(`fill ${tx - 1} 72 ${tz - 1} ${tx + 1} 73 ${tz + 1} oak_leaves`);
      await c.world.run(`fill ${tx} 68 ${tz} ${tx} 72 ${tz} oak_log`);
    }
    // the dig of any decoy would be allowed here, so a dug decoy shows
    await c.world.run(`fill ${STRIPPED.x} 68 ${STRIPPED.z} ${STRIPPED.x} 72 ${STRIPPED.z} stripped_oak_log`);
    await c.world.run(`fill ${BARE.x} 68 ${BARE.z} ${BARE.x} 72 ${BARE.z} oak_log`);
    await c.world.run(`fill ${PLACED.x - 1} 71 ${PLACED.z - 1} ${PLACED.x + 1} 73 ${PLACED.z + 1} oak_leaves[persistent=true]`);
    await c.world.run(`fill ${PLACED.x} 68 ${PLACED.z} ${PLACED.x} 72 ${PLACED.z} oak_log`);
    await sleep(1000);
  },
  async act(c) {
    const from = c.body.mark();
    c.check(await c.body.startTask(), "task accepted");
    const ended = await Promise.race([
      c.body.waitEvent("task_finished", from, 240_000),
      c.body.waitEvent("task_failed", from, 240_000),
    ]);
    c.check(ended?.event === "task_finished", `task finished (saw ${ended?.event ?? "nothing"} ${ended?.reason ?? ""})`);
  },
  async verify(c) {
    const [sFrom, sTo] = column(STRIPPED, tall);
    const [bFrom, bTo] = column(BARE, tall);
    const [pFrom, pTo] = column(PLACED, tall);
    c.check((await c.world.countBlocks(sFrom, sTo, "stripped_oak_log")) === tall, "stripped trunk untouched");
    c.check((await c.world.countBlocks(bFrom, bTo, "oak_log")) === tall, "bare trunk untouched");
    c.check((await c.world.countBlocks(pFrom, pTo, "oak_log")) === tall, "trunk under placed leaves untouched");
    const left = (
      await Promise.all(NATURAL.map(([tx, tz]) => c.world.countBlocks({ x: tx, y: 68, z: tz }, { x: tx, y: 72, z: tz }, "oak_log")))
    ).reduce((a, b) => a + b, 0);
    c.check(left <= NATURAL.length * tall - 16, `at least 16 natural logs gone, ${left} of ${NATURAL.length * tall} left`);
    c.check((await c.world.count(c.bot, "wooden_pickaxe")) >= 1, "pickaxe made");
  },
};

export default get_wood;
