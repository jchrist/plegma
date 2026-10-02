import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  runGit,
  CliGitService,
  createBackupRef,
  normalizeRefs,
  normalizeGlobs,
} from "../src/git/cliGit.js";

function stubRun(responses = {}) {
  const calls = [];
  const run = async (root, args) => {
    calls.push([root, args]);
    const key = args.join(" ");
    if (key in responses) {
      const v = responses[key];
      if (v instanceof Error) {
        throw v;
      }
      return v;
    }
    return "";
  };
  return { calls, run };
}

describe("createBackupRef", () => {
  it("points a timestamped backup ref at HEAD", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "abc123\n",
    });
    const ref = await createBackupRef(run, "/repo");
    assert.match(ref, /^refs\/plegma-backup\/main-\d+$/);
    assert.deepEqual(calls[2], ["/repo", ["update-ref", ref, "abc123"]]);
  });

  it("sanitizes odd branch names", async () => {
    const { run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "feat/x y\n",
      "rev-parse HEAD": "abc\n",
    });
    const ref = await createBackupRef(run, "/repo");
    assert.match(ref, /^refs\/plegma-backup\/feat-x-y-\d+$/);
  });
});

describe("CliGitService log filters", () => {
  it("passes author, date, and path filters to git log", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(50, {
      author: "Ada",
      since: "2024-01-01",
      until: "2024-02-01",
      path: "src/",
    });
    assert.deepEqual(calls, [
      [
        "/repo",
        [
          "log",
          `--format=\x1e%H\x1f%P\x1f%aN\x1f%aE\x1f%at\x1f%s\x1f%b\x1f%D\x1f%G?\x1f%GS\x1f`,
          "--numstat",
          "--decorate=full",
          "--exclude=refs/stash",
          "--exclude=refs/plegma-backup/*",
          "--all",
          "--topo-order",
          "--author=Ada",
          "--since=2024-01-01",
          "--until=2024-02-01",
          "-n",
          "50",
          "--",
          "src/",
        ],
      ],
    ]);
  });

  it("omits blank filters", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(500, { author: "  ", since: "", until: "", path: "" });
    const args = calls[0][1];
    assert.ok(!args.some((a) => a.startsWith("--author")));
    assert.ok(!args.some((a) => a.startsWith("--since")));
    assert.ok(!args.some((a) => a.startsWith("--until")));
    assert.ok(!args.includes("--"));
  });

  it("excludes stash and backup refs before --all", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(10, {});
    const args = calls[0][1];
    const excludeStash = args.indexOf("--exclude=refs/stash");
    const excludeBackup = args.indexOf("--exclude=refs/plegma-backup/*");
    const all = args.indexOf("--all");
    assert.ok(excludeStash !== -1, "stash excluded");
    assert.ok(excludeBackup !== -1, "backup refs excluded");
    assert.ok(excludeStash < all && excludeBackup < all, "--exclude precedes --all");
  });
  it("adds a gravatar hash and initials per commit", async () => {
    const SEP = "\x1f";
    const REC = "\x1e";
    const row = (...f) => f.join(SEP) + SEP;
    const log =
      REC +
      row("abc123", "", "Ada Lovelace", "Ada@Example.dev", "1700000000", "s", "", "") +
      "\n2\t1\tsrc/app.js\n" +
      REC +
      row("def456", "", "Prince", "", "1700000001", "s", "", "");
    const key = `log --format=${REC}%H${SEP}%P${SEP}%aN${SEP}%aE${SEP}%at${SEP}%s${SEP}%b${SEP}%D${SEP}%G?${SEP}%GS${SEP} --numstat --decorate=full --exclude=refs/stash --exclude=refs/plegma-backup/* --all --topo-order -n 5`;
    const { run } = stubRun({ [key]: log });
    const svc = new CliGitService("/repo", run);
    const commits = await svc.listCommits(5, {});
    assert.equal(commits.length, 2);
    // md5("ada@example.dev")
    assert.equal(commits[0].avatar.hash, "d32012035024ea2960e38acb9a874825");
    assert.equal(commits[0].avatar.initials, "AL");
    assert.equal(
      commits[0].avatar.url,
      "https://www.gravatar.com/avatar/d32012035024ea2960e38acb9a874825?d=404",
    );
    // The hover card's file summary rides the same call.
    assert.deepEqual(
      [commits[0].filesChanged, commits[0].additions, commits[0].deletions],
      [1, 2, 1],
    );
    assert.equal(commits[1].filesChanged, 0, "a commit with no diff reports no files");
    // No email: nothing to fetch, but initials still render.
    assert.equal(commits[1].avatar.hash, "");
    assert.equal(commits[1].avatar.url, "");
    assert.equal(commits[1].avatar.initials, "PR");
  });
});

