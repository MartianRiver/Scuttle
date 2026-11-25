// Planting a sapling and shearing a sheep, on the place scenarios' platform (same checkpoint, same site region): the
// ground and light rules, what the server holds afterwards, wool from a summoned flock, and a bed from it. Sheep are
// summoned with no AI so they stay where they are put; a sapling is read from the world, never from what the body says.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { botName } from "../slot";
import { sleep, type Ctx, type Pos, type Scenario } from "./lib";
import { checkpoint, finished, observe, run, S, said, startsBare, tidy } from "./place.scenario";

const JOURNAL = path.join(process.cwd(), ".auth-cache", `journal-${botName}.jsonl`);
const at = (dx: number, dy: number, dz: number): Pos => ({ x: S.x + dx, y: S.y + dy, z: S.z + dz });
const xyz = (p: Pos) => `${p.x} ${p.y} ${p.z}`;

async function clean(c: Ctx, restart = false): Promise<void> {
  const near = `x=${S.x},y=${S.y},z=${S.z},distance=..40`;
  for (const t of ["sheep", "cow", "item"]) await c.world.run(`kill @e[type=${t},${near}]`);
  await tidy(c, restart);
}

async function sheepAt(c: Ctx, p: Pos, nbt = ""): Promise<void> {
  await c.world.run(`summon sheep ${p.x + 0.5} ${p.y} ${p.z + 0.5} {NoAI:1b,Color:0b${nbt}}`);
}

// sheep come in view as observe's mobs; nearest first
async function sheepHandles(c: Ctx): Promise<string[]> {
  const o = await observe(c);
  return o.near.filter((m) => m.what === "sheep").map((m) => m.h);
}

const journalHas = (item: string): boolean => existsSync(JOURNAL) && readFileSync(JOURNAL, "utf8").split("\n").some((l) => l.includes(`"after":"${item}"`) && l.includes('"own":true'));

const plantOnGrass: Scenario = {
  name: "plant: an oak sapling goes in ahead on grass, stays, and is journalled as its own",
  timeoutMs: 90_000,
  setup: (c) => checkpoint(c, ["oak_sapling 2"]),
  async act(c) {
    await startsBare(c, { oak_sapling: 2 });
    const r = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" });
    c.check(r.reply === "accepted" && finished(r.end), `place ends finished (${r.reply}, ${said(r.end)})`);
    c.check(r.end?.detail === "an oak sapling ahead of it", `the words say what and where (${r.end?.detail})`);
  },
  async verify(c) {
    c.check(await c.world.blockIs(at(1, 0, 0), "oak_sapling"), "an oak sapling stands ahead of it");
    c.check((await c.world.count(c.bot, "oak_sapling")) === 1, "one left in the pack");
    c.check(journalHas("oak_sapling"), "the journal has it as its own");
    const here = await run(c, { intent: "place", item: "oak_sapling", where: "here" });
    c.check(finished(here.end), `and one beside it: ${said(here.end)}`);
    c.check(await c.world.passes(`execute if block ${S.x} ${S.y} ${S.z + 1} oak_sapling`) || await c.world.passes(`execute if block ${S.x} ${S.y} ${S.z - 1} oak_sapling`) || await c.world.passes(`execute if block ${S.x - 1} ${S.y} ${S.z} oak_sapling`), "set on another cell, not the first one again");
    const none = await run(c, { intent: "place", item: "spruce_sapling" });
    c.check(none.end?.reason === "none_held", `a sapling it does not hold (${said(none.end)})`);
    await c.world.run(`give ${c.bot} azalea 1`);
    const azalea = await run(c, { intent: "place", item: "azalea" });
    c.check(azalea.end?.reason === "not_allowed", `an azalea is not on the list (${said(azalea.end)})`);
    await c.world.run(`give ${c.bot} wheat_seeds 1`);
    const seeds = await run(c, { intent: "place", item: "wheat_seeds" });
    c.check(seeds.end?.reason === "not_allowed", `nor are seeds (${said(seeds.end)})`);
  },
  cleanup: (c) => clean(c),
};

