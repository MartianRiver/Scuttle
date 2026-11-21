// Reapplies the hand patches from 2026-09-08 that make mineflayer/minecraft-data/
// prismarine-physics/prismarine-chunk work against this server's version (26.2).
// None of these packages support 26.2 in their latest published release yet — see
// the upstream PRs on PrismarineJS (minecraft-data 1219, prismarine-physics 138) that these
// follow. Runs as a
// postinstall hook so a fresh `npm install` (a clean clone, a deploy, CI) doesn't
// silently regress back to a bot that can't connect. Idempotent — safe to rerun.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules");
let changed = 0;

const say = (msg) => process.stdout.write(msg + "\n");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// 1. minecraft-data: protocol.json + version.json for pc 26.2, from the real
// PrismarineJS/minecraft-data PR #1219 (branch pc_26_2, commit 4dd8762).
function patchMinecraftDataFiles() {
  const dir = path.join(root, "minecraft-data", "minecraft-data", "data", "pc", "26.2");
  const protocolPath = path.join(dir, "protocol.json");
  if (fs.existsSync(protocolPath)) return;

  fs.mkdirSync(dir, { recursive: true });
  const base =
    "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/4dd8762a45b97dafdb216b8d7a95ab92379e2c68/data/pc/26.2/";
  for (const file of ["protocol.json", "version.json"]) {
    fetchSync(base + file, path.join(dir, file));
  }
  changed++;
  say("[patch-26.2] added minecraft-data pc/26.2/{protocol,version}.json");
}

// 2. minecraft-data: register 26.2 in protocolVersions.json (what index.js actually
// indexes from) with a dataVersion above 26.1's, so relative-version comparisons
// (feature gating, etc.) sort it correctly rather than as older than everything.
function patchProtocolVersions() {
  const p = path.join(
    root, "minecraft-data", "minecraft-data", "data", "pc", "common", "protocolVersions.json"
  );
  const pv = readJson(p);
  if (pv.some((e) => e.minecraftVersion === "26.2")) return;

  const v26_1 = pv.find((e) => e.minecraftVersion === "26.1");
  pv.push({
    minecraftVersion: "26.2",
    version: 776,
    dataVersion: (v26_1?.dataVersion ?? 4786) + 1,
    usesNetty: true,
    majorVersion: "26.2",
    releaseType: "release",
  });
  writeJson(p, pv);
  changed++;
  say("[patch-26.2] registered 26.2 in protocolVersions.json");
}

// 3. minecraft-data: data.js is a generated file mapping majorVersion -> data getters,
// not rebuilt from dataPaths.json at require-time. Clone the 26.1 entry, pointing
// protocol/version at pc/26.2 (everything else — blocks, items, entities — is
// unchanged between 26.1 and 26.2 per the real PR's own dataPaths.json diff).
function patchDataJs() {
  const p = path.join(root, "minecraft-data", "data.js");
  let src = fs.readFileSync(p, "utf8");
  if (src.includes("'26.2': {")) return;

  const marker = `      get windows () { return require("./minecraft-data/data/pc/1.16.1/windows.json") },
      proto: __dirname + '/minecraft-data/data/pc/latest/proto.yml'
    }
  },
  'bedrock': {`;
  if (!src.includes(marker)) {
    console.warn("[patch-26.2] data.js marker not found — package version may have changed, skipping");
    return;
  }
  const block26_2 = `      get windows () { return require("./minecraft-data/data/pc/1.16.1/windows.json") },
      proto: __dirname + '/minecraft-data/data/pc/latest/proto.yml'
    },
    '26.2': {
      get attributes () { return require("./minecraft-data/data/pc/26.1/attributes.json") },
      get blockCollisionShapes () { return require("./minecraft-data/data/pc/26.1/blockCollisionShapes.json") },
      get blocks () { return require("./minecraft-data/data/pc/26.1/blocks.json") },
      get blockLoot () { return require("./minecraft-data/data/pc/1.20/blockLoot.json") },
      get biomes () { return require("./minecraft-data/data/pc/26.1/biomes.json") },
      get commands () { return require("./minecraft-data/data/pc/1.20.3/commands.json") },
      get effects () { return require("./minecraft-data/data/pc/26.1/effects.json") },
      get enchantments () { return require("./minecraft-data/data/pc/26.1/enchantments.json") },
      get entities () { return require("./minecraft-data/data/pc/26.1/entities.json") },
      get entityLoot () { return require("./minecraft-data/data/pc/1.20/entityLoot.json") },
      get foods () { return require("./minecraft-data/data/pc/26.1/foods.json") },
      get instruments () { return require("./minecraft-data/data/pc/26.1/instruments.json") },
      get items () { return require("./minecraft-data/data/pc/26.1/items.json") },
      get language () { return require("./minecraft-data/data/pc/26.1/language.json") },
      get loginPacket () { return require("./minecraft-data/data/pc/26.1/loginPacket.json") },
      get mapIcons () { return require("./minecraft-data/data/pc/1.20.2/mapIcons.json") },
      get materials () { return require("./minecraft-data/data/pc/26.1/materials.json") },
      get particles () { return require("./minecraft-data/data/pc/26.1/particles.json") },
      get protocol () { return require("./minecraft-data/data/pc/26.2/protocol.json") },
      get recipes () { return require("./minecraft-data/data/pc/26.1/recipes.json") },
      get sounds () { return require("./minecraft-data/data/pc/26.1/sounds.json") },
      get tints () { return require("./minecraft-data/data/pc/26.1/tints.json") },
      get version () { return require("./minecraft-data/data/pc/26.2/version.json") },
      get windows () { return require("./minecraft-data/data/pc/1.16.1/windows.json") },
      proto: __dirname + '/minecraft-data/data/pc/latest/proto.yml'
    }
  },
  'bedrock': {`;
  src = src.replace(marker, block26_2);
  fs.writeFileSync(p, src);
  changed++;
  say("[patch-26.2] added 26.2 entry to minecraft-data/data.js");
}