describe("CliGitService updateBranch", () => {
  it("updates via checkout, pull, and check back", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name feature@{upstream}": "origin/feature\n",
      "status --porcelain": "",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "checkout feature": "",
      "pull --ff-only": "",
      "checkout main": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.updateBranch("feature"), {
      updated: "feature",
      backTo: "main",
      stashed: false,
    });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      [
        "rev-parse --abbrev-ref --symbolic-full-name feature@{upstream}",
        "status --porcelain",
        "rev-parse --abbrev-ref HEAD",
        "checkout feature",
        "pull --ff-only",
        "checkout main",
      ],
    );
  });

  it("skips the check-back when already on the branch", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      "status --porcelain": "",
      "rev-parse --abbrev-ref HEAD": "main\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.updateBranch("main"), { updated: "main", stashed: false });
    const checkouts = calls.filter(([, args]) => args.join(" ") === "checkout main");
    assert.equal(checkouts.length, 1, "only the initial checkout runs, no check-back");
  });

  it("stashes a dirty tree, updates, and pops the stash", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name feature@{upstream}": "origin/feature\n",
      "status --porcelain": " M dirty.js\n",
      "stash push -u -m plegma: update feature": "",
      "rev-parse --verify refs/stash": "stashsha123\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "checkout feature": "",
      "pull --ff-only": "",
      "checkout main": "",
      "stash pop": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.updateBranch("feature"), {
      updated: "feature",
      backTo: "main",
      stashed: true,
    });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      [
        "rev-parse --abbrev-ref --symbolic-full-name feature@{upstream}",
        "status --porcelain",
        "stash push -u -m plegma: update feature",
        "rev-parse --verify refs/stash",
        "rev-parse --abbrev-ref HEAD",
        "checkout feature",
        "pull --ff-only",
        "checkout main",
        "stash pop",
      ],
    );
  });

  it("names the stash and recovery when the pop conflicts", async () => {
    const { run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name feature@{upstream}": "origin/feature\n",
      "status --porcelain": " M dirty.js\n",
      "stash push -u -m plegma: update feature": "",
      "rev-parse --verify refs/stash": "abcdef123456\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "checkout feature": "",
      "pull --ff-only": "",
      "checkout main": "",
      "stash pop": new Error("CONFLICT (content): Merge conflict"),
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(
      svc.updateBranch("feature"),
      /Updated feature, but could not restore.*safe in stash abcdef1.*git stash pop/,
    );
  });

  it("restores the stash and reports the branch when a step fails", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      "status --porcelain": " M dirty.js\n",
      "stash push -u -m plegma: update main": "",
      "rev-parse --verify refs/stash": "abc\n",
      "rev-parse --abbrev-ref HEAD": "feature\n",
      "checkout main": new Error("checkout exploded"),
      "stash pop": "",
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(
      svc.updateBranch("main"),
      /Update main failed.*You are on 'feature'.*stashed changes were restored/,
    );
    assert.ok(
      calls.some(([, args]) => args.join(" ") === "stash pop"),
      "stash restored",
    );
  });

  it("names the stash when a step fails and the restore fails too", async () => {
    const { run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      "status --porcelain": " M dirty.js\n",
      "stash push -u -m plegma: update main": "",
      "rev-parse --verify refs/stash": "abcdef123456\n",
      "rev-parse --abbrev-ref HEAD": "feature\n",
      "checkout main": new Error("checkout exploded"),
      "stash pop": new Error("CONFLICT (content)"),
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(
      svc.updateBranch("main"),
      /You are on 'feature'.*safe in stash abcdef1.*git stash pop/,
    );
  });

  it("fails before switching when the stash itself cannot be created", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      "status --porcelain": " M dirty.js\n",
      "stash push -u -m plegma: update main": new Error("cannot stash: no identity"),
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(svc.updateBranch("main"), /before switching.*No branches were switched/);
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      [
        "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}",
        "status --porcelain",
        "stash push -u -m plegma: update main",
      ],
    );
  });

  it("reports the current branch when a step fails on a clean tree", async () => {
    const { run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      "status --porcelain": "",
      "rev-parse --abbrev-ref HEAD": "feature\n",
      "checkout main": new Error("checkout exploded"),
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(svc.updateBranch("main"), /Update main failed.*You are on 'feature'/);
  });

  it("refuses suspicious names and missing repos", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.updateBranch("--evil"), /suspicious/);
    await assert.rejects(
      new CliGitService(undefined, stubRun().run).updateBranch("x"),
      /No git repository/,
    );
  });

  it("fails fast with no side effects when the branch has no upstream", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name fresh@{upstream}": new Error(
        "fatal: no upstream configured for branch 'fresh'",
      ),
      remote: "origin\n",
    });
    const svc = new CliGitService("/repo", run);
    const err = await svc.updateBranch("fresh").then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "update rejects");
    assert.match(err.message, /no upstream branch configured.*nothing to pull/);
    assert.equal(err.noUpstream, true);
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      ["rev-parse --abbrev-ref --symbolic-full-name fresh@{upstream}", "remote"],
      "no stash, checkout, or pull runs",
    );
  });

  it("fails fast when the repo has no remotes at all", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref --symbolic-full-name fresh@{upstream}": new Error(
        "fatal: no upstream configured for branch 'fresh'",
      ),
      remote: "\n",
    });
    const svc = new CliGitService("/repo", run);
    const err = await svc.updateBranch("fresh").then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "update rejects");
    assert.match(err.message, /no git remotes are configured.*nothing to pull/);
    assert.equal(err.noUpstream, true);
    assert.ok(
      !calls.some(([, args]) => args[0] === "checkout" || args[0] === "stash"),
      "no checkout or stash runs",
    );
  });
});

describe("CliGitService discardWorktree", () => {
  it("drops every uncommitted change via reset and clean", async () => {
    const { calls, run } = stubRun({
      "reset --hard HEAD": "",
      "clean -fd": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.discardWorktree(), { discarded: true });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      ["reset --hard HEAD", "clean -fd"],
    );
  });

  it("drops listed paths via restore and clean", async () => {
    const { calls, run } = stubRun({
      "ls-files -- a.js b.js": "a.js\n",
      "restore --source=HEAD --staged --worktree -- a.js": "",
      "clean -f -- a.js b.js": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.discardWorktree(["a.js", "b.js"]), {
      discarded: ["a.js", "b.js"],
    });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      [
        "ls-files -- a.js b.js",
        "restore --source=HEAD --staged --worktree -- a.js",
        "clean -f -- a.js b.js",
      ],
    );
  });

  it("skips restore when every path is untracked", async () => {
    const { calls, run } = stubRun({
      "ls-files -- new.js": "",
      "clean -f -- new.js": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.discardWorktree(["new.js"]), { discarded: ["new.js"] });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      ["ls-files -- new.js", "clean -f -- new.js"],
    );
  });

  it("refuses suspicious paths and empty lists", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.discardWorktree(["-evil"]), /suspicious/);
    await assert.rejects(svc.discardWorktree(["a/../b"]), /suspicious/);
    await assert.rejects(svc.discardWorktree([]), /at least one path/);
    await assert.rejects(
      new CliGitService(undefined, stubRun().run).discardWorktree(),
      /No git repository/,
    );
  });
});

