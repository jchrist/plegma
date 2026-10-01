import { describe, it, beforeEach } from "vite-plus/test";
import assert from "node:assert/strict";
import { loadStored, storeValue, asBoolean, asString, asOneOf } from "../src/webview/settings.js";

describe("settings storage", () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };

  beforeEach(() => {
    store.clear();
    globalThis.localStorage = fakeStorage;
  });

  it("returns the fallback when nothing is stored", () => {
    assert.equal(loadStored("plegma.missing", 42), 42);
  });

  it("round-trips JSON values", () => {
    storeValue("plegma.obj", { prune: true });
    assert.deepEqual(loadStored("plegma.obj", {}), { prune: true });
  });

  it("falls back on corrupt storage", () => {
    store.set("plegma.broken", "{nope");
    assert.equal(loadStored("plegma.broken", "dflt"), "dflt");
  });

  it("works without localStorage (SSR, tests)", () => {
    delete globalThis.localStorage;
    assert.equal(loadStored("plegma.x", "dflt"), "dflt");
    storeValue("plegma.x", 1); // must not throw
  });

  it("coerces booleans, strings, and enums", () => {
    assert.equal(asBoolean("yes", true), true);
    assert.equal(asBoolean(false, true), false);
    assert.equal(asString(7, "dflt"), "dflt");
    const mode = asOneOf(["soft", "mixed", "hard"]);
    assert.equal(mode("hard", "mixed"), "hard");
    assert.equal(mode("sideways", "mixed"), "mixed");
    assert.equal(loadStored("plegma.k", "mixed", mode), "mixed");
    store.set("plegma.k", JSON.stringify("soft"));
    assert.equal(loadStored("plegma.k", "mixed", mode), "soft");
  });
});
