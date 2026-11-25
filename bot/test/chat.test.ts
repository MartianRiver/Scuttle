import assert from "node:assert/strict";
import { test } from "node:test";
import { chatIntent } from "../src/api/chat";

test("chat commands map to intents", () => {
  assert.deepEqual(chatIntent("Sam", "come here"), { intent: "come_to", player: "Sam" });
  assert.deepEqual(chatIntent("Sam", "stop"), { intent: "stop" });
  assert.deepEqual(chatIntent("Sam", "get wood"), { intent: "task", name: "get_wood" });
  assert.deepEqual(chatIntent("Sam", "get stone"), { intent: "task", name: "get_stone" });
  assert.deepEqual(chatIntent("Sam", "get iron"), { intent: "task", name: "get_iron" });
  assert.deepEqual(chatIntent("Sam", "guard me"), { intent: "guard", player: "Sam" });
});

test("chat: case, spacing and trailing punctuation do not change the command", () => {
  const stop = { intent: "stop" };
  for (const text of ["Stop", "STOP!", "stop!!", "stop.", " stop ", "stop?!"]) assert.deepEqual(chatIntent("Sam", text), stop, text);
  assert.deepEqual(chatIntent("Sam", "Get  Stone!"), { intent: "task", name: "get_stone" });
  assert.deepEqual(chatIntent("Sam", "Guard me."), { intent: "guard", player: "Sam" });
  assert.deepEqual(chatIntent("Sam", " get wood"), { intent: "task", name: "get_wood" });
});

test("chat: anything else is not a command", () => {
  for (const text of ["come here please", "please stop", "don't stop", "stop it", "stop, stop", "get_wood", "get_stone", "get stone please", "get_iron", "get iron please", "follow me", "guard me please", "guard", "guard Sam", "!", ""]) {
    assert.equal(chatIntent("Sam", text), null, text);
  }
});

test("chat: a speaker name the API would refuse gets nothing", () => {
  assert.equal(chatIntent("a b", "come here"), null);
  assert.equal(chatIntent("x".repeat(18), "come here"), null);
  assert.equal(chatIntent("a b", "guard me"), null);
  // stop and the tasks carry no name, so they don't depend on it
  assert.deepEqual(chatIntent("a b", "stop"), { intent: "stop" });
});