describe("CliGitService fileDiff", () => {
  it("diffs a file between parent and commit", async () => {
    const { calls, run } = stubRun({
      "diff --no-color --no-ext-diff -M p1 abc123 -- a.js": "@@ -1 +1 @@\n-old\n+new\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.fileDiff({ sha: "abc123", parentSha: "p1", path: "a.js" }), {
      text: "@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
    });
    assert.deepEqual(calls, [
      ["/repo", ["diff", "--no-color", "--no-ext-diff", "-M", "p1", "abc123", "--", "a.js"]],
    ]);
  });

  it("diffs root commits against the empty tree", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.fileDiff({ sha: "abc123", parentSha: null, path: "a.js" });
    assert.ok(
      calls[0][1].includes("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
      "empty-tree hash used as parent",
    );
  });

  it("flags binary diffs", async () => {
    const { run } = stubRun({
      "diff --no-color --no-ext-diff -M p1 abc123 -- img.png": "diff\0binary",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.fileDiff({ sha: "abc123", parentSha: "p1", path: "img.png" }), {
      binary: true,
    });
  });

  it("truncates very long diffs", async () => {
    const big = Array.from({ length: 3005 }, (_, i) => `+line${i}`).join("\n");
    const { run } = stubRun({
      "diff --no-color --no-ext-diff -M p1 abc123 -- big.js": big,
    });
    const svc = new CliGitService("/repo", run);
    const res = await svc.fileDiff({ sha: "abc123", parentSha: "p1", path: "big.js" });
    assert.equal(res.truncated, true);
    assert.ok(res.text.split("\n").length < 3005);
    assert.match(res.text, /truncated/);
  });

  it("rejects missing specs and suspicious paths", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.fileDiff({ sha: "abc123" }), /needs \{ sha, path \}/);
    await assert.rejects(svc.fileDiff({ sha: "abc123", path: "-x" }), /suspicious path/);
    await assert.rejects(svc.fileDiff({ sha: "abc123", path: "../x" }), /suspicious path/);
    await assert.rejects(svc.fileDiff({ sha: "-x", path: "a.js" }), /suspicious ref/);
    await assert.rejects(
      new CliGitService(undefined, stubRun().run).fileDiff({ sha: "a", path: "b" }),
      /No git repository/,
    );
  });
});

