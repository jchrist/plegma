// Headless end-to-end smoke tests: extension activation -> view resolves ->
// git/request protocol -> real git fixture repo -> vscode.diff capture.
// No VS Code download needed: the fake `vscode` API object is injected into
// activate() (the real `vscode` package only exists in the editor).
import { describe, it, beforeAll, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createFakeVscode, Uri } from "./helpers/fakeVscode";
import { buildFixtureRepo, removeFixtureRepo } from "./helpers/fixtureRepo";
import manifest from "../package.json";
import { activate } from "../src/extension.js";
import { GitWindowPanel } from "../src/GitWindowPanel.js";

describe("plegma end-to-end (headless)", () => {
  let ctx;
  let panel;
  let requestId = 0;

  async function request(method, args) {
    const id = String(++requestId);
    await panel.handler({ type: "git/request", id, method, args });
    // Handlers are async; poll briefly for the paired response.
    for (let i = 0; i < 100; i++) {
      const found = panel.posted.filter((m) => m && m.id === id);
      const res = found[found.length - 1];
      if (res) {
        return res;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`No response for ${method}`);
  }

  beforeAll(async () => {
    GitWindowPanel.currentPanel = undefined;
    const { dir, renameSha } = await buildFixtureRepo();
    const fake = createFakeVscode({ workspaceRoot: dir });
    const context = { extensionUri: Uri.file("/ext"), subscriptions: [] };
    activate(context, fake.vscode);
    await fake.commandsRegistered.get("plegma.openGitWindow")();
    assert.equal(fake.panels.length, 1, "editor panel created");
    panel = fake.panels[0];
    assert.ok(panel.handler, "panel message handler wired");
    ctx = { dir, renameSha, fake };
  });

  afterAll(async () => {
    GitWindowPanel.currentPanel = undefined;
    if (ctx) {
      await removeFixtureRepo(ctx.dir);
    }
  });

  it("registers commands and resolves the editor panel html", () => {
    for (const cmd of ["plegma.openGitWindow", "plegma.probeGitService"]) {
      assert.ok(ctx.fake.commandsRegistered.has(cmd), `command ${cmd} registered`);
    }
    assert.ok(
      !ctx.fake.commandsRegistered.has("plegma.openGitWindowInPanel"),
      "no bottom-panel command",
    );
    assert.ok(!manifest.contributes.views, "manifest declares no views");
    assert.ok(
      (manifest.activationEvents || []).includes("onStartupFinished"),
      "activates on startup so the status bar item is always present",
    );
    const tabIcon = (panel.iconPath && panel.iconPath.fsPath) || "";
    assert.ok(tabIcon.endsWith(manifest.icon), "editor tab shows the extensions page icon");
    assert.equal(ctx.fake.statusItems.length, 1);
    assert.equal(ctx.fake.statusItems[0].command, "plegma.openGitWindow");
    assert.ok(ctx.fake.statusItems[0].shown);
    assert.match(panel.webview.html, /plegma-initial-state/);
    assert.match(panel.webview.html, /<title>Plegma<\/title>/);
  });

  it("uses the extensions page icon on the editor tab, on every color theme", async () => {
    // The tab shows the exact same file as the Extensions page: no per-theme
    // swap, the full-color mark reads on light, dark and high-contrast tabs.
    for (const kind of [1, 2, 3, 4]) {
      ctx.fake.setColorThemeKind(kind);
      const tabIcon = (panel.iconPath && panel.iconPath.fsPath) || "";
      assert.ok(
        tabIcon.endsWith(manifest.icon),
        `theme kind ${kind} keeps the extensions page icon`,
      );
    }
    ctx.fake.setColorThemeKind(1);
    const stat = await fs.stat(new URL(`../${manifest.icon}`, import.meta.url));
    assert.ok(stat.isFile(), "marketplace icon exists");
    for (const gone of ["git-window.svg", "git-window-dark.svg"]) {
      await assert.rejects(
        fs.stat(new URL(`../resources/${gone}`, import.meta.url)),
        `per-theme ${gone} is gone: the tab shares the one mark`,
      );
    }
  });

  it("loads the live commit graph", async () => {
    const res = await request("log", { limit: 100 });
    assert.equal(res.ok, true);
    const subjects = res.data.map((c) => c.subject);
    assert.ok(subjects.includes("feat: initial app"));
    assert.ok(subjects.includes("refactor: rename app to main"));
    assert.ok(res.data.every((c) => c.hash && Array.isArray(c.parents)));
  });

  it("lists local branches with the head marked", async () => {
    const res = await request("branches");
    assert.equal(res.ok, true);
    const byName = new Map(res.data.map((b) => [b.name, b]));
    assert.ok(byName.has("main"));
    assert.ok(byName.has("feature"));
    assert.equal(byName.get("main").isHead, true);
  });

  it("lists tags", async () => {
    const res = await request("tags");
    assert.equal(res.ok, true);
    assert.ok(res.data.some((t) => t.name === "v0.1"));
  });

  it("shows renamed files for the rename commit", async () => {
    const res = await request("files", { sha: ctx.renameSha });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, [{ path: "main.js", oldPath: "app.js", status: "Renamed" }]);
  });

  it("opens a file diff with real contents", async () => {
    const log = await request("log", { limit: 100 });
    const tweak = log.data.find((c) => c.subject === "feat: feature tweak");
    assert.ok(tweak, "feature commit present");
    const res = await request("openDiff", {
      sha: tweak.hash,
      parentSha: tweak.parents[0],
      path: "app.js",
      status: "Modified",
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, { opened: true });
    const diffCall = ctx.fake.executedCommands.find(([id]) => id === "vscode.diff");
    assert.ok(diffCall, "vscode.diff executed");
    const [, oldUri, newUri, title] = diffCall;
    assert.match(title, /app\.js/);
    assert.equal(await fs.readFile(oldUri.fsPath, "utf8"), "console.log(2);\n");
    assert.equal(await fs.readFile(newUri.fsPath, "utf8"), "console.log(3);\n");
    // Cleanup temp diff dirs.
    for (const u of [oldUri, newUri]) {
      const m = u.fsPath.match(/(.*plegma-diff-[^/]*)/);
      if (m) {
        await fs.rm(m[1], { recursive: true, force: true });
      }
    }
  });

  it("checks out the feature branch", async () => {
    const res = await request("checkout", { ref: "feature" });
    assert.equal(res.ok, true);
    const branches = await request("branches");
    const head = branches.data.find((b) => b.isHead);
    assert.equal(head.name, "feature");
    // Leave the repo on main for other tests.
    await request("checkout", { ref: "main" });
  });

  it("reports no rebase in progress and a CLI probe", async () => {
    const status = await request("rebaseStatus");
    assert.deepEqual(status.data, { inProgress: false, conflictedFiles: [] });
    const probe = await request("probe");
    assert.equal(probe.data.fallback, "cli");
    assert.equal(probe.data.capabilities.log, true);
  });
});
