// Fast unit tests for extension activation and the git message handler.
// No real git, no editor: a fake vscode object plus a tmp non-repo dir.
// One boot for the whole file: the editor panel is a singleton inside the
// extension host, so every test talks to the same panel and indexes the
// posted responses relatively.
import { describe, it, beforeAll, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activate } from "../src/extension.js";
import { openCommit } from "../src/git/compare.js";

function fakeUri(fsPath, scheme = "file", query = "") {
  const uri = {
    fsPath,
    path: fsPath,
    scheme,
    query,
    with(change = {}) {
      return fakeUri(
        change.path !== undefined ? change.path : uri.path,
        change.scheme || uri.scheme,
        change.query !== undefined ? change.query : uri.query,
      );
    },
    toString: () => `${uri.scheme}://${fsPath}${uri.query ? `?${uri.query}` : ""}`,
  };
  return uri;
}

function createFakeVscode({ workspaceRoot } = {}) {
  const registered = { providers: [], commands: new Map() };
  const executed = [];
  const shown = { items: [], messages: [], channels: [] };
  const panels = [];
  const vscode = {
    Uri: {
      file: (p) => fakeUri(p),
      from: (parts) => fakeUri(parts.path, parts.scheme || "file", parts.query || ""),
      joinPath: (base, ...parts) => fakeUri(`${base.fsPath}/${parts.join("/")}`),
    },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1 },
    window: {
      activeTextEditor: undefined,
      createOutputChannel: (name) => {
        // One spelling of the name everywhere the user reads it.
        shown.channels.push(name);
        return { appendLine() {}, show() {}, dispose() {} };
      },
      createStatusBarItem: () => {
        const item = {
          shown: false,
          show() {
            this.shown = true;
          },
          dispose() {},
        };
        shown.items.push(item);
        return item;
      },
      registerWebviewViewProvider: (viewId, provider, options) => {
        registered.providers.push({ viewId, provider, options });
        return { dispose() {} };
      },
      showInformationMessage: async (m) => shown.messages.push(["info", m]),
      showWarningMessage: async (m) => shown.messages.push(["warn", m]),
      showErrorMessage: async (m) => shown.messages.push(["error", m]),
      showInputBox: async () => "typed-name",
      createWebviewPanel: (...args) => {
        const rec = { args, handler: null, posted: [], iconPath: undefined };
        panels.push(rec);
        return {
          get iconPath() {
            return rec.iconPath;
          },
          set iconPath(v) {
            rec.iconPath = v;
          },
          webview: {
            html: "",
            cspSource: "vscode-webview://test",
            asWebviewUri: (uri) => fakeUri(`wrapped${uri.fsPath}`),
            onDidReceiveMessage(fn) {
              rec.handler = fn;
              return { dispose() {} };
            },
            async postMessage(msg) {
              rec.posted.push(msg);
            },
          },
          onDidDispose() {},
          reveal() {},
          dispose() {},
        };
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        registered.commands.set(id, fn);
        return { dispose() {} };
      },
      executeCommand: async (id, ...args) => {
        executed.push([id, ...args]);
      },
    },
    workspace: {
      workspaceFolders: workspaceRoot ? [{ uri: fakeUri(workspaceRoot) }] : [],
    },
    extensions: { getExtension: () => undefined },
  };
  return { vscode, registered, executed, shown, panels };
}

