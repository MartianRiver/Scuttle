// Makes the installed packages speak Minecraft 26.3. No published release does yet: mineflayer,
// minecraft-protocol, prismarine-chunk and prismarine-physics come pinned from open upstream
// PRs (package.json), and this script supplies the one piece a git install can't: the
// minecraft-data 26.3 data, which lives in a submodule npm doesn't fetch. Runs as postinstall,
// idempotent, and ends by checking the facts the bot dies without, so a half-patched install
// fails here instead of in the world.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "node_modules");
const say = (msg) => process.stdout.write(`[patch-26.3] ${msg}\n`);
let changed = 0;

// PrismarineJS/minecraft-data#1345 (stacked on #1301), the data mineflayer#4206 tests against.
// The pc/common files replace the installed ones: they are strict supersets (checked 2026-11-22),
// adding the 26.3 version entries and the feature flags the 26.3 code paths read.
const PIN = "312f3cada17a7d9e2e1a1834fe26f17296163096";
const RAW = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/${PIN}/data/`;
const FILES = {
  "pc/26.3/attributes.json": "ccd2e17df0528fb9954c4f8fb1626fe9ff1d1c8e36b2484ab126179b10de5df2",
  "pc/26.3/biomes.json": "d88805e850ea44bfa18aaecab184945cfe9cdd6a171ac595a688a2636f70c02d",
  "pc/26.3/blockCollisionShapes.json": "fa0d1687e352aafb0a0827c901f25170b9424a189f127c322d7a36bfbeff41ca",
  "pc/26.3/blockLoot.json": "f74153873a365af9b270144bbd49c6ff5164d049a52216aace270cafa2d20da0",
  "pc/26.3/blocks.json": "9b7a08100999726b0aa874e0ee0b5ef3565a58945c852581ed01c6a53873f448",
  "pc/26.3/commands.json": "a17d5e5cc7aaa2fb34ba356b1d6e1150784c8d874fba7ee5a9847511bc60d699",
  "pc/26.3/effects.json": "4b9af382491bd06aedc5c9ad33ee5f3a57d47aa5b021e83292ab584efedc8e8c",
  "pc/26.3/enchantments.json": "43544f04ce2c69a6c9431673041d7e05c0760987aa2119ccfca58fc1bb8a0b2d",
  "pc/26.3/entities.json": "d28a2896cc97628f07134247eebd3c6b234a42a834063a425daa61c1684d32fd",
  "pc/26.3/entityLoot.json": "98c9d7033e361e43f6c727d3e8f9f26f03c0b6dbbb575d15ee6dd340de3de08f",
  "pc/26.3/foods.json": "f9eef56158a146c3d26e4f894509e6933fcfa029c6ecd0d19b6818be77a47b25",
  "pc/26.3/instruments.json": "f745825f467d804ae66592c4db99e51ab1f9b64a2f710b9d33524d3dd74b5824",
  "pc/26.3/items.json": "10ccf11edbe4d5a2c6f29d18d52877ba5945066e8aecfaa10c1d3da1d56a46ce",
  "pc/26.3/language.json": "4f091ba455206e24d0b6073802169b155ba0cc95bc657fa00fba4d1d8791925c",
  "pc/26.3/loginPacket.json": "e0cdb84c90abee01dfbfdd5227915b2e61bbb4c05025b39f7d0fb331f66ac4b8",
  "pc/26.3/materials.json": "32451f6081ed01c85a57f4f56e2c3866c6b63ea8490b18550001b9432a3cbadb",
  "pc/26.3/particles.json": "4a82929a47559d99cabdbbe397da33c332bfc29626284a1605b56fdb9f2a41ed",
  "pc/26.3/protocol.json": "c2182c8a0c00fa9767fcf34fedac683de1aef7acd113f64a9b375586c1a38fba",
  "pc/26.3/recipes.json": "99c4dc244469c542247041552062d4ec40c83a1929b578d52c5e610c15773d86",
  "pc/26.3/sounds.json": "c45e824b39c2d21d7f4bdab2195a1e05bc4a5a217a413efa837affcbcda32852",
  "pc/26.3/tints.json": "3b332fcfde93421a22ea751966f7b934800913cdcc509ea9d263dca19edf8ad9",
  "pc/26.3/version.json": "0d08bd2b5bce95b84405b8d39d259a365663789d22e968bdbdad9a2d4b2cc45f",
  "pc/26.3/proto.yml": "2a9dbff4cd6d859868f6d08024c0c83193f24143da95e0071906e42b36ec1ffe",
  "pc/common/protocolVersions.json": "1491fea0d6cade03d593e41ab82f0a2fe4cc1668fab3bf924d2930ff6f2f5264",
  "pc/common/versions.json": "2efa8c4f414d61c5ce3485b27e6fbdd09fe1642369b6091270f94d5cc4796e80",
  "pc/common/features.json": "684b9a42c2babc37237248297dcdaa632720b3f8e4c8a3f4aae20089d5d02d43",
  // the published package lacks this dir; 26.2 and 26.3 point their windows at it
  "pc/1.20.3/windows.json": "4b3c77daa3f6b6d583b3191cd43a0e2383a682ae46679e61f66ea2017306d25f",
};

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fetchDataFiles() {
  const base = path.join(root, "minecraft-data", "minecraft-data", "data");
  for (const [rel, want] of Object.entries(FILES)) {
    const dest = path.join(base, rel);
    if (fs.existsSync(dest) && sha256(dest) === want) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + ".part";
    // -f so a 404 fails instead of writing the error page into a .json file
    execFileSync("curl", ["-sSfL", "--retry", "2", RAW + rel, "-o", tmp]);
    const got = sha256(tmp);
    if (got !== want) {
      fs.rmSync(tmp);
      throw new Error(`${rel}: sha256 ${got} is not the pinned ${want}`);
    }
    fs.renameSync(tmp, dest);
    changed++;
    say(`fetched ${rel}`);
  }
}

// data.js is generated upstream and not rebuilt at require time. The entry mirrors
// dataPaths.json at PIN; mapIcons and windows come from older dirs every install has.
const OLDER = { mapIcons: "pc/1.20.2", windows: "pc/1.20.3" };
const KEYS = [
  "attributes", "blockCollisionShapes", "blocks", "blockLoot", "biomes", "commands", "effects",
  "enchantments", "entities", "entityLoot", "foods", "instruments", "items", "language",
  "loginPacket", "mapIcons", "materials", "particles", "protocol", "recipes", "sounds", "tints",
  "version", "windows",
];

function dataJsEntry() {
  const getters = KEYS.map((k) =>
    `      get ${k} () { return require("./minecraft-data/data/${OLDER[k] || "pc/26.3"}/${k}.json") },`);
  return `    '26.3': { // patch-26.3 pin=${PIN}\n${getters.join("\n")}\n` +
    `      proto: __dirname + '/minecraft-data/data/pc/26.3/proto.yml'\n    }`;
}

