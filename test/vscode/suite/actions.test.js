// Runs inside the real VS Code Extension Host against a real git repo.
// Unlike the stub-based unit tests, every case here performs the action
// with actual git and asserts on the resulting repository state.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { CliGitService } = require("../../../src/git/cliGit");

const ex = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await ex("git", args, { cwd });
  return stdout.trim();
}

async function buildRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-actions-"));
  const g = (...args) => git(dir, ...args);
  await g("init", "-b", "main", "--quiet");
  await g("config", "user.email", "t@t");
  await g("config", "user.name", "t");
  await g("config", "commit.gpgsign", "false");
  await fs.writeFile(path.join(dir, "app.js"), "console.log(1);\n");
  await g("add", "app.js");
  await g("commit", "-m", "feat: initial app", "--quiet");
  await g("checkout", "-b", "feature", "--quiet");
  await fs.writeFile(path.join(dir, "app.js"), "console.log(2);\n");
  await g("commit", "-am", "feat: feature tweak", "--quiet");
  await g("checkout", "main", "--quiet");
  return dir;
}

describe("plegma actions against a real repo", () => {
  let dir;
  let svc;

  before(async () => {
    dir = await buildRepo();
    svc = new CliGitService(dir);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function cleanupBranches(...names) {
    const current = await git(dir, "branch", "--show-current");
    if (names.includes(current)) {
      await git(dir, "checkout", "main", "--quiet");
    }
    for (const n of names) {
      try {
        await git(dir, "branch", "-D", n);
      } catch {
        // Already gone.
      }
    }
  }

  it("statusFiles sees dirty files and stashPush round-trips them", async () => {
    await fs.writeFile(path.join(dir, "app.js"), "console.log(9);\n");
    await fs.writeFile(path.join(dir, "new.txt"), "untracked\n");
    const before = await svc.statusFiles();
    assert.ok(
      before.some((f) => f.path === "app.js" && f.status === "Modified"),
      "modified file listed",
    );
    assert.ok(
      before.some((f) => f.path === "new.txt" && f.status === "Untracked"),
      "untracked file listed",
    );
    assert.deepEqual(await svc.stashPush("plegma: e2e"), { stashed: true });
    assert.deepEqual(await svc.statusFiles(), [], "tree clean after stash");
    assert.ok((await git(dir, "stash", "list")).length > 0, "stash entry created");
    await git(dir, "stash", "pop", "--quiet");
    const after = await svc.statusFiles();
    assert.equal(after.length, 2, "changes restored by pop");
    await git(dir, "checkout", "--", "app.js");
    await fs.rm(path.join(dir, "new.txt"));
    assert.deepEqual(await svc.statusFiles(), [], "tree clean again");
  });

  it("creates, checks out, renames, and deletes a branch", async () => {
    await svc.createBranch("tmp-e2e", "HEAD");
    assert.ok((await git(dir, "branch", "--list", "tmp-e2e")).length > 0, "branch created");
    await svc.checkout("tmp-e2e");
    assert.equal(await git(dir, "branch", "--show-current"), "tmp-e2e", "checked out");
    await svc.renameBranch("tmp-e2e", "tmp-e2e2");
    assert.equal(await git(dir, "branch", "--show-current"), "tmp-e2e2", "renamed");
    await svc.checkout("main");
    await svc.deleteBranch("tmp-e2e2");
    assert.equal(await git(dir, "branch", "--list", "tmp-e2e2"), "", "deleted");
  });

  it("safe delete refuses unmerged branches but force deletes them", async () => {
    await svc.createBranch("tmp-unmerged", "main");
    await svc.checkout("tmp-unmerged");
    await fs.writeFile(path.join(dir, "app.js"), "console.log(99);\n");
    await git(dir, "commit", "-am", "feat: divergent", "--quiet");
    await svc.checkout("main");
    try {
      await svc.deleteBranch("tmp-unmerged");
      assert.fail("safe delete should refuse");
    } catch (e) {
      assert.equal(e.notMerged, true, "refusal carries the notMerged flag");
      assert.match(e.message, /not fully merged/);
    }
    assert.ok(
      (await git(dir, "branch", "--list", "tmp-unmerged")).length > 0,
      "branch survives the refused delete",
    );
    await svc.deleteBranch("tmp-unmerged", true);
    assert.equal(await git(dir, "branch", "--list", "tmp-unmerged"), "", "force-deleted");
  });

  it("cherry-picks a feature commit onto a temp branch", async () => {
    const tweak = await git(dir, "rev-parse", "feature");
    await svc.createBranch("tmp-pick", "main");
    await svc.checkout("tmp-pick");
    try {
      const res = await svc.cherryPick(tweak);
      assert.ok(res && res.backupRef, "backup ref recorded");
      const log = await git(dir, "log", "--format=%s", "main..tmp-pick");
      assert.ok(log.includes("feat: feature tweak"), "tweak landed on tmp-pick");
    } finally {
      await cleanupBranches("tmp-pick");
    }
  });

  it("reverts a commit into a new undo commit", async () => {
    await svc.createBranch("tmp-revert", "main");
    await svc.checkout("tmp-revert");
    try {
      await fs.writeFile(path.join(dir, "app.js"), "console.log(3);\n");
      await git(dir, "commit", "-am", "feat: to revert", "--quiet");
      const bad = await git(dir, "rev-parse", "HEAD");
      await svc.revertCommit(bad);
      const subjects = await git(dir, "log", "--format=%s", "main..tmp-revert");
      assert.ok(subjects.includes('Revert "feat: to revert"'), "revert commit created");
      assert.equal(await fs.readFile(path.join(dir, "app.js"), "utf8"), "console.log(1);\n");
    } finally {
      await cleanupBranches("tmp-revert");
    }
  });

  it("resets softly and keeps working-copy changes", async () => {
    await svc.createBranch("tmp-reset", "main");
    await svc.checkout("tmp-reset");
    try {
      await fs.writeFile(path.join(dir, "app.js"), "console.log(4);\n");
      await git(dir, "commit", "-am", "feat: to reset", "--quiet");
      const base = await git(dir, "rev-parse", "main");
      const res = await svc.resetTo(base, "soft");
      assert.ok(res && res.backupRef, "backup ref recorded");
      assert.equal(await git(dir, "rev-parse", "HEAD"), base, "HEAD moved back");
      const st = await git(dir, "status", "--porcelain");
      assert.ok(st.startsWith("M") && st.includes("app.js"), "change kept staged");
    } finally {
      await git(dir, "reset", "--quiet");
      await git(dir, "checkout", "--", "app.js");
      await cleanupBranches("tmp-reset");
    }
  });

  it("merges a branch and records a backup", async () => {
    await svc.createBranch("tmp-merge", "main");
    await svc.checkout("tmp-merge");
    try {
      // Diverge first: merging a direct descendant would fast-forward,
      // which is correct git behavior but not a merge commit.
      await fs.writeFile(path.join(dir, "tmp.txt"), "tmp\n");
      await git(dir, "add", "tmp.txt");
      await git(dir, "commit", "-m", "feat: tmp side change", "--quiet");
      const res = await svc.mergeBranch("feature");
      assert.ok(res && res.merged, "merge reported");
      assert.ok(res.backupRef, "backup ref recorded");
      const parents = await git(dir, "rev-list", "--parents", "-n", "1", "HEAD");
      assert.equal(parents.split(" ").length, 3, "merge commit has two parents");
    } finally {
      await cleanupBranches("tmp-merge");
    }
  });

  it("reads real diff text for commits and the worktree", async () => {
    const tweak = await git(dir, "rev-parse", "feature");
    const parent = (await git(dir, "rev-parse", `${tweak}^`)).trim();
    const d = await svc.fileDiff({ sha: tweak, parentSha: parent, path: "app.js" });
    assert.ok(d.text.includes("diff --git"), "unified diff returned");
    assert.equal(d.truncated, false);
    await fs.writeFile(path.join(dir, "app.js"), "console.log(5);\n");
    try {
      const w = await svc.worktreeFileDiff("app.js");
      assert.ok(w.text.includes("+console.log(5);"), "worktree diff returned");
    } finally {
      await git(dir, "checkout", "--", "app.js");
    }
  });

  it("updates a branch from its remote with a dirty tree stashed", async () => {
    // The bare remote lives outside the fixture repo: updateBranch stashes
    // untracked files too, and a nested origin.git would be stashed away
    // mid-flow, breaking the pull.
    const originDir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-origin-"));
    const origin = path.join(originDir, "origin.git");
    await git(dir, "init", "--bare", "--quiet", origin);
    try {
      await git(dir, "remote", "add", "e2e-origin", origin);
      await git(dir, "push", "--quiet", "e2e-origin", "main", "feature");
      await git(dir, "branch", "--set-upstream-to=e2e-origin/feature", "feature");
      // Advance the remote: clone, commit on feature, push.
      const clone = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-remote-"));
      try {
        await git(clone, "clone", "--quiet", origin, ".");
        await git(clone, "config", "user.email", "t@t");
        await git(clone, "config", "user.name", "t");
        await git(clone, "checkout", "--quiet", "feature");
        await fs.writeFile(path.join(clone, "app.js"), "console.log(9);\n");
        await git(clone, "commit", "-am", "feat: remote ahead", "--quiet");
        await git(clone, "push", "--quiet", "origin", "feature");
        const remoteTip = await git(clone, "rev-parse", "feature");
        // Dirty the fixture tree, then update from the checked-out main.
        await fs.writeFile(path.join(dir, "app.js"), "console.log(8);\n");
        const res = await svc.updateBranch("feature");
        assert.equal(res.updated, "feature");
        assert.equal(res.backTo, "main", "returned to main");
        assert.equal(res.stashed, true, "dirty tree was stashed");
        assert.equal(await git(dir, "rev-parse", "feature"), remoteTip, "feature fast-forwarded");
        assert.equal(await git(dir, "branch", "--show-current"), "main");
        assert.ok(
          (await git(dir, "status", "--porcelain")).includes("app.js"),
          "dirty change restored",
        );
      } finally {
        await git(dir, "checkout", "--", "app.js").catch(() => undefined);
        await fs.rm(clone, { recursive: true, force: true });
      }
    } finally {
      await git(dir, "remote", "remove", "e2e-origin").catch(() => undefined);
      await fs.rm(originDir, { recursive: true, force: true });
    }
  });
});
