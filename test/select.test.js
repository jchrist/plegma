import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { toggleCheck, rangeSelect } from "../src/webview/select.js";

describe("toggleCheck", () => {
  it("adds a missing hash and removes a present one", () => {
    assert.deepEqual(toggleCheck([], "a"), ["a"]);
    assert.deepEqual(toggleCheck(["a", "b"], "a"), ["b"]);
  });
});

describe("rangeSelect", () => {
  const order = ["a", "b", "c", "d"];

  it("unions the forward range", () => {
    assert.deepEqual(rangeSelect([], order, "b", "d"), ["b", "c", "d"]);
  });

  it("unions the backward range keeping existing picks", () => {
    assert.deepEqual(rangeSelect(["a"], order, "d", "b"), ["a", "b", "c", "d"]);
  });

  it("falls back to toggle for an unknown anchor", () => {
    assert.deepEqual(rangeSelect(["a"], order, "zzz", "c"), ["a", "c"]);
  });
});