function patchDataJs() {
  const p = path.join(root, "minecraft-data", "data.js");
  let src = fs.readFileSync(p, "utf8");
  if (src.includes(`patch-26.3 pin=${PIN}`)) return;
  const start = src.indexOf("    '26.3': {");
  if (start !== -1) {
    const end = src.indexOf("\n    }", start) + "\n    }".length;
    src = src.slice(0, start) + dataJsEntry() + src.slice(end);
  } else {
    const tail = "\n    }\n  },\n  'bedrock': {";
    if (!src.includes(tail)) throw new Error("data.js layout changed, can't place the 26.3 entry");
    src = src.replace(tail, "\n    },\n" + dataJsEntry() + "\n  },\n  'bedrock': {");
  }
  fs.writeFileSync(p, src);
  changed++;
  say("wrote the 26.3 entry in minecraft-data/data.js");
}

// prismarine-physics gates each behaviour by an explicit version list. These four cover every
// version from an early one up to the newest when written (26.1 or 26.2), so 26.3 is the same
// open-ended case.
const PHYSICS = ["climbUsingJump", "fluidHeightFromFeet", "shallowLavaMovement", "sprintSurvivesMinorCollision"];

function patchPhysics() {
  const p = path.join(root, "prismarine-physics", "lib", "features.json");
  const features = JSON.parse(fs.readFileSync(p, "utf8"));
  let touched = false;
  for (const name of PHYSICS) {
    const f = features.find((x) => x.name === name);
    if (!f) throw new Error(`prismarine-physics has no ${name}; is the pinned commit installed?`);
    if (!f.versions.includes("26.3")) {
      f.versions.push("26.3");
      touched = true;
    }
  }
  if (!touched) return;
  fs.writeFileSync(p, JSON.stringify(features, null, 2) + "\n");
  changed++;
  say("added 26.3 to prismarine-physics features");
}

// Without these the bot connects fine and then fails quietly: with the old player-action ids
// every dig is aborted server-side and finishing a meal drops the held item.
function verify() {
  const fail = (msg) => { throw new Error(`install is not 26.3-ready: ${msg}`); };
  const data = require(path.join(root, "minecraft-data"))("26.3");
  if (!data) fail("minecraft-data has no 26.3");
  if (data.version.version !== 777) fail(`26.3 protocol is ${data.version.version}, want 777`);
  for (const f of ["playerActionHasChangeDestroyDirection", "swingUsesPunchPacket", "teleportConfirmHasPosition"]) {
    if (!data.supportFeature(f)) fail(`minecraft-data feature ${f} is off for 26.3`);
  }
  if (!require(path.join(root, "mineflayer", "lib", "version.js")).testedVersions.includes("26.3")) {
    fail("mineflayer is not the pinned 26.3 build");
  }
  if (!fs.readFileSync(path.join(root, "prismarine-chunk", "src", "index.js"), "utf8").includes("26.3:")) {
    fail("prismarine-chunk has no 26.3 mapping");
  }
  const physics = JSON.parse(fs.readFileSync(path.join(root, "prismarine-physics", "lib", "features.json"), "utf8"));
  for (const name of ["proportionalLiquidGravity", ...PHYSICS]) {
    if (!physics.find((x) => x.name === name)?.versions.includes("26.3")) fail(`physics ${name} misses 26.3`);
  }
}

fetchDataFiles();
patchDataJs();
patchPhysics();
verify();
say(changed ? "done, checks pass" : "already applied, checks pass");