describe("CliGitService worktreeFileDiff", () => {
  it("diffs a modified file against HEAD", async () => {
    const { calls, run } = stubRun({
      "diff --no-color --no-ext-diff -M HEAD -- a.js": "@@ -1 +1 @@\n-old\n+new\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.worktreeFileDiff("a.js"), {
      text: "@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
    });
    assert.deepEqual(calls, [
      ["/repo", ["diff", "--no-color", "--no-ext-diff", "-M", "HEAD", "--", "a.js"]],
    ]);
  });

  it("returns empty text for unchanged tracked files", async () => {
    const { run } = stubRun({
      "diff --no-color --no-ext-diff -M HEAD -- a.js": "",
      "status --porcelain -- a.js": " M a.js\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.worktreeFileDiff("a.js"), { text: "" });
  });

  it("synthesizes all-added diffs for untracked files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    try {
      await fs.writeFile(path.join(dir, "new.txt"), "hello\nworld\n");
      const { run } = stubRun({
        "diff --no-color --no-ext-diff -M HEAD -- new.txt": "",
        "status --porcelain -- new.txt": "?? new.txt\n",
      });
      const svc = new CliGitService(dir, run);
      const res = await svc.worktreeFileDiff("new.txt");
      assert.equal(res.truncated, false);
      assert.ok(res.text.includes("--- /dev/null"));
      assert.ok(res.text.includes("+++ b/new.txt"));
      assert.ok(res.text.includes("+hello"));
      assert.ok(res.text.includes("+world"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags binary and oversized untracked files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    try {
      await fs.writeFile(path.join(dir, "bin.dat"), Buffer.from([0x68, 0x69, 0x00, 0x21]));
      await fs.writeFile(path.join(dir, "huge.txt"), Buffer.alloc(300 * 1024, "x"));
      const { run } = stubRun({
        "diff --no-color --no-ext-diff -M HEAD -- bin.dat": "",
        "status --porcelain -- bin.dat": "?? bin.dat\n",
        "diff --no-color --no-ext-diff -M HEAD -- huge.txt": "",
        "status --porcelain -- huge.txt": "?? huge.txt\n",
      });
      const svc = new CliGitService(dir, run);
      assert.deepEqual(await svc.worktreeFileDiff("bin.dat"), { binary: true });
      assert.deepEqual(await svc.worktreeFileDiff("huge.txt"), { text: "", tooLarge: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects suspicious paths", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.worktreeFileDiff("-x"), /suspicious path/);
    await assert.rejects(
      new CliGitService(undefined, stubRun().run).worktreeFileDiff("a.js"),
      /No git repository/,
    );
  });
});

describe("CliGitService statusFiles and stashPush", () => {
  it("lists working-tree files with index/worktree status", async () => {
    const { calls, run } = stubRun({
      "status --porcelain=v1": "M  a.js\n M b.js\n?? c.txt\nR  o.js -> n.js\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.statusFiles(), [
      { path: "a.js", status: "Modified" },
      { path: "b.js", status: "Modified" },
      { path: "c.txt", status: "Untracked" },
      { path: "n.js", oldPath: "o.js", status: "Renamed" },
    ]);
    assert.deepEqual(calls, [["/repo", ["status", "--porcelain=v1"]]]);
  });

  it("stashes with a default or custom message", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.stashPush(), { stashed: true });
    assert.deepEqual(await svc.stashPush("  custom msg  "), { stashed: true });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      ["stash push -u -m Plegma: working tree", "stash push -u -m custom msg"],
    );
    const tracked = stubRun();
    await new CliGitService("/repo", tracked.run).stashPush("msg", { includeUntracked: false });
    assert.deepEqual(tracked.calls, [["/repo", ["stash", "push", "-m", "msg"]]]);
    await assert.rejects(new CliGitService(undefined, run).stashPush(), /No git repository/);
    await assert.rejects(new CliGitService(undefined, run).statusFiles(), /No git repository/);
  });
});

describe("CliGitService ops", () => {
  it("checkout and pull use the expected args", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.checkout("main");
    await svc.pull();
    assert.deepEqual(calls, [
      ["/repo", ["checkout", "main"]],
      ["/repo", ["pull", "--ff-only"]],
    ]);
  });

  it("deletes a branch with safe -d args and refuses suspicious names", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.deleteBranch("feature");
    assert.deepEqual(calls, [
      ["/repo", ["worktree", "list", "--porcelain"]],
      ["/repo", ["branch", "-d", "feature"]],
    ]);
    await assert.rejects(svc.deleteBranch("--all"), /suspicious branch name/);
    await assert.rejects(new CliGitService(undefined, run).deleteBranch("x"), /No git repository/);
  });

  it("force-deletes with -D and flags not-fully-merged refusals", async () => {
    const { calls, run } = stubRun({
      "branch -D gone": "",
      "branch -d stuck": new Error(
        "Command failed: git branch -d stuck\nerror: the branch 'stuck' is not fully merged",
      ),
      "branch -d locked": new Error("Command failed: git branch -d locked\nerror: branch locked"),
    });
    const svc = new CliGitService("/repo", run);
    await svc.deleteBranch("gone", true);
    assert.ok(
      calls.some(([, args]) => args.join(" ") === "branch -D gone"),
      "forced delete uses -D",
    );
    await assert.rejects(svc.deleteBranch("stuck"), /not fully merged/);
    try {
      await svc.deleteBranch("stuck");
      assert.fail("expected a notMerged error");
    } catch (e) {
      assert.equal(e.notMerged, true);
    }
    try {
      await svc.deleteBranch("locked");
      assert.fail("expected the lock error");
    } catch (e) {
      assert.equal(e.notMerged, undefined, "other git errors carry no notMerged flag");
      assert.match(e.message, /branch locked/);
    }
  });

  it("deleteBranch removes a linked worktree first, but never its own root", async () => {
    const porcelain = [
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /repo-wt",
      "HEAD bbb",
      "branch refs/heads/feature",
      "",
    ].join("\n");
    const { calls, run } = stubRun({ "worktree list --porcelain": porcelain });
    const svc = new CliGitService("/repo", run);
    await svc.deleteBranch("feature");
    assert.deepEqual(calls, [
      ["/repo", ["worktree", "list", "--porcelain"]],
      ["/repo", ["worktree", "remove", "/repo-wt"]],
      ["/repo", ["branch", "-d", "feature"]],
    ]);
    calls.length = 0;
    await svc.deleteBranch("main");
    assert.deepEqual(calls, [
      ["/repo", ["worktree", "list", "--porcelain"]],
      ["/repo", ["branch", "-d", "main"]],
    ]);
  });

  it("lists worktrees from porcelain output", async () => {
    const { run } = stubRun({
      "worktree list --porcelain": "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listWorktrees(), [
      { path: "/repo", hash: "aaa", branch: "main", bare: false, detached: false },
    ]);
  });

  it("creates branches with the start point and refuses bad names", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.createBranch("feat/x", "abc123");
    await svc.createBranch("lonely");
    assert.deepEqual(calls, [
      ["/repo", ["branch", "feat/x", "abc123"]],
      ["/repo", ["branch", "lonely"]],
    ]);
    await assert.rejects(svc.createBranch("--all", "x"), /suspicious name/);
    await assert.rejects(svc.createBranch("has space", "x"), /suspicious name/);
    await assert.rejects(svc.createBranch("ok", "--evil"), /suspicious ref/);
    await assert.rejects(new CliGitService(undefined, run).createBranch("x"), /No git repository/);
  });

  it("creates tags on the target and refuses bad names", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.createTag("v1.0.0", "abc123");
    await svc.createTag("plain");
    assert.deepEqual(calls, [
      ["/repo", ["tag", "v1.0.0", "abc123"]],
      ["/repo", ["tag", "plain"]],
    ]);
    await assert.rejects(svc.createTag("-x", "abc"), /suspicious name/);
    await assert.rejects(svc.createTag("ok", "--evil"), /suspicious ref/);
    await assert.rejects(new CliGitService(undefined, run).createTag("x"), /No git repository/);
  });

  it("renames branches and refuses bad names", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.renameBranch("old", "new");
    assert.deepEqual(calls, [["/repo", ["branch", "-m", "old", "new"]]]);
    await assert.rejects(svc.renameBranch("old", "--x"), /suspicious name/);
    await assert.rejects(svc.renameBranch("--x", "ok"), /suspicious name/);
    await assert.rejects(
      new CliGitService(undefined, run).renameBranch("a", "b"),
      /No git repository/,
    );
  });

  it("plain push does not create a backup", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    const backup = await svc.push(false);
    assert.equal(backup, undefined);
    assert.deepEqual(calls, [["/repo", ["push"]]]);
  });

  it("force push backs up then uses --force-with-lease", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "abc\n",
    });
    const svc = new CliGitService("/repo", run);
    const backup = await svc.push(true);
    assert.match(backup, /^refs\/plegma-backup\/main-\d+$/);
    const argLists = calls.map(([, args]) => args.join(" "));
    assert.deepEqual(argLists, [
      "rev-parse --abbrev-ref HEAD",
      "rev-parse HEAD",
      `update-ref ${backup} abc`,
      "push --force-with-lease",
    ]);
  });

  it("requires a repo for ops", async () => {
    const svc = new CliGitService(undefined);
    await assert.rejects(svc.push(), /No git repository/);
    await assert.rejects(svc.checkout("x"), /No git repository/);
  });

  it("fetches with prune and prune-tags flag combos", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.fetch(false, false);
    await svc.fetch(true, false);
    await svc.fetch(false, true);
    await svc.fetch(true, true);
    assert.deepEqual(calls, [
      ["/repo", ["fetch", "--all"]],
      ["/repo", ["fetch", "--all", "--prune"]],
      ["/repo", ["fetch", "--all", "--prune-tags"]],
      ["/repo", ["fetch", "--all", "--prune", "--prune-tags"]],
    ]);
  });

  it("fingerprints history from HEAD and ref tips", async () => {
    const { run } = stubRun({
      "rev-parse HEAD": "abc\n",
      "for-each-ref --format=%(objectname)": "abc\ndef\n",
    });
    const svc = new CliGitService("/repo", run);
    const fp = await svc.fingerprint();
    assert.match(fp, /^abc\n[0-9a-f]{40}$/);
  });

  it("fingerprint changes when refs or worktrees change", async () => {
    const responses = {
      "rev-parse HEAD": "abc\n",
      "for-each-ref --format=%(objectname)": "abc\n",
      "worktree list --porcelain": "worktree /repo\n",
      "status --porcelain": "",
    };
    const svc = new CliGitService("/repo", stubRun(responses).run);
    const before = await svc.fingerprint();
    responses["for-each-ref --format=%(objectname)"] = "abc\ndef\n";
    assert.notEqual(await svc.fingerprint(), before, "new ref tips change the digest");
    responses["worktree list --porcelain"] = "worktree /repo\nworktree /wt\n";
    assert.notEqual(await svc.fingerprint(), before, "new worktrees change the digest");
    responses["status --porcelain"] = " M dirty.js\n";
    assert.notEqual(await svc.fingerprint(), before, "dirty worktree changes the digest");
  });

  it("probe advertises CLI capabilities", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    const probe = await svc.probe();
    assert.equal(probe.vscodeGitAvailable, false);
    assert.equal(probe.fallback, "cli");
    for (const cap of ["log", "branches", "tags", "files", "checkout", "pull", "push"]) {
      assert.equal(probe.capabilities[cap], true);
    }
  });

  it("lists branches and tags with the ref formats", async () => {
    const { calls, run } = stubRun({
      [`for-each-ref --format=%(refname)\x1f%(objectname:short)\x1f%(objectname)\x1f%(*objectname)\x1f%(HEAD)\x1f%(upstream:short) refs/heads refs/remotes`]:
        "refs/heads/main\x1fab12\x1fab12full\x1f\x1f*\x1f",
      [`for-each-ref --format=%(refname:short)\x1f%(objectname)\x1f%(*objectname)\x1f%(objecttype)\x1f%(taggername)\x1f%(taggeremail:trim)\x1f%(taggerdate:unix)\x1f%(contents) refs/tags`]:
        "v1\x1faa11\x1f\x1fcommit\x1f\x1f\x1fsubject",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listBranches(), [
      { name: "main", kind: "local", target: "ab12full", isHead: true, upstream: undefined },
    ]);
    assert.deepEqual(await svc.listTags(), [
      {
        name: "v1",
        target: "aa11",
        annotated: false,
        taggerName: "",
        taggerEmail: "",
        timestamp: 0,
        message: "",
      },
    ]);
    assert.equal(calls.length, 2);
  });

  it("requires a repository for every operation", async () => {
    const svc = new CliGitService(undefined, stubRun().run);
    await assert.rejects(svc.listCommits(), /No git repository/);
    await assert.rejects(svc.listBranches(), /No git repository/);
    await assert.rejects(svc.listTags(), /No git repository/);
    await assert.rejects(svc.listCommitFiles("abc"), /No git repository/);
    await assert.rejects(svc.listWorktrees(), /No git repository/);
    await assert.rejects(svc.fileDiff({ sha: "a", path: "b" }), /No git repository/);
    await assert.rejects(svc.worktreeFileDiff("b"), /No git repository/);
    await assert.rejects(svc.statusFiles(), /No git repository/);
    await assert.rejects(svc.stashPush(), /No git repository/);
    await assert.rejects(svc.checkout("x"), /No git repository/);
    await assert.rejects(svc.pull(), /No git repository/);
    await assert.rejects(svc.fetch(), /No git repository/);
    await assert.rejects(svc.fingerprint(), /No git repository/);
  });

  it("rejects files for a missing commit with a friendly error", async () => {
    const { run } = stubRun({
      "cat-file -e gone^{commit}": new Error("fatal: bad object gone"),
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(svc.listCommitFiles("gone"), /no longer in the history/);
  });

  it("lists files when the commit exists", async () => {
    const { calls, run } = stubRun({
      "cat-file -e abc^{commit}": "",
      "diff-tree --no-commit-id --name-status -r --root -M abc": "M\ta.js\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listCommitFiles("abc"), [{ path: "a.js", status: "Modified" }]);
    assert.equal(calls.length, 2);
  });
});

describe("CliGitService native-menu ops", () => {
  it("checks out commits detached", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.checkoutDetached("abc123");
    assert.deepEqual(calls, [["/repo", ["checkout", "--detach", "abc123"]]]);
    await assert.rejects(svc.checkoutDetached(""), /suspicious ref/);
    await assert.rejects(
      new CliGitService(undefined, stubRun().run).checkoutDetached("abc"),
      /No git repository/,
    );
  });

  it("checks out remote branches as tracking branches", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.checkoutTracking("origin/feature");
    assert.deepEqual(calls, [["/repo", ["checkout", "--track", "origin/feature"]]]);
    await assert.rejects(svc.checkoutTracking("-origin/x"), /suspicious ref/);
  });

  it("deletes tags", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.deleteTag("v1.0.0");
    assert.deepEqual(calls, [["/repo", ["tag", "-d", "v1.0.0"]]]);
    await assert.rejects(svc.deleteTag("  "), /suspicious name/);
  });

  it("deletes remote branches via push --delete", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.deleteRemoteBranch("origin", "feature/x");
    assert.deepEqual(calls, [["/repo", ["push", "origin", "--delete", "feature/x"]]]);
    await assert.rejects(svc.deleteRemoteBranch("origin", "-x"), /suspicious name/);
    await assert.rejects(svc.deleteRemoteBranch("origin", "../x"), /suspicious name/);
  });

  it("resolves the merge base trimmed", async () => {
    const { calls, run } = stubRun({ "merge-base aaa bbb": "ccc333\n" });
    const svc = new CliGitService("/repo", run);
    assert.equal(await svc.mergeBase("aaa", "bbb"), "ccc333");
    assert.deepEqual(calls, [["/repo", ["merge-base", "aaa", "bbb"]]]);
  });

  it("lists changed files between two revisions", async () => {
    const { calls, run } = stubRun({
      "diff --no-color --no-ext-diff -M --name-status oldsha newsha":
        "M\tmod.js\nA\tnew.js\nD\told.js\nR100\twas.js\tren.js\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.compareRefs("oldsha", "newsha"), [
      { path: "mod.js", status: "Modified" },
      { path: "new.js", status: "Added" },
      { path: "old.js", status: "Deleted" },
      { path: "ren.js", oldPath: "was.js", status: "Renamed" },
    ]);
    assert.equal(calls.length, 1);
  });
});