const plantOnStone: Scenario = {
  name: "plant: on stone it is no_room in words, and nothing is remembered as a refused place",
  timeoutMs: 90_000,
  async setup(c) {
    await checkpoint(c, ["oak_sapling 1"]);
    await c.world.run(`fill ${S.x - 3} ${S.y - 1} ${S.z - 3} ${S.x + 3} ${S.y - 1} ${S.z + 3} stone`);
    await sleep(3000);
  },
  async act(c) {
    await startsBare(c, { oak_sapling: 1 });
    const r = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" });
    c.check(r.end?.event === "task_failed" && r.end.reason === "no_room", `ahead: no_room (${said(r.end)})`);
    c.check(/grass or dirt/.test(String(r.end?.detail)), `with the words for it (${r.end?.detail})`);
    const h = await run(c, { intent: "place", item: "oak_sapling", where: "here" });
    c.check(h.end?.reason === "no_room", `here: no_room too (${said(h.end)})`);
  },
  async verify(c) {
    c.check(!(await c.world.blockIs(at(1, 0, 0), "oak_sapling")), "nothing was planted");
    c.check((await c.world.count(c.bot, "oak_sapling")) === 1, "the sapling is still in the pack");
    const o = await observe(c);
    c.check((o.refused?.length ?? 0) === 0, "and no place is remembered as refused");
    // dirt on top of the stone is fine
    await c.world.run(`setblock ${xyz(at(1, -1, 0))} podzol`);
    await sleep(1000);
    const ok = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" });
    c.check(finished(ok.end), `on podzol it goes in: ${said(ok.end)}`);
  },
  cleanup: (c) => clean(c),
};

const plantInDark: Scenario = {
  name: "plant: under a wide roof, where the light is under 9, it is no_room with the words",
  timeoutMs: 90_000,
  async setup(c) {
    await checkpoint(c, ["oak_sapling 1"]);
    await c.world.run(`fill ${S.x - 12} ${S.y + 2} ${S.z - 12} ${S.x + 12} ${S.y + 2} ${S.z + 12} stone`);
    await sleep(3500);
  },
  async act(c) {
    await startsBare(c, { oak_sapling: 1 });
    const r = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" });
    c.check(r.end?.event === "task_failed" && r.end.reason === "no_room", `no_room (${said(r.end)})`);
    c.check(/too dark/.test(String(r.end?.detail)), `with the words for it (${r.end?.detail})`);
  },
  async verify(c) {
    c.check(!(await c.world.blockIs(at(1, 0, 0), "oak_sapling")), "nothing was planted");
    const o = await observe(c);
    c.check((o.refused?.length ?? 0) === 0, "and no place is remembered as refused");
    await c.world.run(`fill ${S.x - 12} ${S.y + 2} ${S.z - 12} ${S.x + 12} ${S.y + 2} ${S.z + 12} air`);
    await sleep(3500);
    const ok = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" });
    c.check(finished(ok.end), `with the roof off it goes in: ${said(ok.end)}`);
  },
  cleanup: async (c) => {
    await c.world.run(`fill ${S.x - 12} ${S.y + 2} ${S.z - 12} ${S.x + 12} ${S.y + 2} ${S.z + 12} air`);
    await clean(c);
  },
};

const shearFlock: Scenario = {
  name: "plant: shear takes wool from an adult sheep with shears, and refuses a lamb, a shorn sheep, a cow and no shears",
  timeoutMs: 180_000,
  async setup(c) {
    await checkpoint(c);
    await sheepAt(c, at(3, 0, 0));
    await sheepAt(c, at(3, 0, 2), ",Age:-24000");
    await c.world.run(`summon cow ${S.x + 3.5} ${S.y} ${S.z - 1.5} {NoAI:1b}`);
    await sleep(3000);
  },
  async act(c) {
    await startsBare(c, {});
    const o = await observe(c);
    const sheep = o.near.filter((m) => m.what === "sheep");
    const cow = o.near.find((m) => m.what === "cow");
    c.check(sheep.length === 2 && Boolean(cow), `observe lists two sheep and a cow (${o.near.map((m) => m.what).join(", ")})`);
    if (sheep.length < 2 || !cow) return;
    const none = await run(c, { intent: "shear", handle: sheep[0].h });
    c.check(none.end?.reason === "none_held", `no shears: none_held (${said(none.end)})`);
    await c.world.run(`give ${c.bot} shears 1`);
    const notSheep = await run(c, { intent: "shear", handle: cow.h });
    c.check(notSheep.end?.reason === "not_allowed", `a cow: not_allowed (${said(notSheep.end)})`);

    const results = [];
    for (const m of sheep) results.push({ m, r: await run(c, { intent: "shear", handle: m.h }, 90_000) });
    const done = results.filter((x) => finished(x.r.end));
    const refused = results.filter((x) => x.r.end?.reason === "refused");
    c.check(done.length === 1 && refused.length === 1, `one sheep shorn and one refused (${results.map((x) => said(x.r.end)).join(" | ")})`);
    const got = done[0]?.r.end?.got as Record<string, number> | undefined;
    c.check(Boolean(got) && (got?.white_wool ?? 0) >= 1 && (got?.white_wool ?? 0) <= 3, `the wool is in got (${JSON.stringify(got)})`);
    c.check(/lamb/.test(String(refused[0]?.r.end?.detail)), `the lamb in words (${refused[0]?.r.end?.detail})`);
    if (done[0]) {
      const again = await run(c, { intent: "shear", handle: done[0].m.h });
      c.check(again.end?.reason === "no_wool", `the same sheep again: no_wool (${said(again.end)})`);
    }
  },
  async verify(c) {
    const wool = await c.world.count(c.bot, "white_wool");
    c.check(wool >= 1 && wool <= 3, `white wool in the pack (${wool})`);
    const shorn = await c.world.run(`execute if entity @e[type=sheep,nbt={Sheared:1b},x=${S.x},y=${S.y},z=${S.z},distance=..40]`);
    c.check(/Test passed/.test(shorn), "the server has one sheep shorn");
    const left = await c.world.run(`execute if entity @e[type=sheep,nbt={Sheared:0b},x=${S.x},y=${S.y},z=${S.z},distance=..40]`);
    c.check(/Test passed/.test(left), "and a sheep that still has its wool (the lamb)");
    c.check((await c.world.run(`data get entity @e[type=item,nbt={Item:{id:"minecraft:white_wool"}},limit=1] Item.count`)).includes("No entity"), "no wool left lying about");
  },
  cleanup: (c) => clean(c),
};