describe("extension activation", () => {
  let dir;
  let vscode;
  let registered;
  let executed;
  let shown;
  let panels;
  let panel;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-ext-"));
    const fake = createFakeVscode({ workspaceRoot: dir });
    activate({ extensionUri: fakeUri("/ext"), subscriptions: [] }, fake.vscode);
    ({ registered, executed, shown, panels } = fake);
    vscode = fake.vscode;
    await registered.commands.get("plegma.openGitWindow")();
    panel = panels.slice(-1)[0];
    assert.ok(panel && panel.handler, "editor panel created with a message handler");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("registers commands and a shown status item (no bottom-panel view)", () => {
    assert.deepEqual(
      registered.providers.map((p) => p.viewId),
      [],
      "no webview view providers registered",
    );
    assert.deepEqual([...registered.commands.keys()].sort(), [
      "plegma.openGitWindow",
      "plegma.probeGitService",
    ]);
    assert.equal(shown.items.length, 1);
    assert.equal(shown.items[0].command, "plegma.openGitWindow");
    assert.equal(shown.items[0].shown, true);
  });

  it("opens the window in the editor with the extensions page icon", async () => {
    assert.equal(panels.length, 1);
    assert.equal(panel.args[0], "plegma.gitWindow");
    assert.match(panel.iconPath && panel.iconPath.fsPath, /resources\/icon\.png$/);
  });

  it("spells the name the same way everywhere the user reads it", () => {
    // "Plegma" in the palette and on the status bar; the tab and the output
    // channel used to say "plegma".
    assert.deepEqual(shown.channels, ["Plegma"]);
    assert.equal(panel.args[1], "Plegma");
  });

  it("probe reports failure without a repository", async () => {
    await registered.commands.get("plegma.probeGitService")();
    assert.ok(
      shown.messages.some(([level, text]) => level === "error" && /probe failed/i.test(text)),
      "probe failure surfaced for repo-less workspace",
    );
  });

  it("answers roots with a null root and rejects reads past the store", async () => {
    const mark = panel.posted.length;
    await panel.handler({ type: "git/request", id: "1", method: "roots" });
    const at = panel.posted.slice(mark);
    assert.equal(at[0].ok, true);
    assert.equal(at[0].data.roots.length, 1);
    assert.equal(at[0].data.roots[0].folder, dir);
    assert.ok(!at[0].data.roots[0].root, "no repo root detected");
    await panel.handler({ type: "git/request", id: "2", method: "log", args: { limit: 5 } });
    const after = panel.posted.slice(mark);
    assert.equal(after[1].ok, false);
    assert.match(after[1].error, /No git repository/);
    const postedBefore = panel.posted.length;
    await panel.handler({ type: "ping", payload: "p" });
    assert.deepEqual(panel.posted[panel.posted.length - 1], {
      type: "pong",
      payload: "p",
    });
    assert.equal(panel.posted.length, postedBefore + 1, "ping answered, nothing else posted");
  });

  it("reveals the SCM view without needing a repository", async () => {
    await panel.handler({ type: "git/request", id: "7", method: "revealScm" });
    assert.ok(
      executed.some(([id]) => id === "workbench.view.scm"),
      "SCM view revealed",
    );
    const res = panel.posted[panel.posted.length - 1];
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, { ok: true });
  });

  it("answers prompts without needing a repository", async () => {
    const mark = panel.posted.length;
    await panel.handler({
      type: "git/request",
      id: "3",
      method: "promptInput",
      args: { prompt: "Name?" },
    });
    assert.deepEqual(panel.posted.slice(mark), [
      {
        type: "git/response",
        id: "3",
        ok: true,
        data: { value: "typed-name" },
      },
    ]);
  });

  it("routes openCommit/openCompare past the store (repo-gated, not unknown)", async () => {
    await panel.handler({ type: "git/request", id: "10", method: "openCommit", args: {} });
    const commitRes = panel.posted[panel.posted.length - 1];
    assert.equal(commitRes.ok, false);
    assert.match(commitRes.error || "", /No git repository|needs \{ sha \}/);
    await panel.handler({
      type: "git/request",
      id: "11",
      method: "openCompare",
      args: { oldRev: "a", newRev: "b" },
    });
    const compareRes = panel.posted[panel.posted.length - 1];
    assert.equal(compareRes.ok, false);
    assert.match(compareRes.error || "", /No git repository|built-in Git extension/);
  });

  it("openCommit delegates to the built-in git.viewCommit", async () => {
    const calls = [];
    const stubVscode = {
      ...vscode,
      commands: {
        executeCommand: async (id, ...args) => {
          calls.push([id, ...args]);
        },
      },
      extensions: { getExtension: () => ({ isActive: true }) },
    };
    assert.deepEqual(await openCommit(stubVscode, "/repo", "abc123"), { opened: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "git.viewCommit");
  });
});