describe("CliGitService stashList", () => {
  it("lists stashes parsed from git stash list", async () => {
    const SEP = "\x1f";
    const { calls, run } = stubRun({
      [`stash list --format=%H${SEP}%gd${SEP}%gs${SEP}%at`]: `abc123${SEP}stash@{0}${SEP}WIP on main${SEP}1700000000\n`,
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.stashList(), [
      { hash: "abc123", name: "stash@{0}", message: "WIP on main", timestamp: 1700000000 },
    ]);
    assert.equal(calls.length, 1);
  });

  it("returns empty when there are no stashes", async () => {
    const { run } = stubRun();
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.stashList(), []);
  });
});

describe("CliGitService stash mutations", () => {
  it("applies, pops, and drops stashes by ref", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.stashApply("stash@{0}");
    await svc.stashPop("stash@{1}");
    await svc.stashDrop("stash@{2}");
    assert.deepEqual(calls, [
      ["/repo", ["stash", "apply", "stash@{0}"]],
      ["/repo", ["stash", "pop", "stash@{1}"]],
      ["/repo", ["stash", "drop", "stash@{2}"]],
    ]);
  });

  it("creates a branch from a stash", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.stashBranch("feature/wip", "stash@{0}");
    assert.deepEqual(calls, [["/repo", ["stash", "branch", "feature/wip", "stash@{0}"]]]);
  });

  it("refuses suspicious stash refs and branch names", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.stashApply("HEAD"), /suspicious stash ref/);
    await assert.rejects(svc.stashPop("--help"), /suspicious stash ref/);
    await assert.rejects(svc.stashDrop("stash@{0}; rm -rf"), /suspicious stash ref/);
    await assert.rejects(svc.stashBranch("-x", "stash@{0}"), /suspicious name/);
    await assert.rejects(svc.stashBranch("ok", "bogus"), /suspicious stash ref/);
  });
});

