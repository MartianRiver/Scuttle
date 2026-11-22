import assert from "node:assert/strict";
import { test } from "node:test";
import { armourPoints, bestWeapon, chooseStance, cooldownMs, isBystander, weaponFor, type Fighter } from "../src/behaviors/stance";

const me = (o: Partial<Fighter> = {}): Fighter => ({ health: 20, weapon: "iron_sword", armour: 0, x: 0, y: 0, z: 0, ...o });
const mob = (name: string, x: number, id = x) => ({ id, name, x, y: 0, z: 0 });

test("bare hands always run", () => {
  assert.deepEqual(chooseStance(me({ weapon: null }), [mob("zombie", 3)], false), { act: "flee", why: "bare hands" });
});

test("armed and healthy, a zombie or two are fought, nearest first", () => {
  const s = chooseStance(me(), [mob("zombie", 6), mob("husk", 3)], false);
  assert.equal(s.act, "fight");
  assert.equal(s.act === "fight" && s.target.name, "husk");
});

test("three melee mobs are too many without armour, fine with it", () => {
  const three = [mob("zombie", 3), mob("zombie", 4), mob("spider", 5)];
  assert.equal(chooseStance(me(), three, false).act, "flee");
  assert.equal(chooseStance(me({ armour: armourPoints(["iron_chestplate", "iron_leggings"]) }), three, false).act, "fight");
});

test("a creeper anywhere in the mix means running, so do witches and neutrals", () => {
  assert.equal(chooseStance(me(), [mob("zombie", 3), mob("creeper", 8)], false).act, "flee");
  assert.equal(chooseStance(me(), [mob("witch", 5)], false).act, "flee");
  const s = chooseStance(me(), [mob("enderman", 4)], false);
  assert.deepEqual(s, { act: "flee", why: "enderman is left alone" });
});

test("health: fights start from 12, carry on down to 8", () => {
  assert.equal(chooseStance(me({ health: 11 }), [mob("zombie", 3)], false).act, "flee");
  assert.equal(chooseStance(me({ health: 11 }), [mob("zombie", 3)], true).act, "fight");
  assert.equal(chooseStance(me({ health: 7 }), [mob("zombie", 3)], true).act, "flee");
});

test("a lone skeleton close by is closed on when healthy; far, hurt or with company it is run from", () => {
  assert.equal(chooseStance(me(), [mob("skeleton", 6)], false).act, "fight");
  assert.equal(chooseStance(me(), [mob("skeleton", 14)], false).act, "flee");
  assert.equal(chooseStance(me({ health: 13 }), [mob("skeleton", 6)], false).act, "flee");
  assert.equal(chooseStance(me(), [mob("skeleton", 6), mob("skeleton", -6)], false).act, "flee");
  assert.equal(chooseStance(me(), [mob("skeleton", 6), mob("zombie", 3)], false).act, "flee");
});

test("the best weapon is the most damage over time, not the biggest hit", () => {
  assert.equal(bestWeapon(["dirt", "iron_axe", "iron_sword"]), "iron_sword");
  assert.equal(bestWeapon(["stone_axe", "wooden_sword"]), "stone_axe");
  assert.equal(bestWeapon(["dirt", "stick"]), null);
});

test("armour points from what is worn", () => {
  assert.equal(armourPoints(["diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"]), 20);
  assert.equal(armourPoints(["turtle_helmet", "leather_boots", "elytra"]), 3);
});

test("a swing waits for the full cooldown and a little more", () => {
  assert.equal(cooldownMs("iron_sword", () => 0), 625);
  assert.equal(cooldownMs("wooden_axe", () => 0), 1250);
  assert.ok(cooldownMs("iron_sword", () => 1) > 700);
  assert.equal(cooldownMs(null, () => 0), 250);
});

test("a sword waits while someone stands by the target; an axe swings anyway", () => {
  assert.equal(weaponFor(["iron_sword"], false), "iron_sword");
  assert.equal(weaponFor(["iron_sword"], true), "wait");
  assert.equal(weaponFor(["iron_sword", "stone_axe"], true), "stone_axe");
  assert.equal(weaponFor(["iron_axe"], true), "iron_axe");
});

test("bystanders: players, pets, villagers, golems and neutrals; not the mobs being fought", () => {
  assert.equal(isBystander("player", "player"), true);
  assert.equal(isBystander("animal", "wolf"), true);
  assert.equal(isBystander("passive", "villager"), true);
  assert.equal(isBystander("mob", "iron_golem"), true);
  assert.equal(isBystander("hostile", "zombified_piglin"), true);
  assert.equal(isBystander("hostile", "zombie"), false);
  assert.equal(isBystander("projectile", "arrow"), false);
  assert.equal(isBystander("other", "item"), false);
});
