import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exitDelayMs, isDuplicateLogin, restartDelayMs } from "../src/lib/restart";

test("delay doubles per quick failure and stops at five minutes", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => restartDelayMs(n, false)), [2000, 4000, 8000, 16000]);
  assert.equal(restartDelayMs(40, false), 300_000);
});

test("a duplicate login always waits the maximum", () => {
  assert.equal(restartDelayMs(1, true), 300_000);
});

test("duplicate login is found in a string or a chat object", () => {
  assert.ok(isDuplicateLogin('{"translate":"multiplayer.disconnect.duplicate_login"}'));
  assert.ok(isDuplicateLogin({ text: "You logged in from another location" }));
  assert.ok(!isDuplicateLogin("Server closed"));
});

test("streak grows across quick exits, resets after a long run or a long gap", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restart-")), "state.json");
  const t = 1_000_000;
  assert.equal(exitDelayMs(file, t - 5_000, false, t), 2000);
  assert.equal(exitDelayMs(file, t + 1000, false, t + 6_000), 4000);
  assert.equal(exitDelayMs(file, t + 7000, false, t + 12_000), 8000);
  assert.equal(exitDelayMs(file, t, false, t + 12_000 + 120_000), 2000, "a run over a minute starts over");
  assert.equal(exitDelayMs(file, t + 1e7, false, t + 1e7 + 1000), 2000, "an old streak is forgotten");
});