describe("CliGitService pushBranch", () => {
  it("pushes the current branch plainly when it has an upstream", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse --abbrev-ref --symbolic-full-name main@{upstream}": "origin/main\n",
      push: "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.pushBranch("main", {}), { pushed: "main" });
    assert.deepEqual(calls, [
      ["/repo", ["rev-parse", "--abbrev-ref", "HEAD"]],
      ["/repo", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "main@{upstream}"]],
      ["/repo", ["push"]],
    ]);
  });

  it("pushes another branch to an explicit remote", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "push origin feature": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.pushBranch("feature", { remote: "origin" }), {
      pushed: "feature",
    });
    assert.ok(
      calls.some(([, args]) => args.join(" ") === "push origin feature"),
      "explicit refspec push ran",
    );
  });

  it("sets upstream when pushing a branch with none to a single remote", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      remote: "origin\n",
      "push --set-upstream origin fresh": "",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.pushBranch("fresh", {}), { pushed: "fresh" });
    assert.ok(
      calls.some(([, args]) => args.join(" ") === "push --set-upstream origin fresh"),
      "set-upstream push ran",
    );
  });

  it("refuses without remotes or with several and no upstream", async () => {
    const none = new CliGitService("/repo", stubRun({ remote: "\n" }).run);
    await assert.rejects(none.pushBranch("fresh", {}), /no git remotes/);
    const many = new CliGitService("/repo", stubRun({ remote: "origin\nupstream\n" }).run);
    await assert.rejects(many.pushBranch("fresh", {}), /multiple remotes/);
  });

  it("backs up before force pushing with lease", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse main": "abc123\n",
    });
    const svc = new CliGitService("/repo", run);
    const res = await svc.pushBranch("main", { remote: "origin", force: true });
    assert.match(res.backupRef, /^refs\/plegma-backup\/main-\d+$/);
    const backup = calls.find(([, args]) => args[0] === "update-ref");
    assert.deepEqual(backup[1], ["update-ref", res.backupRef, "abc123"]);
    assert.ok(
      calls.some(([, args]) => args.join(" ") === "push --force-with-lease origin main"),
      "force-with-lease push ran",
    );
  });

  it("refuses suspicious branch and remote names", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.pushBranch("-x", { remote: "origin" }), /suspicious branch/);
    await assert.rejects(svc.pushBranch("ok", { remote: "-r" }), /suspicious remote/);
  });

  it("lists remotes", async () => {
    const { run } = stubRun({ remote: "origin\nupstream\n" });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listRemotes(), ["origin", "upstream"]);
  });
});

describe("CliGitService pushTag", () => {
  it("pushes the tag with an explicit refspec", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.pushTag("origin", "v1.0.0");
    assert.deepEqual(calls, [["/repo", ["push", "origin", "tag", "v1.0.0"]]]);
  });

  it("refuses suspicious remotes and tag names", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.pushTag("-origin", "v1"), /suspicious remote/);
    await assert.rejects(svc.pushTag("origin", "-v1"), /suspicious name/);
    await assert.rejects(svc.pushTag("origin", "  "), /suspicious name/);
  });
});

describe("CliGitService mergeCommit", () => {
  it("delegates commit merge to the shared merge flow", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    const res = await svc.mergeCommit("abc123");
    assert.equal(res.merged, true);
    assert.ok(
      calls.some(([, args]) => args[0] === "merge" && args.includes("abc123")),
      "merge ran on the sha",
    );
  });
});

describe("normalizeRefs", () => {
  it("keeps plain ref names, trimmed and de-duplicated", () => {
    assert.deepEqual(normalizeRefs(["main", " feature/x ", "main", "origin/main", "v1.0.0", ""]), [
      "main",
      "feature/x",
      "origin/main",
      "v1.0.0",
    ]);
  });

  it("drops anything that could read as an option or a range", () => {
    assert.deepEqual(
      normalizeRefs([
        "--all",
        "-n",
        "main..feature",
        "HEAD~1",
        "a b",
        "re:f",
        "a?b",
        "a[b",
        "a\\b",
        "ok",
      ]),
      ["ok"],
    );
  });

  it("returns an empty list for non-arrays", () => {
    assert.deepEqual(normalizeRefs(undefined), []);
    assert.deepEqual(normalizeRefs(null), []);
    assert.deepEqual(normalizeRefs("main"), []);
  });
});

