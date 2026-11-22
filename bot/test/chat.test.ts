import assert from "node:assert/strict";
import { test } from "node:test";
import { chatIntent } from "../src/api/chat";

test("chat commands map to intents", () => {
  assert.deepEqual(chatIntent("Sam", "come here"), { intent: "come_to", player: "Sam" });
  assert.deepEqual(chatIntent("Sam", "stop"), { intent: "stop" });
  assert.deepEqual(chatIntent("Sam", "get wood"), { intent: "task", name: "get_wood" });
});

test("chat: anything else is not a command", () => {
  for (const text of ["come here please", "Stop", "stop!", " get wood", "get_wood", "follow me", ""]) {
    assert.equal(chatIntent("Sam", text), null, text);
  }
});

test("chat: a speaker name the API would refuse gets nothing", () => {
  assert.equal(chatIntent("a b", "come here"), null);
  assert.equal(chatIntent("x".repeat(18), "come here"), null);
  // stop and get wood carry no name, so they don't depend on it
  assert.deepEqual(chatIntent("a b", "stop"), { intent: "stop" });
});
