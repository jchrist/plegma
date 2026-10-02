import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { handleGitRequest } from "../src/git/index.js";

function stubService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async probe() {
      calls.push(["probe"]);
      return { vscodeGitAvailable: false };
    },
    async listCommits(limit, filters) {
      calls.push(["log", limit, filters]);
      return [{ hash: "abc" }];
    },
    async listBranches() {
      calls.push(["branches"]);
      return [];
    },
    async listTags() {
      calls.push(["tags"]);
      return [];
    },
    async listCommitFiles(sha) {
      calls.push(["files", sha]);
      return [];
    },
    async fileDiff(spec) {
      calls.push(["fileDiff", spec]);
      return { text: "@@ -1 +1 @@\n", truncated: false };
    },
    async worktreeFileDiff(relPath) {
      calls.push(["worktreeFileDiff", relPath]);
      return { text: "@@ -0,0 +1 @@\n+x\n", truncated: false };
    },
    async statusFiles() {
      calls.push(["statusFiles"]);
      return [{ path: "a.js", status: "Modified" }];
    },
    async stashPush(message, opts) {
      calls.push(["stashPush", message, opts]);
      return { stashed: true };
    },
    async stashList() {
      calls.push(["stashList"]);
      return [];
    },
    async stashApply(name) {
      calls.push(["stashApply", name]);
    },
    async stashPop(name) {
      calls.push(["stashPop", name]);
    },
    async stashDrop(name) {
      calls.push(["stashDrop", name]);
    },
    async stashBranch(branchName, stashName) {
      calls.push(["stashBranch", branchName, stashName]);
    },
    async discardWorktree(paths) {
      calls.push(["discardWorktree", paths]);
      return { discarded: true };
    },
    async rewrite(spec) {
      calls.push(["rewrite", spec]);
      return { rewritten: true, backupRef: "refs/plegma-backup/b-1" };
    },
    async rebaseOnto(upstream) {
      calls.push(["rebase", upstream]);
      return { rebased: true, backupRef: "refs/plegma-backup/b-2" };
    },
    async rebaseContinue() {
      calls.push(["rebaseContinue"]);
      return { continued: true };
    },
    async rebaseSkip() {
      calls.push(["rebaseSkip"]);
      return { skipped: true };
    },
    async rebaseAbort() {
      calls.push(["rebaseAbort"]);
      return { aborted: true };
    },
    async rebaseStatus() {
      calls.push(["rebaseStatus"]);
      return { inProgress: false, conflictedFiles: [] };
    },
    async checkout(ref) {
      calls.push(["checkout", ref]);
    },
    async deleteBranch(name, force) {
      calls.push(["deleteBranch", name, force]);
    },
    async createBranch(name, startPoint) {
      calls.push(["createBranch", name, startPoint]);
    },
    async createTag(name, target) {
      calls.push(["createTag", name, target]);
    },
    async renameBranch(oldName, newName) {
      calls.push(["renameBranch", oldName, newName]);
    },
    async mergeBranch(name) {
      calls.push(["mergeBranch", name]);
      return { merged: true, backupRef: "refs/plegma-backup/main-1" };
    },
    async mergeCommit(sha) {
      calls.push(["mergeCommit", sha]);
      return { merged: true, backupRef: "refs/plegma-backup/main-4" };
    },
    async updateBranch(name) {
      calls.push(["updateBranch", name]);
      return { updated: name, backTo: "main", stashed: false };
    },
    async mergeStatus() {
      calls.push(["mergeStatus"]);
      return { inProgress: false, conflictedFiles: [] };
    },
    async mergeContinue() {
      calls.push(["mergeContinue"]);
      return { continued: true };
    },
    async mergeAbort() {
      calls.push(["mergeAbort"]);
      return { aborted: true };
    },
    async commitContext(shas) {
      calls.push(["commitContext", shas]);
      return { head: "h", commits: {} };
    },
    async cherryPick(sha, opts) {
      calls.push(["cherryPick", sha, opts]);
      return { picked: true, backupRef: "refs/plegma-backup/main-2" };
    },
    async resetTo(sha, mode) {
      calls.push(["resetTo", sha, mode]);
      return { reset: true, backupRef: "refs/plegma-backup/main-3" };
    },
    async revertCommit(sha) {
      calls.push(["revertCommit", sha]);
      return { reverted: true };
    },
    async revertFileToRevision(spec) {
      calls.push(["revertFile", spec]);
      return { reverted: true };
    },
    async listWorktrees() {
      calls.push(["worktrees"]);
      return [];
    },
    async pull() {
      calls.push(["pull"]);
    },
    async fetch(prune, pruneTags) {
      calls.push(["fetch", prune, pruneTags]);
    },
    async fingerprint() {
      calls.push(["fingerprint"]);
      return "fp";
    },
    async push(force) {
      calls.push(["push", force]);
    },
    async pushBranch(name, opts) {
      calls.push(["pushBranch", name, opts]);
      return { pushed: name };
    },
    async listRemoteDetails() {
      calls.push(["remoteDetails"]);
      return [{ name: "origin", fetchUrl: "u", pushUrl: "u" }];
    },
    async addRemote(name, url) {
      calls.push(["addRemote", name, url]);
      return { added: name };
    },
    async renameRemote(oldName, newName) {
      calls.push(["renameRemote", oldName, newName]);
      return { renamed: newName };
    },
    async setRemoteUrl(name, url) {
      calls.push(["setRemoteUrl", name, url]);
      return { updated: name };
    },
    async removeRemote(name) {
      calls.push(["removeRemote", name]);
    },
    async fetchRemote(name, prune) {
      calls.push(["fetchRemote", name, prune]);
      return { fetched: name };
    },
    async fetchRemoteBranch(remote, branch, local) {
      calls.push(["fetchRemoteBranch", remote, branch, local]);
      return { fetched: local === undefined ? branch : local };
    },
    async pullRemoteBranch(remote, branch) {
      calls.push(["pullRemoteBranch", remote, branch]);
      return { pulled: remote + "/" + branch };
    },
    async listRemotes() {
      calls.push(["listRemotes"]);
      return ["origin"];
    },
    async checkoutDetached(sha) {
      calls.push(["checkoutDetached", sha]);
    },
    async checkoutTracking(ref) {
      calls.push(["checkoutTracking", ref]);
    },
    async deleteTag(name) {
      calls.push(["deleteTag", name]);
    },
    async pushTag(remote, name) {
      calls.push(["pushTag", remote, name]);
    },
    async deleteRemoteBranch(remote, name) {
      calls.push(["deleteRemoteBranch", remote, name]);
    },
    async mergeBase(a, b) {
      calls.push(["mergeBase", a, b]);
      return "abc123";
    },
    async compareRefs(oldRev, newRev) {
      calls.push(["compareRefs", oldRev, newRev]);
      return [];
    },
    ...overrides,
  };
}