describe("CliGitService listCommits ref filter", () => {
  it("passes the selected refs instead of --all", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(50, { refs: ["main", "feature"] });
    const args = calls[0][1];
    assert.ok(args.includes("main"), "main passed");
    assert.ok(args.includes("feature"), "feature passed");
    assert.ok(!args.includes("--all"), "--all dropped when refs are chosen");
    const topo = args.indexOf("--topo-order");
    assert.ok(args.indexOf("feature") < topo, "refs precede --topo-order");
  });

  it("falls back to --all when every ref is rejected", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(50, { refs: ["--all"] });
    assert.ok(calls[0][1].includes("--all"), "--all used when nothing valid remains");
  });
});

describe("normalizeGlobs", () => {
  it("keeps fully qualified refs/ patterns", () => {
    assert.deepEqual(normalizeGlobs(["refs/heads/feature/*", "refs/remotes/origin/*"]), [
      "refs/heads/feature/*",
      "refs/remotes/origin/*",
    ]);
  });

  it("splits a single string on commas and spaces", () => {
    assert.deepEqual(normalizeGlobs("refs/heads/a/*, refs/heads/b"), [
      "refs/heads/a/*",
      "refs/heads/b",
    ]);
  });

  it("drops shorthand, option-like, and range patterns", () => {
    assert.deepEqual(
      normalizeGlobs(["feature/*", "--all", "refs/heads/../evil", "refs/heads/a b", ""]),
      [],
    );
  });
});

describe("CliGitService listCommits glob filter", () => {
  it("passes globs instead of --all and ignores refs while a glob is set", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(50, { globs: ["refs/heads/feature/*"], refs: ["main"] });
    const args = calls[0][1];
    assert.ok(args.includes("--glob=refs/heads/feature/*"), "glob passed");
    assert.ok(!args.includes("main"), "picked refs ignored while a pattern is set");
    assert.ok(!args.includes("--all"), "--all not used with a pattern");
  });

  it("expands bare patterns into both namespaces upstream of git", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(50, { globs: ["refs/heads/feature/*", "refs/remotes/feature/*"] });
    const args = calls[0][1];
    assert.ok(args.includes("--glob=refs/heads/feature/*"));
    assert.ok(args.includes("--glob=refs/remotes/feature/*"));
  });
});

describe("CliGitService listCommits ordering", () => {
  it("defaults to topological order", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(10, {});
    const args = calls[0][1];
    assert.ok(args.includes("--topo-order"), "topological by default");
    assert.ok(!args.includes("--date-order"), "no date ordering by default");
  });

  it("maps date and author-date to the matching git flags", async () => {
    const date = stubRun();
    await new CliGitService("/repo", date.run).listCommits(10, { order: "date" });
    assert.ok(date.calls[0][1].includes("--date-order"), "date order");
    const author = stubRun();
    await new CliGitService("/repo", author.run).listCommits(10, { order: "author-date" });
    assert.ok(author.calls[0][1].includes("--author-date-order"), "author-date order");
  });

  it("ignores unknown order values", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.listCommits(10, { order: "sideways" });
    assert.ok(calls[0][1].includes("--topo-order"), "falls back to topological");
  });
});

describe("CliGitService remote management", () => {
  it("parses remote -v into fetch/push URLs per remote", async () => {
    const { run } = stubRun({
      "remote -v":
        "origin\tgit@github.com:jchrist/plegma.git (fetch)\n" +
        "origin\tgit@github.com:jchrist/plegma.git (push)\n" +
        "upstream\thttps://github.com/other/plegma.git (fetch)\n" +
        "upstream\thttps://github.com/other/plegma.git (push)\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listRemoteDetails(), [
      {
        name: "origin",
        fetchUrl: "git@github.com:jchrist/plegma.git",
        pushUrl: "git@github.com:jchrist/plegma.git",
      },
      {
        name: "upstream",
        fetchUrl: "https://github.com/other/plegma.git",
        pushUrl: "https://github.com/other/plegma.git",
      },
    ]);
  });

  it("runs add, rename, set-url, and remove with the right args", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.addRemote("origin", "git@x:y.git"), { added: "origin" });
    assert.deepEqual(await svc.renameRemote("origin", "upstream"), { renamed: "upstream" });
    assert.deepEqual(await svc.setRemoteUrl("origin", "https://x/y.git"), {
      updated: "origin",
    });
    assert.deepEqual(await svc.removeRemote("origin"), { removed: "origin" });
    assert.deepEqual(
      calls.map(([, args]) => args.join(" ")),
      [
        "remote add origin git@x:y.git",
        "remote rename origin upstream",
        "remote set-url origin https://x/y.git",
        "remote remove origin",
      ],
    );
  });

  it("fetches one remote, pruning only when asked", async () => {
    const plain = stubRun();
    await new CliGitService("/repo", plain.run).fetchRemote("origin");
    assert.deepEqual(plain.calls, [["/repo", ["fetch", "origin"]]]);
    const pruned = stubRun();
    await new CliGitService("/repo", pruned.run).fetchRemote("origin", true);
    assert.deepEqual(pruned.calls, [["/repo", ["fetch", "origin", "--prune"]]]);
  });

  it("refuses suspicious remote names and URLs", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.addRemote("-x", "https://x/y.git"), /suspicious remote name/);
    await assert.rejects(svc.addRemote("a b", "https://x/y.git"), /suspicious remote name/);
    await assert.rejects(svc.addRemote("ok", ""), /suspicious remote URL/);
    await assert.rejects(svc.addRemote("ok", "--upload-pack=x"), /suspicious remote URL/);
    await assert.rejects(svc.renameRemote("origin", "-x"), /suspicious remote name/);
    await assert.rejects(svc.setRemoteUrl("origin", "  "), /suspicious remote URL/);
    await assert.rejects(svc.removeRemote("--all"), /suspicious remote name/);
    await assert.rejects(svc.fetchRemote("-p"), /suspicious remote name/);
  });

  it("accepts a local path with spaces as a URL", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    await svc.addRemote("local", "/tmp/my backups/repo.git");
    assert.deepEqual(calls, [["/repo", ["remote", "add", "local", "/tmp/my backups/repo.git"]]]);
  });
});

