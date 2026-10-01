import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { signatureLabel, signatureColor, signatureText } from "../src/webview/signature.js";

describe("signatureLabel", () => {
  it("maps git's %G? codes to readable labels", () => {
    assert.equal(signatureLabel("G"), "Verified");
    assert.equal(signatureLabel("U"), "Verified (unknown validity)");
    assert.equal(signatureLabel("B"), "Bad signature");
    assert.equal(signatureLabel("E"), "Cannot be checked (missing key)");
    assert.equal(signatureLabel("N"), "Unsigned");
  });

  it("falls back to Unsigned for missing or unknown codes", () => {
    assert.equal(signatureLabel(""), "Unsigned");
    assert.equal(signatureLabel(undefined), "Unsigned");
    assert.equal(signatureLabel("Z"), "Unsigned");
  });
});

describe("signatureColor", () => {
  it("marks good signatures green and problems as warnings", () => {
    assert.match(signatureColor("G"), /iconPassed|#3fb950/);
    assert.match(signatureColor("U"), /iconPassed|#3fb950/);
    assert.match(signatureColor("B"), /Warning|#cca700/);
    assert.match(signatureColor("E"), /Warning|#cca700/);
    assert.doesNotMatch(signatureColor("N"), /iconPassed|Warning/);
  });
});

describe("signatureText", () => {
  it("appends the signer when git knows one", () => {
    assert.equal(
      signatureText({ sigStatus: "G", sigSigner: "Ada <ada@x>" }),
      "Verified · Ada <ada@x>",
    );
    assert.equal(signatureText({ sigStatus: "N", sigSigner: "" }), "Unsigned");
    assert.equal(signatureText(null), "");
  });
});