function req(id, method, args) {
  return { type: "git/request", id, method, args };
}

describe("handleGitRequest", () => {
  it("dispatches reads and returns data", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("1", "log", { limit: 5 }));
    assert.deepEqual(res, { type: "git/response", id: "1", ok: true, data: [{ hash: "abc" }] });
    assert.deepEqual(svc.calls, [
      [
        "log",
        5,
        {
          author: undefined,
          since: undefined,
          until: undefined,
          path: undefined,
          refs: undefined,
          globs: undefined,
          order: undefined,
        },
      ],
    ]);
  });

  it("dispatches log filters to the service", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("15", "log", { limit: 50, author: "Ada", since: "2024-01-01", path: "src/" }),
    );
    assert.equal(res.ok, true);
    assert.deepEqual(svc.calls, [
      [
        "log",
        50,
        {
          author: "Ada",
          since: "2024-01-01",
          until: undefined,
          path: "src/",
          refs: undefined,
          globs: undefined,
          order: undefined,
        },
      ],
    ]);
  });

  it("passes glob filters through to the log", async () => {
    const svc = stubService();
    await handleGitRequest(svc, req("17", "log", { limit: 20, globs: ["refs/heads/feature/*"] }));
    const filters = svc.calls[0][2];
    assert.deepEqual(filters.globs, ["refs/heads/feature/*"]);
  });

  it("passes ref filters through to the log", async () => {
    const svc = stubService();
    await handleGitRequest(
      svc,
      req("16", "log", { limit: 20, refs: ["main", "feature"], globs: undefined }),
    );
    assert.deepEqual(svc.calls, [
      [
        "log",
        20,
        {
          author: undefined,
          since: undefined,
          until: undefined,
          path: undefined,
          refs: ["main", "feature"],
          globs: undefined,
          order: undefined,
          order: undefined,
        },
      ],
    ]);
  });

  it("dispatches pullRemoteBranch", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("77", "pullRemoteBranch", { remote: "origin", branch: "feature" }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "77",
      ok: true,
      data: { pulled: "origin/feature" },
    });
    assert.deepEqual(svc.calls, [["pullRemoteBranch", "origin", "feature"]]);
  });

  it("dispatches fetchRemoteBranch", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("76", "fetchRemoteBranch", { remote: "origin", branch: "feature" }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "76",
      ok: true,
      data: { fetched: "feature" },
    });
    assert.deepEqual(svc.calls, [["fetchRemoteBranch", "origin", "feature", undefined]]);
  });

  it("dispatches fetchRemoteBranch with a local target", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("78", "fetchRemoteBranch", { remote: "origin", branch: "bar", local: "foo" }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "78",
      ok: true,
      data: { fetched: "foo" },
    });
    assert.deepEqual(svc.calls, [["fetchRemoteBranch", "origin", "bar", "foo"]]);
  });

  it("dispatches remote management", async () => {
    const svc = stubService();
    assert.deepEqual(await handleGitRequest(svc, req("70", "remoteDetails")), {
      type: "git/response",
      id: "70",
      ok: true,
      data: [{ name: "origin", fetchUrl: "u", pushUrl: "u" }],
    });
    assert.deepEqual(
      (await handleGitRequest(svc, req("71", "addRemote", { name: "up", url: "u2" }))).data,
      { added: "up" },
    );
    assert.deepEqual(
      (await handleGitRequest(svc, req("72", "renameRemote", { oldName: "up", newName: "up2" })))
        .data,
      { renamed: "up2" },
    );
    assert.deepEqual(
      (await handleGitRequest(svc, req("73", "setRemoteUrl", { name: "up", url: "u3" }))).data,
      { updated: "up" },
    );
    assert.deepEqual(await handleGitRequest(svc, req("74", "removeRemote", { name: "up" })), {
      type: "git/response",
      id: "74",
      ok: true,
      data: { ok: true },
    });
    assert.deepEqual(
      (await handleGitRequest(svc, req("75", "fetchRemote", { name: "up", prune: true }))).data,
      { fetched: "up" },
    );
    assert.deepEqual(svc.calls, [
      ["remoteDetails"],
      ["addRemote", "up", "u2"],
      ["renameRemote", "up", "up2"],
      ["setRemoteUrl", "up", "u3"],
      ["removeRemote", "up"],
      ["fetchRemote", "up", true],
    ]);
  });

  it("dispatches writes for checkout, pull, and push", async () => {
    const svc = stubService();
    assert.equal((await handleGitRequest(svc, req("2", "checkout", { ref: "main" }))).ok, true);
    assert.equal((await handleGitRequest(svc, req("3", "pull"))).ok, true);
    const push = await handleGitRequest(svc, req("4", "push", { force: true }));
    assert.equal(push.ok, true);
    assert.deepEqual(svc.calls, [["checkout", "main"], ["pull"], ["push", true]]);
  });

  it("dispatches fetch and fingerprint", async () => {
    const svc = stubService();
    const fetch = await handleGitRequest(svc, req("8", "fetch", { prune: true, pruneTags: true }));
    assert.deepEqual(fetch, { type: "git/response", id: "8", ok: true, data: { ok: true } });
    const fp = await handleGitRequest(svc, req("9", "fingerprint"));
    assert.deepEqual(fp, { type: "git/response", id: "9", ok: true, data: "fp" });
    assert.ok(svc.calls.some((c) => c[0] === "fetch" && c[1] === true && c[2] === true));
    assert.ok(svc.calls.some((c) => c[0] === "fingerprint"));
  });

  it("surfaces the force-push backup ref", async () => {
    const svc = stubService({
      async push() {
        return "refs/plegma-backup/main-123";
      },
    });
    const res = await handleGitRequest(svc, req("7", "push", { force: true }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "7",
      ok: true,
      data: { ok: true, backupRef: "refs/plegma-backup/main-123" },
    });
  });

  it("dispatches branch deletion", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("10", "deleteBranch", { name: "feature" }));
    assert.deepEqual(res, { type: "git/response", id: "10", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["deleteBranch", "feature", undefined]]);
  });

  it("dispatches forced branch deletion", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("41", "deleteBranch", { name: "x", force: true }));
    assert.deepEqual(res, { type: "git/response", id: "41", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["deleteBranch", "x", true]]);
  });

  it("forwards the notMerged flag on safe-delete refusals", async () => {
    const err = new Error("Branch 'x' is not fully merged.");
    err.notMerged = true;
    const svc = stubService({
      async deleteBranch() {
        throw err;
      },
    });
    const res = await handleGitRequest(svc, req("42", "deleteBranch", { name: "x" }));
    assert.equal(res.ok, false);
    assert.equal(res.notMerged, true);
    assert.match(res.error, /not fully merged/);
  });

  it("dispatches worktrees listing", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("11", "worktrees"));
    assert.deepEqual(res, { type: "git/response", id: "11", ok: true, data: [] });
    assert.deepEqual(svc.calls, [["worktrees"]]);
  });

  it("dispatches branch creation with the start point", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("12", "createBranch", { name: "feat/x", startPoint: "abc123" }),
    );
    assert.deepEqual(res, { type: "git/response", id: "12", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["createBranch", "feat/x", "abc123"]]);
  });

  it("dispatches tag creation on the target commit", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("13", "createTag", { name: "v1.0.0", target: "abc123" }),
    );
    assert.deepEqual(res, { type: "git/response", id: "13", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["createTag", "v1.0.0", "abc123"]]);
  });

  it("dispatches branch rename", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("14", "renameBranch", { oldName: "old", newName: "new" }),
    );
    assert.deepEqual(res, { type: "git/response", id: "14", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["renameBranch", "old", "new"]]);
  });

  it("dispatches branch merge with the backup ref", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("18", "mergeBranch", { name: "feature" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "18",
      ok: true,
      data: { merged: true, backupRef: "refs/plegma-backup/main-1" },
    });
    assert.deepEqual(svc.calls, [["mergeBranch", "feature"]]);
  });

  it("dispatches commit merge with the backup ref", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("60", "mergeCommit", { sha: "abc123" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "60",
      ok: true,
      data: { merged: true, backupRef: "refs/plegma-backup/main-4" },
    });
    assert.deepEqual(svc.calls, [["mergeCommit", "abc123"]]);
  });

  it("dispatches branch update with the check-back target", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("36", "updateBranch", { name: "feature" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "36",
      ok: true,
      data: { updated: "feature", backTo: "main", stashed: false },
    });
    assert.deepEqual(svc.calls, [["updateBranch", "feature"]]);
  });

  it("forwards the noUpstream flag on update preflight refusals", async () => {
    const err = new Error("Cannot update 'fresh': it has no upstream branch configured.");
    err.noUpstream = true;
    const svc = stubService({
      async updateBranch() {
        throw err;
      },
    });
    const res = await handleGitRequest(svc, req("43", "updateBranch", { name: "fresh" }));
    assert.equal(res.ok, false);
    assert.equal(res.noUpstream, true);
    assert.match(res.error, /no upstream/);
  });

  it("dispatches worktree discard with and without paths", async () => {
    const svc = stubService();
    const all = await handleGitRequest(svc, req("44", "discardWorktree", {}));
    assert.deepEqual(all, {
      type: "git/response",
      id: "44",
      ok: true,
      data: { discarded: true },
    });
    const some = await handleGitRequest(svc, req("45", "discardWorktree", { paths: ["a.js"] }));
    assert.equal(some.ok, true);
    assert.deepEqual(svc.calls, [
      ["discardWorktree", undefined],
      ["discardWorktree", ["a.js"]],
    ]);
  });

  it("dispatches fileDiff with the full spec", async () => {
    const svc = stubService();
    const spec = { sha: "abc123", parentSha: "p1", path: "a.js" };
    const res = await handleGitRequest(svc, req("37", "fileDiff", spec));
    assert.deepEqual(res, {
      type: "git/response",
      id: "37",
      ok: true,
      data: { text: "@@ -1 +1 @@\n", truncated: false },
    });
    assert.deepEqual(svc.calls, [["fileDiff", spec]]);
  });

  it("dispatches worktreeFileDiff with the path", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("38", "worktreeFileDiff", { path: "a.js" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "38",
      ok: true,
      data: { text: "@@ -0,0 +1 @@\n+x\n", truncated: false },
    });
    assert.deepEqual(svc.calls, [["worktreeFileDiff", "a.js"]]);
  });

  it("dispatches statusFiles and stashPush", async () => {
    const svc = stubService();
    const st = await handleGitRequest(svc, req("39", "statusFiles"));
    assert.deepEqual(st.data, [{ path: "a.js", status: "Modified" }]);
    const sp = await handleGitRequest(svc, req("40", "stashPush", { message: "wip" }));
    assert.deepEqual(sp.data, { stashed: true });
    assert.deepEqual(svc.calls, [
      ["statusFiles"],
      ["stashPush", "wip", { includeUntracked: undefined }],
    ]);
  });

  it("dispatches cherry-pick with the backup ref", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("22", "cherryPick", { sha: "abc123" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "22",
      ok: true,
      data: { picked: true, backupRef: "refs/plegma-backup/main-2" },
    });
    assert.deepEqual(svc.calls, [["cherryPick", "abc123", { autostash: false }]]);
  });

  it("forwards autostash to the history verbs and serves commitContext", async () => {
    const seen = [];
    const record = (name) =>
      async function (...args) {
        seen.push([name, ...args]);
        return {};
      };
    const svc = stubService({
      rebaseOnto: record("rebaseOnto"),
      mergeBranch: record("mergeBranch"),
      mergeCommit: record("mergeCommit"),
      cherryPick: record("cherryPick"),
      revertCommit: record("revertCommit"),
      resetTo: record("resetTo"),
    });
    const on = { autostash: true };
    await handleGitRequest(svc, req("a1", "rebase", { upstream: "main", autostash: true }));
    await handleGitRequest(svc, req("a2", "mergeBranch", { name: "f", autostash: true }));
    await handleGitRequest(svc, req("a3", "mergeCommit", { sha: "abc", autostash: true }));
    await handleGitRequest(svc, req("a4", "cherryPick", { sha: "abc", autostash: true }));
    await handleGitRequest(svc, req("a5", "revertCommit", { sha: "abc", autostash: true }));
    await handleGitRequest(svc, req("a6", "resetTo", { sha: "abc", mode: "hard", autostash: 1 }));
    assert.deepEqual(seen, [
      ["rebaseOnto", "main", on],
      ["mergeBranch", "f", on],
      ["mergeCommit", "abc", on],
      ["cherryPick", "abc", on],
      ["revertCommit", "abc", on],
      ["resetTo", "abc", "hard", on],
    ]);
    const res = await handleGitRequest(svc, req("a7", "commitContext", { shas: ["abc"] }));
    assert.deepEqual(res.data, { head: "h", commits: {} });
    assert.deepEqual(svc.calls, [["commitContext", ["abc"]]]);
  });

  it("dispatches reset with mode and backup ref", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("23", "resetTo", { sha: "abc123", mode: "hard" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "23",
      ok: true,
      data: { reset: true, backupRef: "refs/plegma-backup/main-3" },
    });
    assert.deepEqual(svc.calls, [["resetTo", "abc123", "hard"]]);
  });

  it("dispatches commit revert", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("24", "revertCommit", { sha: "abc123" }));
    assert.deepEqual(res, {
      type: "git/response",
      id: "24",
      ok: true,
      data: { reverted: true },
    });
    assert.deepEqual(svc.calls, [["revertCommit", "abc123"]]);
  });

  it("dispatches merge continue, abort, and status", async () => {
    const svc = stubService();
    assert.deepEqual(await handleGitRequest(svc, req("19", "mergeContinue")), {
      type: "git/response",
      id: "19",
      ok: true,
      data: { continued: true },
    });
    assert.deepEqual(await handleGitRequest(svc, req("20", "mergeAbort")), {
      type: "git/response",
      id: "20",
      ok: true,
      data: { aborted: true },
    });
    assert.deepEqual(await handleGitRequest(svc, req("21", "mergeStatus")), {
      type: "git/response",
      id: "21",
      ok: true,
      data: { inProgress: false, conflictedFiles: [] },
    });
    assert.deepEqual(svc.calls, [["mergeContinue"], ["mergeAbort"], ["mergeStatus"]]);
  });

  it("dispatches file revert and rejects binary content", async () => {
    const svc = stubService();
    const spec = { sha: "abc", path: "a.js", status: "Modified" };
    const res = await handleGitRequest(svc, req("16", "revertFile", spec));
    assert.deepEqual(res, { type: "git/response", id: "16", ok: true, data: { ok: true } });
    assert.deepEqual(svc.calls, [["revertFile", spec]]);
    const bin = stubService({
      async revertFileToRevision() {
        return { binary: true };
      },
    });
    const resBin = await handleGitRequest(bin, req("17", "revertFile", spec));
    assert.equal(resBin.ok, false);
    assert.match(resBin.error, /Binary file/);
  });

  it("dispatches probe, branches, tags, and files reads", async () => {
    const svc = stubService();
    assert.deepEqual(await handleGitRequest(svc, req("25", "probe")), {
      type: "git/response",
      id: "25",
      ok: true,
      data: { vscodeGitAvailable: false },
    });
    assert.deepEqual(await handleGitRequest(svc, req("26", "branches")), {
      type: "git/response",
      id: "26",
      ok: true,
      data: [],
    });
    assert.deepEqual(await handleGitRequest(svc, req("27", "tags")), {
      type: "git/response",
      id: "27",
      ok: true,
      data: [],
    });
    assert.deepEqual(await handleGitRequest(svc, req("28", "files", { sha: "abc" })), {
      type: "git/response",
      id: "28",
      ok: true,
      data: [],
    });
    assert.deepEqual(svc.calls, [["probe"], ["branches"], ["tags"], ["files", "abc"]]);
  });

  it("dispatches rewrite and the rebase family", async () => {
    const svc = stubService();
    const spec = { drop: ["abc"] };
    assert.deepEqual(await handleGitRequest(svc, req("29", "rewrite", spec)), {
      type: "git/response",
      id: "29",
      ok: true,
      data: { rewritten: true, backupRef: "refs/plegma-backup/b-1" },
    });
    assert.deepEqual(await handleGitRequest(svc, req("30", "rebase", { upstream: "main" })), {
      type: "git/response",
      id: "30",
      ok: true,
      data: { rebased: true, backupRef: "refs/plegma-backup/b-2" },
    });
    assert.deepEqual(await handleGitRequest(svc, req("31", "rebaseContinue")), {
      type: "git/response",
      id: "31",
      ok: true,
      data: { continued: true },
    });
    assert.deepEqual(await handleGitRequest(svc, req("32", "rebaseSkip")), {
      type: "git/response",
      id: "32",
      ok: true,
      data: { skipped: true },
    });
    assert.deepEqual(await handleGitRequest(svc, req("33", "rebaseAbort")), {
      type: "git/response",
      id: "33",
      ok: true,
      data: { aborted: true },
    });
    assert.deepEqual(await handleGitRequest(svc, req("34", "rebaseStatus")), {
      type: "git/response",
      id: "34",
      ok: true,
      data: { inProgress: false, conflictedFiles: [] },
    });
    assert.deepEqual(svc.calls, [
      ["rewrite", spec],
      ["rebase", "main"],
      ["rebaseContinue"],
      ["rebaseSkip"],
      ["rebaseAbort"],
      ["rebaseStatus"],
    ]);
  });

  it("forwards rebase conflicts with the file list", async () => {
    const err = new Error("stopped");
    err.conflict = true;
    err.conflictedFiles = ["f.txt"];
    const svc = stubService({
      async rebaseOnto() {
        throw err;
      },
    });
    const res = await handleGitRequest(svc, req("35", "rebase", { upstream: "main" }));
    assert.equal(res.ok, false);
    assert.equal(res.conflict, true);
    assert.deepEqual(res.conflictedFiles, ["f.txt"]);
  });

  it("dispatches detached checkout, tracking checkout, and tag deletion", async () => {
    const svc = stubService();
    assert.deepEqual(await handleGitRequest(svc, req("46", "checkoutDetached", { sha: "abc" })), {
      type: "git/response",
      id: "46",
      ok: true,
      data: { ok: true },
    });
    assert.deepEqual(
      await handleGitRequest(svc, req("47", "checkoutTracking", { ref: "origin/x" })),
      { type: "git/response", id: "47", ok: true, data: { ok: true } },
    );
    assert.deepEqual(await handleGitRequest(svc, req("48", "deleteTag", { name: "v1" })), {
      type: "git/response",
      id: "48",
      ok: true,
      data: { ok: true },
    });
    assert.deepEqual(
      await handleGitRequest(svc, req("49", "deleteRemoteBranch", { remote: "origin", name: "x" })),
      { type: "git/response", id: "49", ok: true, data: { ok: true } },
    );
    assert.deepEqual(svc.calls, [
      ["checkoutDetached", "abc"],
      ["checkoutTracking", "origin/x"],
      ["deleteTag", "v1"],
      ["deleteRemoteBranch", "origin", "x"],
    ]);
  });

  it("dispatches mergeBase and compareRefs", async () => {
    const svc = stubService();
    assert.deepEqual(await handleGitRequest(svc, req("50", "mergeBase", { a: "h", b: "u" })), {
      type: "git/response",
      id: "50",
      ok: true,
      data: { sha: "abc123" },
    });
    assert.deepEqual(
      await handleGitRequest(svc, req("51", "compareRefs", { oldRev: "o", newRev: "n" })),
      { type: "git/response", id: "51", ok: true, data: [] },
    );
    assert.deepEqual(svc.calls, [
      ["mergeBase", "h", "u"],
      ["compareRefs", "o", "n"],
    ]);
  });

  it("dispatches stashList", async () => {
    const svc = stubService();
    const res = await handleGitRequest(svc, req("52", "stashList"));
    assert.deepEqual(res, { type: "git/response", id: "52", ok: true, data: [] });
    assert.deepEqual(svc.calls, [["stashList"]]);
  });

  it("dispatches stash mutations", async () => {
    const svc = stubService();
    for (const [id, method, args] of [
      ["53", "stashApply", { name: "stash@{0}" }],
      ["54", "stashPop", { name: "stash@{0}" }],
      ["55", "stashDrop", { name: "stash@{0}" }],
      ["56", "stashBranch", { branchName: "wip", stashName: "stash@{0}" }],
    ]) {
      const res = await handleGitRequest(svc, req(id, method, args));
      assert.deepEqual(res, { type: "git/response", id, ok: true, data: { ok: true } });
    }
    assert.deepEqual(svc.calls, [
      ["stashApply", "stash@{0}"],
      ["stashPop", "stash@{0}"],
      ["stashDrop", "stash@{0}"],
      ["stashBranch", "wip", "stash@{0}"],
    ]);
  });

  it("dispatches pushBranch and listRemotes", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("57", "pushBranch", { name: "feature", remote: "origin", setUpstream: false }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "57",
      ok: true,
      data: { pushed: "feature" },
    });
    const remotes = await handleGitRequest(svc, req("58", "listRemotes"));
    assert.deepEqual(remotes, {
      type: "git/response",
      id: "58",
      ok: true,
      data: ["origin"],
    });
    assert.deepEqual(svc.calls, [
      ["pushBranch", "feature", { remote: "origin", setUpstream: false, force: undefined }],
      ["listRemotes"],
    ]);
  });

  it("dispatches pushTag", async () => {
    const svc = stubService();
    const res = await handleGitRequest(
      svc,
      req("59", "pushTag", { remote: "origin", name: "v1.0.0" }),
    );
    assert.deepEqual(res, {
      type: "git/response",
      id: "59",
      ok: true,
      data: { ok: true },
    });
    assert.deepEqual(svc.calls, [["pushTag", "origin", "v1.0.0"]]);
  });

  it("rejects unknown methods with ok:false", async () => {
    const res = await handleGitRequest(stubService(), req("5", "bogus"));
    assert.equal(res.ok, false);
    assert.match(res.error, /Unknown git method/);
  });

  it("turns service errors into ok:false responses", async () => {
    const svc = stubService({
      async listCommits() {
        throw new Error("no repo");
      },
    });
    const res = await handleGitRequest(svc, req("6", "log"));
    assert.deepEqual(res, { type: "git/response", id: "6", ok: false, error: "no repo" });
  });

  it("ignores non-git messages", async () => {
    assert.equal(await handleGitRequest(stubService(), { type: "ping" }), null);
    assert.equal(await handleGitRequest(stubService(), null), null);
  });
});
