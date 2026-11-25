// The structural half of the mutation policy: every way the body changes the world or speaks lives in one
// file, and this fails when another appears. Source text only, comments left out. If it fails because you added
// a door, read the mutation-policy design before you change the lists here: a new door has to ask lib/gate.ts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const sources = files(SRC).map((f) => ({ file: path.relative(SRC, f), text: stripComments(readFileSync(f, "utf8")) }));

// the files where `pattern` appears
const where = (pattern: RegExp): string[] => sources.filter((s) => pattern.test(s.text)).map((s) => s.file).sort();

test("bot.dig( is in lib/collect.ts only", () => {
  assert.deepEqual(where(/\bbot\.dig\(/), ["lib/collect.ts"]);
});

test("block placing is in lib/place-block.ts only", () => {
  assert.deepEqual(where(/_placeBlockWithOptions|\.placeBlock\(|\.placeEntity\(|\.activateBlock\(|\.useOn\(/), ["lib/place-block.ts"]);
});

test("bot.chat( is in lib/speech.ts only, and nothing whispers", () => {
  assert.deepEqual(where(/\bbot\.chat\(/), ["lib/speech.ts"]);
  assert.deepEqual(where(/\.whisper\(|tellraw/), []);
});

test("canDig = true is in lib/movement.ts only, behind a gate-backed safeToBreak", () => {
  assert.deepEqual(where(/\.canDig\s*=\s*true/), ["lib/movement.ts"]);
  const movement = sources.find((s) => s.file === "lib/movement.ts")?.text ?? "";
  assert.match(movement, /from "\.\/gate"/);
  assert.match(movement, /breakGate\(/);
  assert.match(movement, /safeToBreak\s*=/);
  assert.deepEqual(where(/\.canDig\s*=\s*(?!false)/).filter((f) => f !== "lib/movement.ts"), []);
});

test("new Movements( is in lib/movement.ts only and collectBlock.collect is never called", () => {
  assert.deepEqual(where(/new Movements\(/), ["lib/movement.ts"]);
  assert.deepEqual(where(/collectBlock\.collect/), []);
});

test("no caller passes allowMade: true", () => {
  assert.deepEqual(where(/allowMade:\s*true/), []);
});

test("console RCON is read and status only", () => {
  const verbs = /sendRcon\(\s*[`"']\s*(fill|setblock|give|tp|teleport|clone|summon|kill|execute|op|gamemode|clear|item|loot|place)\b/;
  assert.deepEqual(where(verbs), []);
});

test("the doors call the gate", () => {
  const text = (f: string) => sources.find((s) => s.file === f)?.text ?? "";
  assert.match(text("lib/collect.ts"), /gateDig\(/);
  assert.match(text("lib/place-block.ts"), /check\(/);
  assert.match(text("lib/speech.ts"), /sayable\(/);
});

test("the journal is written only through the gate: record( is called in lib/gate.ts and defined in lib/journal.ts", () => {
  assert.deepEqual(where(/\brecord\(/), ["lib/gate.ts", "lib/journal.ts"]);
});

test("using an item on a mob is in behaviors/shear.ts only", () => {
  assert.deepEqual(where(/\.activateEntity(At)?\(/), ["behaviors/shear.ts"]);
});
