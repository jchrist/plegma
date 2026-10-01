import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { Uri } from "./helpers/fakeVscode.js";
import { openCommit, openCompare, openCompareWorktree } from "../src/git/compare.js";

function fakeVscode({ gitExtension } = {}) {
  const executed = [];
  return {
    executed,
    vscode: {
      Uri,
      commands: {
        executeCommand: async (id, ...args) => {
          executed.push([id, ...args]);
        },
      },
      extensions: { getExtension: () => gitExtension },
    },
  };
}

function stubService(files) {
  return {
    repoRoot: "/repo",
    async compareRefs() {
      return files;
    },
  };
}

describe("openCommit", () => {
  it("needs a sha", async () => {
    const { vscode } = fakeVscode({ gitExtension: {} });
    await assert.rejects(openCommit(vscode, "/repo", undefined), /needs \{ sha \}/);
  });

  it("refuses without the built-in git extension", async () => {
    const { vscode } = fakeVscode();
    await assert.rejects(openCommit(vscode, "/repo", "abc"), /built-in Git extension/);
  });

  it("delegates to git.viewCommit with the repo root and sha", async () => {
    const { vscode, executed } = fakeVscode({ gitExtension: { isActive: true } });
    assert.deepEqual(await openCommit(vscode, "/repo", "abc123"), { opened: true });
    assert.equal(executed.length, 1);
    assert.equal(executed[0][0], "git.viewCommit");
    assert.equal(executed[0][1].fsPath, "/repo");
    assert.equal(executed[0][2], "abc123");
  });
});

describe("openCompare", () => {
  it("needs both revisions", async () => {
    const { vscode } = fakeVscode({ gitExtension: {} });
    await assert.rejects(openCompare(vscode, stubService([]), { oldRev: "a" }), /oldRev, newRev/);
  });

  it("refuses without the built-in git extension", async () => {
    const { vscode } = fakeVscode();
    await assert.rejects(
      openCompare(vscode, stubService([]), { oldRev: "a", newRev: "b" }),
      /built-in Git extension/,
    );
  });

  it("reports empty diffs instead of opening an editor", async () => {
    const { vscode, executed } = fakeVscode({ gitExtension: {} });
    const res = await openCompare(vscode, stubService([]), {
      oldRev: "a",
      newRev: "a",
      oldLabel: "origin/main",
      newLabel: "aaa111",
    });
    assert.equal(res.empty, true);
    assert.match(res.message, /no changes between "origin\/main" and "aaa111"/);
    assert.deepEqual(executed, []);
  });

  it("opens the native multi-diff with git: revision URIs", async () => {
    const { vscode, executed } = fakeVscode({ gitExtension: {} });
    const files = [
      { path: "mod.js", status: "Modified" },
      { path: "new.js", status: "Added" },
      { path: "old.js", status: "Deleted" },
      { path: "ren.js", oldPath: "was.js", status: "Renamed" },
    ];
    const res = await openCompare(vscode, stubService(files), {
      oldRev: "oldsha",
      newRev: "newsha",
      oldLabel: "origin/main",
      newLabel: "aaa111",
    });
    assert.deepEqual(res, { opened: 4 });
    assert.equal(executed.length, 1);
    const [id, args] = executed[0];
    assert.equal(id, "_workbench.openMultiDiffEditor");
    assert.equal(args.title, "origin/main ↔ aaa111");
    assert.equal(args.resources.length, 4);
    const [mod, added, deleted, ren] = args.resources;
    assert.match(mod.originalUri.query, /"ref":"oldsha"/);
    assert.match(mod.modifiedUri.query, /"ref":"newsha"/);
    assert.equal(added.originalUri, undefined);
    assert.match(added.modifiedUri.query, /"ref":"newsha"/);
    assert.match(deleted.originalUri.query, /"ref":"oldsha"/);
    assert.equal(deleted.modifiedUri, undefined);
    assert.match(ren.originalUri.query, /was\.js/);
    assert.equal(mod.originalUri.scheme, "git");
  });
});

describe("openCompareWorktree", () => {
  function worktreeService(files) {
    return {
      repoRoot: "/repo",
      async compareWorktree() {
        return files;
      },
    };
  }

  it("needs a revision", async () => {
    const { vscode } = fakeVscode({ gitExtension: {} });
    await assert.rejects(openCompareWorktree(vscode, worktreeService([]), {}), /needs \{ rev \}/);
  });

  it("refuses without the built-in git extension", async () => {
    const { vscode } = fakeVscode();
    await assert.rejects(
      openCompareWorktree(vscode, worktreeService([]), { rev: "a" }),
      /built-in Git extension/,
    );
  });

  it("reports a clean worktree instead of opening an editor", async () => {
    const { vscode, executed } = fakeVscode({ gitExtension: {} });
    const res = await openCompareWorktree(vscode, worktreeService([]), {
      rev: "aaa111",
      label: "aaa111",
    });
    assert.equal(res.empty, true);
    assert.match(res.message, /no changes between "aaa111" and the working tree/);
    assert.deepEqual(executed, []);
  });

  it("opens the multi-diff with plain file URIs on the worktree side", async () => {
    const { vscode, executed } = fakeVscode({ gitExtension: {} });
    const files = [
      { path: "mod.js", status: "Modified" },
      { path: "new.js", status: "Added" },
      { path: "old.js", status: "Deleted" },
      { path: "ren.js", oldPath: "was.js", status: "Renamed" },
    ];
    const res = await openCompareWorktree(vscode, worktreeService(files), {
      rev: "aaa111",
      label: "aaa111",
    });
    assert.deepEqual(res, { opened: 4 });
    assert.equal(executed.length, 1);
    const [id, args] = executed[0];
    assert.equal(id, "_workbench.openMultiDiffEditor");
    assert.equal(args.title, "aaa111 ↔ working tree");
    assert.equal(args.multiDiffSourceUri.scheme, "git-worktree-compare");
    const [mod, added, deleted, ren] = args.resources;
    assert.equal(mod.originalUri.scheme, "git");
    assert.match(mod.originalUri.query, /"ref":"aaa111"/);
    assert.equal(mod.modifiedUri.scheme, "file");
    assert.equal(mod.modifiedUri.fsPath, "/repo/mod.js");
    assert.equal(added.originalUri, undefined);
    assert.equal(added.modifiedUri.fsPath, "/repo/new.js");
    assert.match(deleted.originalUri.query, /"ref":"aaa111"/);
    assert.equal(deleted.modifiedUri, undefined);
    assert.match(ren.originalUri.query, /was\.js/);
    assert.equal(ren.modifiedUri.fsPath, "/repo/ren.js");
  });
});