describe("CliGitService compareWorktree", () => {
  it("diffs the revision against the worktree with rename detection", async () => {
    const { calls, run } = stubRun({
      "diff --no-color --no-ext-diff -M --name-status aaa111": "M\tmod.js\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.compareWorktree("aaa111"), [{ path: "mod.js", status: "Modified" }]);
    assert.deepEqual(calls, [
      ["/repo", ["diff", "--no-color", "--no-ext-diff", "-M", "--name-status", "aaa111"]],
    ]);
  });

  it("refuses suspicious revisions", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.compareWorktree("-x"), /suspicious ref/);
    await assert.rejects(svc.compareWorktree(""), /suspicious ref/);
  });
});

describe("CliGitService fetchRemoteBranch", () => {
  it("fetches the branch into its same-named local branch", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.fetchRemoteBranch("origin", "feature"), {
      fetched: "feature",
    });
    assert.deepEqual(calls, [
      ["/repo", ["rev-parse", "--abbrev-ref", "HEAD"]],
      ["/repo", ["fetch", "origin", "feature:feature"]],
    ]);
  });

  it("refuses when the local branch is checked out", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "feature\n",
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(svc.fetchRemoteBranch("origin", "feature"), /currently checked out/);
    assert.equal(calls.length, 1, "no fetch ran");
  });

  it("fetches a remote branch into a differently-named local branch", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "main\n",
    });
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.fetchRemoteBranch("origin", "bar", "foo"), { fetched: "foo" });
    assert.deepEqual(calls, [
      ["/repo", ["rev-parse", "--abbrev-ref", "HEAD"]],
      ["/repo", ["fetch", "origin", "bar:foo"]],
    ]);
  });

  it("refuses when the named local branch is checked out", async () => {
    const { calls, run } = stubRun({
      "rev-parse --abbrev-ref HEAD": "foo\n",
    });
    const svc = new CliGitService("/repo", run);
    await assert.rejects(
      svc.fetchRemoteBranch("origin", "bar", "foo"),
      /Cannot fetch into 'foo'.*currently checked out/,
    );
    assert.equal(calls.length, 1, "no fetch ran");
  });

  it("refuses suspicious remotes and branches", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.fetchRemoteBranch("-o", "feature"), /suspicious remote name/);
    await assert.rejects(svc.fetchRemoteBranch("origin", "-f"), /suspicious branch/);
    await assert.rejects(svc.fetchRemoteBranch("origin", "a b"), /suspicious branch/);
    await assert.rejects(svc.fetchRemoteBranch("origin", "feature", "-f"), /suspicious branch/);
    await assert.rejects(svc.fetchRemoteBranch("origin", "feature", "a b"), /suspicious branch/);
  });
});

describe("CliGitService pullRemoteBranch", () => {
  it("pulls ff-only from the remote branch", async () => {
    const { calls, run } = stubRun();
    const svc = new CliGitService("/repo", run);
    assert.deepEqual(await svc.pullRemoteBranch("origin", "feature"), {
      pulled: "origin/feature",
    });
    assert.deepEqual(calls, [["/repo", ["pull", "--ff-only", "origin", "feature"]]]);
  });

  it("refuses suspicious remotes and branches", async () => {
    const svc = new CliGitService("/repo", stubRun().run);
    await assert.rejects(svc.pullRemoteBranch("-o", "feature"), /suspicious remote name/);
    await assert.rejects(svc.pullRemoteBranch("origin", "-f"), /suspicious branch/);
    await assert.rejects(svc.pullRemoteBranch("origin", ""), /suspicious branch/);
  });
});

describe("CliGitService commitContext (real git)", () => {
  const ex = promisify(execFile);

  async function repo() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-ctx-"));
    const git = async (...args) => (await ex("git", args, { cwd: dir })).stdout.trim();
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
    const commit = async (name, content, message) => {
      await fs.writeFile(path.join(dir, name), content);
      await git("add", name);
      await git("commit", "-m", message, "--quiet");
      return git("rev-parse", "HEAD");
    };
    return { dir, git, commit };
  }

  it("tells commits in HEAD from side commits, and counts merges since", async () => {
    const { dir, git, commit } = await repo();
    try {
      const base = await commit("a.txt", "a\n", "base");
      await git("checkout", "-b", "side", "--quiet");
      const side = await commit("b.txt", "b\n", "side");
      const picked = await commit("p.txt", "p\n", "picked later");
      const fresh = await commit("q.txt", "q\n", "never picked");
      await git("checkout", "main", "--quiet");
      const m1 = await commit("c.txt", "c\n", "main one");
      await git("cherry-pick", picked);
      await git("checkout", "-b", "topic", "--quiet");
      await commit("t.txt", "t\n", "topic");
      await git("checkout", "main", "--quiet");
      await git("merge", "--no-ff", "--no-edit", "topic");
      const head = await git("rev-parse", "HEAD");
      const svc = new CliGitService(dir, runGit);
      const ctx = await svc.commitContext([base, m1, side, picked, fresh, "--evil", "HEAD~1"]);
      assert.equal(ctx.head, head);
      assert.deepEqual(Object.keys(ctx.commits).sort(), [base, m1, side, picked, fresh].sort());
      assert.deepEqual(ctx.commits[base], { inHead: true, applied: false, mergesSince: 1 });
      assert.deepEqual(ctx.commits[m1], { inHead: true, applied: false, mergesSince: 1 });
      assert.deepEqual(ctx.commits[side], { inHead: false, applied: false, mergesSince: 0 });
      assert.deepEqual(ctx.commits[picked], { inHead: false, applied: true, mergesSince: 0 });
      assert.deepEqual(ctx.commits[fresh], { inHead: false, applied: false, mergesSince: 0 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports no HEAD in an unborn repository", async () => {
    const { dir } = await repo();
    try {
      const svc = new CliGitService(dir, runGit);
      assert.deepEqual(await svc.commitContext(["abcdef1"]), {
        head: null,
        commits: { abcdef1: { inHead: false, applied: false, mergesSince: 0 } },
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