// 4. mineflayer: lib/version.js has its own hardcoded testedVersions ceiling,
// independent of minecraft-data. Without this it refuses to connect at all
// ("Server version '26.2' is not supported. Latest supported version is '26.1'.").
function patchMineflayerVersion() {
  const p = path.join(root, "mineflayer", "lib", "version.js");
  let src = fs.readFileSync(p, "utf8");
  if (src.includes("'26.2'")) return;
  const before = "'1.21.11', '26.1']";
  if (!src.includes(before)) {
    console.warn("[patch-26.2] mineflayer version.js marker not found, skipping");
    return;
  }
  src = src.replace(before, "'1.21.11', '26.1', '26.2']");
  fs.writeFileSync(p, src);
  changed++;
  say("[patch-26.2] added 26.2 to mineflayer's testedVersions");
}

// 5. prismarine-chunk: chunk (de)serializer keyed by majorVersion, not derived from
// minecraft-data. The 1.18 chunk format has been reused unchanged through every
// version since (1.19 through 26.1 all point at the same implementation) — 26.2 is
// a point release with no chunk format change per the real minecraft-data PR's own
// diff, so aliasing it the same way is consistent with the existing pattern.
function patchPrismarineChunk() {
  const p = path.join(root, "prismarine-chunk", "src", "index.js");
  let src = fs.readFileSync(p, "utf8");
  if (src.includes("26.2: require('./pc/1.18/chunk')")) return;
  const before = "26.1: require('./pc/1.18/chunk')\n  },";
  if (!src.includes(before)) {
    console.warn("[patch-26.2] prismarine-chunk marker not found, skipping");
    return;
  }
  src = src.replace(before, "26.1: require('./pc/1.18/chunk'),\n    26.2: require('./pc/1.18/chunk')\n  },");
  fs.writeFileSync(p, src);
  changed++;
  say("[patch-26.2] added 26.2 to prismarine-chunk's implementation map");
}

// 6. prismarine-physics: its own lib/features.json (separate from minecraft-data's)
// gates liquid gravity / ladder-climb physics by an explicit version list that
// stopped at 26.1. Real fix sourced from PrismarineJS/prismarine-physics PR #138,
// already tested live by its author against a real 26.2 server.
function patchPrismarinePhysics() {
  const p = path.join(root, "prismarine-physics", "lib", "features.json");
  const features = readJson(p);
  let touched = false;
  for (const name of ["proportionalLiquidGravity", "climbUsingJump"]) {
    const feature = features.find((f) => f.name === name);
    if (feature && !feature.versions.includes("26.2")) {
      feature.versions.push("26.2");
      touched = true;
    }
  }
  if (touched) {
    writeJson(p, features);
    changed++;
    say("[patch-26.2] added 26.2 to prismarine-physics features.json");
  }
}

function fetchSync(url, dest) {
  // execSync + curl rather than a fetch dependency — this only ever runs at
  // install time in a dev/deploy environment that already has curl.
  const { execFileSync } = require("child_process");
  execFileSync("curl", ["-sSL", url, "-o", dest]);
}

patchMinecraftDataFiles();
patchProtocolVersions();
patchDataJs();
patchMineflayerVersion();
patchPrismarineChunk();
patchPrismarinePhysics();

if (changed === 0) {
  say("[patch-26.2] already applied, nothing to do");
}