const bedFromWool: Scenario = {
  name: "plant: shear three white sheep until it has three wool, then craft a white bed; mixed colours say what is missing",
  timeoutMs: 300_000,
  async setup(c) {
    await checkpoint(c, ["shears 1", "oak_planks 6", "crafting_table 1"]);
    for (const dz of [-2, 0, 2]) await sheepAt(c, at(3, 0, dz));
    await sleep(3000);
  },
  async act(c) {
    await startsBare(c, { shears: 1, oak_planks: 6, crafting_table: 1 });
    const handles = await sheepHandles(c);
    c.check(handles.length === 3, `three sheep in view (${handles.length})`);
    for (const h of handles) {
      if ((await c.world.count(c.bot, "white_wool")) >= 3) break;
      const r = await run(c, { intent: "shear", handle: h }, 90_000);
      c.check(finished(r.end), `shear ${h}: ${said(r.end)}`);
    }
    const wool = await c.world.count(c.bot, "white_wool");
    c.check(wool >= 3, `three white wool or more (${wool})`);
    const bed = await run(c, { intent: "craft", item: "white_bed" }, 90_000);
    c.check(finished(bed.end), `craft white_bed: ${said(bed.end)}`);
  },
  async verify(c) {
    c.check((await c.world.count(c.bot, "white_bed")) === 1, "a white bed in the pack");
    // mixed colours: two white and one red do not make a bed of either colour
    await c.world.run(`clear ${c.bot}`);
    for (const g of ["white_wool 2", "red_wool 1", "oak_planks 3", "crafting_table 1"]) await c.world.run(`give ${c.bot} ${g}`);
    await sleep(500);
    for (const colour of ["white", "red"]) {
      const r = await run(c, { intent: "craft", item: `${colour}_bed` }, 60_000);
      c.check(r.end?.event === "task_failed" && r.end.reason === "missing", `${colour}_bed from mixed wool is missing (${said(r.end)} ${JSON.stringify(r.end?.missing ?? {})})`);
    }
  },
  cleanup: (c) => clean(c),
};

// no region of its own, so the server's build deny puts the sapling back; last, since the place is remembered
const plantUndone: Scenario = {
  name: "plant: where the server will not take it the plant ends protected",
  timeoutMs: 180_000,
  setup: (c) => checkpoint(c, ["oak_sapling 1"], false),
  async act(c) {
    await startsBare(c, { oak_sapling: 1 });
    const r = await run(c, { intent: "place", item: "oak_sapling", where: "ahead" }, 90_000);
    c.check(r.end?.event === "task_failed" && r.end.reason === "protected", `protected (${said(r.end)})`);
  },
  async verify(c) {
    c.check(!(await c.world.blockIs(at(1, 0, 0), "oak_sapling")), "no sapling stayed");
    c.check((await c.world.count(c.bot, "oak_sapling")) === 1, "and it still holds it");
    const o = await observe(c);
    c.check((o.refused?.length ?? 0) > 0, "the place is remembered as one where its work was undone");
  },
  cleanup: (c) => clean(c, true),
};

export default [plantOnGrass, plantOnStone, plantInDark, shearFlock, bedFromWool, plantUndone];
