import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVersion, SUPPORTED_VERSION } from "../src/lib/version";

test("unset or matching version resolves to the supported one", () => {
  assert.equal(resolveVersion(undefined), SUPPORTED_VERSION);
  assert.equal(resolveVersion(""), SUPPORTED_VERSION);
  assert.equal(resolveVersion(SUPPORTED_VERSION), SUPPORTED_VERSION);
});

test("another version is refused", () => {
  assert.throws(() => resolveVersion("26.2"), /not supported/);
});
