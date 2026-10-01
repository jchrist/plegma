import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { handlePromptRequest } from "../src/git/prompt.js";

function stubVscode(result) {
  const seen = [];
  return {
    seen,
    window: {
      async showInputBox(opts) {
        seen.push(opts);
        return result;
      },
    },
  };
}

function req(id, method, args) {
  return { type: "git/request", id, method, args };
}

describe("handlePromptRequest", () => {
  it("returns the entered value and forwards prompt options", async () => {
    const vscode = stubVscode("feat/x");
    const res = await handlePromptRequest(
      vscode,
      req("1", "promptInput", { prompt: "Name?", placeHolder: "hint" }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "1",
      ok: true,
      data: { value: "feat/x" },
    });
    assert.equal(vscode.seen[0].prompt, "Name?");
    assert.equal(vscode.seen[0].placeHolder, "hint");
  });

  it("maps dismissal (undefined) to null", async () => {
    const res = await handlePromptRequest(stubVscode(undefined), req("2", "promptInput", {}));
    assert.deepEqual(res.data, { value: null });
  });

  it("ignores non-prompt messages", async () => {
    assert.equal(await handlePromptRequest(stubVscode("x"), req("3", "log")), null);
    assert.equal(await handlePromptRequest(stubVscode("x"), req("4", "bogus")), null);
    assert.equal(await handlePromptRequest(stubVscode("x"), null), null);
  });
});

describe("handlePromptRequest promptPick", () => {
  function stubPick(result) {
    const seen = [];
    return {
      seen,
      window: {
        async showQuickPick(items, opts) {
          seen.push({ items, opts });
          return result;
        },
      },
    };
  }

  it("returns the picked item value", async () => {
    const vscode = stubPick({ label: "Hard", value: "hard" });
    const res = await handlePromptRequest(vscode, {
      type: "git/request",
      id: "10",
      method: "promptPick",
      args: {
        placeHolder: "Pick one",
        items: [{ label: "Hard", description: "d", value: "hard" }],
      },
    });
    assert.deepEqual(res, {
      type: "git/response",
      id: "10",
      ok: true,
      data: { value: "hard" },
    });
    assert.equal(vscode.seen[0].opts.placeHolder, "Pick one");
  });

  it("maps dismissal to null and ignores bad input", async () => {
    const res = await handlePromptRequest(stubPick(undefined), {
      type: "git/request",
      id: "11",
      method: "promptPick",
      args: {},
    });
    assert.deepEqual(res.data, { value: null });
  });
});
