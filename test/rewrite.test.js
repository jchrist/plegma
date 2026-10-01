import { describe, it, beforeEach, afterEach } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  planRewrite,
  buildSequenceEditor,
  buildMessageEditor,
  RebaseConflictError,
  MergeConflictError,
  executeRewrite,
  rebaseOnto,
  rebaseContinue,
  rebaseSkip,
  rebaseAbort,
  rebaseStatus,
  mergeBranch,
  mergeCommit,
  mergeStatus,
  mergeContinue,
  mergeAbort,
  cherryPick,
  resetTo,
  revertCommit,
} from "../src/git/rewrite.js";
import { runGit } from "../src/git/cliGit.js";

const ex = promisify(execFile);

describe("planRewrite", () => {
  const entries = [
    { hash: "a", subject: "first" },
    { hash: "b", subject: "second" },
    { hash: "c", subject: "third" },
    { hash: "d", subject: "fourth" },
  ];

  it("groups non-sequential squash at the earliest position", () => {
    const { todo, message } = planRewrite(entries, { squash: ["d", "b"] });
    assert.equal(message, null);
    assert.deepEqual(todo.split("\n").filter(Boolean), [
      "pick a first",
      "pick b second",
      "squash d",
      "pick c third",
    ]);
  });

  it("emits drop lines and keeps order otherwise", () => {
    const { todo } = planRewrite(entries, { drop: ["b"] });
    assert.deepEqual(todo.split("\n").filter(Boolean), [
      "pick a first",
      "drop b second",
      "pick c third",
      "pick d fourth",
    ]);
  });

  it("emits reword for a single commit", () => {
    const { todo, message } = planRewrite(entries, {}, { hash: "c", message: "better" });
    assert.equal(message, null);
    assert.ok(todo.includes("reword c third"));
  });

  it("reword on a squashed commit rewrites the group message", () => {
    const { todo, message } = planRewrite(
      entries,
      { squash: ["b", "d"] },
      { hash: "d", message: "combined!" },
    );
    assert.equal(message, "combined!");
    const lines = todo.split("\n").filter(Boolean);
    assert.equal(lines[1], "reword b second");
    assert.ok(lines.includes("squash d"));
  });

  it("rejects unknown, empty-target, and squash+drop commits", () => {
    assert.throws(() => planRewrite(entries, { squash: ["zzz"] }), /not in the current branch/);
    assert.throws(
      () => planRewrite(entries, { squash: ["a"], drop: ["a"] }),
      /both squashed and dropped/,
    );
  });
});

describe("editor builders", () => {
  it("sequence editor copies the todo file via sh", () => {
    assert.equal(buildSequenceEditor(), `sh -c 'cat "\${PLEGMA_TODO_SRC}" > "$@"' sh`);
  });

  it("message editor writes the message via sh", () => {
    assert.equal(buildMessageEditor(), `sh -c 'printf %s "\${PLEGMA_MESSAGE}" > "$@"' sh`);
  });
});

describe("rebaseStatus", () => {
  it("reports idle when no rebase directory exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-st-"));
    try {
      const run = async () => "rebase-merge";
      assert.deepEqual(await rebaseStatus(run, dir), { inProgress: false, conflictedFiles: [] });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports conflicts from the fake rebase dir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-st-"));
    try {
      await fs.mkdir(path.join(dir, "rebase-merge"));
      const run = async (_root, args) =>
        args[0] === "rev-parse" ? "rebase-merge" : "a.js\nb.js\n";
      assert.deepEqual(await rebaseStatus(run, dir), {
        inProgress: true,
        conflictedFiles: ["a.js", "b.js"],
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("executeRewrite integration (real git)", () => {
  let dir;

  async function git(...args) {
    return ex("git", args, { cwd: dir });
  }

  async function commitFile(name, content, message) {
    await fs.writeFile(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message, "--quiet");
    const { stdout } = await git("rev-parse", "HEAD");
    return stdout.trim();
  }

  async function freshRepo() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-rw-"));
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
  }

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("squashes non-sequential commits", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "first");
    const b = await commitFile("b.txt", "b\n", "second");
    const c = await commitFile("c.txt", "c\n", "third");
    const res = await executeRewrite(runGit, dir, { squash: [c, b] });
    assert.equal(res.rewritten, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s");
    const subjects = stdout.split("\n").filter(Boolean);
    assert.equal(subjects.length, 2);
    const { stdout: body } = await git("log", "--format=%B", "-n", "1");
    assert.match(body, /second/);
    assert.match(body, /third/);
  });

  it("drops a commit", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "first");
    await commitFile("b.txt", "b\n", "second");
    await commitFile("c.txt", "c\n", "third");
    await executeRewrite(runGit, dir, { drop: [await shaOf("second")] });
    const { stdout } = await git("log", "--format=%s");
    const subjects = stdout.split("\n").filter(Boolean);
    assert.deepEqual(subjects, ["third", "first"]);
    await assert.rejects(fs.stat(path.join(dir, "b.txt")));

    async function shaOf(subject) {
      const { stdout: out } = await git("log", "--reverse", "--format=%H %s");
      const line = out.split("\n").find((l) => l.endsWith(` ${subject}`));
      return line.split(" ")[0];
    }
  });

  it("refuses a dirty working tree", async () => {
    await freshRepo();
    const a = await commitFile("a.txt", "a\n", "first");
    await commitFile("b.txt", "b\n", "second");
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    await assert.rejects(executeRewrite(runGit, dir, { drop: [a] }), /not clean/);
  });

  it("reports conflicts and aborts a clashing rebase cleanly", async () => {
    await freshRepo();
    await commitFile("f.txt", "base\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    await commitFile("f.txt", "feature\n", "feature change");
    await git("checkout", "main", "--quiet");
    await commitFile("f.txt", "main\n", "main change");
    await git("checkout", "feature", "--quiet");
    const err = await rebaseOnto(runGit, dir, "main").then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a conflict error");
    assert.equal(err.conflict, true);
    assert.deepEqual(err.conflictedFiles, ["f.txt"]);
    const during = await rebaseStatus(runGit, dir);
    assert.equal(during.inProgress, true);
    assert.deepEqual(await rebaseAbort(runGit, dir), { aborted: true });
    assert.deepEqual(await rebaseStatus(runGit, dir), {
      inProgress: false,
      conflictedFiles: [],
    });
    const { stdout } = await git("log", "--format=%s", "feature");
    assert.match(stdout, /feature change/);
  });

  it("rebases onto a raw commit SHA", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await git("checkout", "-b", "side", "--quiet");
    await commitFile("c.txt", "c\n", "side work");
    await git("checkout", "main", "--quiet");
    const target = await commitFile("b.txt", "b\n", "main advance");
    await git("checkout", "side", "--quiet");
    const res = await rebaseOnto(runGit, dir, target);
    assert.equal(res.rebased, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s");
    assert.match(stdout, /main advance/);
    assert.match(stdout, /side work/);
  });
});

describe("mergeBranch integration (real git)", () => {
  let dir;

  async function git(...args) {
    return ex("git", args, { cwd: dir });
  }

  async function commitFile(name, content, message) {
    await fs.writeFile(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message, "--quiet");
    const { stdout } = await git("rev-parse", "HEAD");
    return stdout.trim();
  }

  async function freshRepo() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-mg-"));
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
  }

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("merges a clean branch with a backup ref", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    await commitFile("b.txt", "b\n", "feature work");
    await git("checkout", "main", "--quiet");
    const res = await mergeBranch(runGit, dir, "feature");
    assert.equal(res.merged, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s");
    assert.match(stdout, /feature work/);
  });

  it("leaves a clashing merge in progress with named files", async () => {
    await freshRepo();
    await commitFile("f.txt", "base\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    await commitFile("f.txt", "feature\n", "feature change");
    await git("checkout", "main", "--quiet");
    await commitFile("f.txt", "main\n", "main change");
    const err = await mergeBranch(runGit, dir, "feature").then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a conflict error");
    assert.equal(err.conflict, true);
    assert.deepEqual(err.conflictedFiles, ["f.txt"]);
    assert.match(err.message, /Backup: refs\/plegma-backup\//);
    const during = await mergeStatus(runGit, dir);
    assert.deepEqual(during, { inProgress: true, conflictedFiles: ["f.txt"] });
    assert.deepEqual(await mergeAbort(runGit, dir), { aborted: true });
    assert.deepEqual(await mergeStatus(runGit, dir), {
      inProgress: false,
      conflictedFiles: [],
    });
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /main change/);
  });

  it("continues a resolved merge", async () => {
    await freshRepo();
    await commitFile("f.txt", "base\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    await commitFile("f.txt", "feature\n", "feature change");
    await git("checkout", "main", "--quiet");
    await commitFile("f.txt", "main\n", "main change");
    await mergeBranch(runGit, dir, "feature").then(
      () => null,
      (e) => e,
    );
    await fs.writeFile(path.join(dir, "f.txt"), "resolved\n");
    await git("add", "f.txt");
    assert.deepEqual(await mergeContinue(runGit, dir), { continued: true });
    assert.deepEqual(await mergeStatus(runGit, dir), {
      inProgress: false,
      conflictedFiles: [],
    });
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /Merge branch 'feature'/);
  });

  it("reports idle merge status without MERGE_HEAD", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    assert.deepEqual(await mergeStatus(runGit, dir), {
      inProgress: false,
      conflictedFiles: [],
    });
  });

  it("refuses dirty trees and suspicious refs", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    await assert.rejects(mergeBranch(runGit, dir, "feature"), /not clean/);
    await assert.rejects(mergeBranch(runGit, dir, "--evil"), /suspicious ref/);
    await assert.rejects(mergeBranch(runGit, undefined, "x"), /No git repository/);
  });

  it("merges a commit SHA with the same conflict flow", async () => {
    await freshRepo();
    const base = await commitFile("a.txt", "a\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    const tip = await commitFile("b.txt", "b\n", "feature work");
    await git("checkout", "main", "--quiet");
    assert.notEqual(tip, base);
    const res = await mergeCommit(runGit, dir, tip);
    assert.equal(res.merged, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s");
    assert.match(stdout, /feature work/);
  });

  it("refuses non-SHA merge targets", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await assert.rejects(mergeCommit(runGit, dir, "--evil"), /suspicious commit/);
    await assert.rejects(mergeCommit(runGit, dir, "main"), /suspicious commit/);
    await assert.rejects(mergeCommit(runGit, dir, ""), /suspicious commit/);
  });
});

describe("cherryPick integration (real git)", () => {
  let dir;

  async function git(...args) {
    return ex("git", args, { cwd: dir });
  }

  async function commitFile(name, content, message) {
    await fs.writeFile(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message, "--quiet");
    const { stdout } = await git("rev-parse", "HEAD");
    return stdout.trim();
  }

  async function freshRepo() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-cp-"));
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
  }

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("picks a clean commit with a backup ref", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    const feat = await commitFile("b.txt", "b\n", "feature work");
    await git("checkout", "main", "--quiet");
    const res = await cherryPick(runGit, dir, feat);
    assert.equal(res.picked, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s");
    assert.match(stdout, /feature work/);
  });

  it("aborts a clashing pick and names the files", async () => {
    await freshRepo();
    await commitFile("f.txt", "base\n", "base");
    await git("checkout", "-b", "feature", "--quiet");
    const feat = await commitFile("f.txt", "feature\n", "feature change");
    await git("checkout", "main", "--quiet");
    await commitFile("f.txt", "main\n", "main change");
    const err = await cherryPick(runGit, dir, feat).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a conflict error");
    assert.equal(err.conflict, true);
    assert.deepEqual(err.conflictedFiles, ["f.txt"]);
    await assert.rejects(git("rev-parse", "--verify", "CHERRY_PICK_HEAD"));
  });

  it("refuses dirty trees and suspicious refs", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "base");
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    await assert.rejects(cherryPick(runGit, dir, "abc"), /not clean/);
    await assert.rejects(cherryPick(runGit, dir, "--evil"), /suspicious ref/);
    await assert.rejects(cherryPick(runGit, undefined, "abc"), /No git repository/);
  });
});

describe("resetTo integration (real git)", () => {
  let dir;

  async function git(...args) {
    return ex("git", args, { cwd: dir });
  }

  async function commitFile(name, content, message) {
    await fs.writeFile(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message, "--quiet");
    const { stdout } = await git("rev-parse", "HEAD");
    return stdout.trim();
  }

  async function freshRepo() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-rs-"));
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
  }

  async function stagedFiles() {
    const { stdout } = await git("diff", "--cached", "--name-only");
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("mixed reset keeps files but unstages them, with a backup", async () => {
    await freshRepo();
    const first = await commitFile("a.txt", "a\n", "first");
    await commitFile("b.txt", "b\n", "second");
    const res = await resetTo(runGit, dir, first, "mixed");
    assert.equal(res.reset, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /first/);
    assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "b\n");
    assert.deepEqual(await stagedFiles(), []);
  });

  it("soft reset keeps the second commit staged", async () => {
    await freshRepo();
    const first = await commitFile("a.txt", "a\n", "first");
    await commitFile("b.txt", "b\n", "second");
    await resetTo(runGit, dir, first, "soft");
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /first/);
    assert.deepEqual(await stagedFiles(), ["b.txt"]);
  });

  it("hard reset discards changes on a clean tree", async () => {
    await freshRepo();
    const first = await commitFile("a.txt", "a\n", "first");
    await commitFile("b.txt", "b\n", "second");
    await resetTo(runGit, dir, first, "hard");
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /first/);
    await assert.rejects(fs.stat(path.join(dir, "b.txt")));
  });

  it("refuses hard reset on a dirty tree and rejects bad input", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "first");
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    await assert.rejects(resetTo(runGit, dir, "HEAD", "hard"), /not clean/);
    await assert.rejects(resetTo(runGit, dir, "HEAD", "super"), /Unknown reset mode/);
    await assert.rejects(resetTo(runGit, dir, "--evil", "soft"), /suspicious ref/);
    await assert.rejects(resetTo(runGit, undefined, "HEAD", "soft"), /No git repository/);
  });
});

describe("revertCommit integration (real git)", () => {
  let dir;

  async function git(...args) {
    return ex("git", args, { cwd: dir });
  }

  async function commitFile(name, content, message) {
    await fs.writeFile(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message, "--quiet");
    const { stdout } = await git("rev-parse", "HEAD");
    return stdout.trim();
  }

  async function freshRepo() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-rv-"));
    await git("init", "-b", "main", "--quiet");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await git("config", "commit.gpgsign", "false");
  }

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("reverts a commit with a new undo commit", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "first");
    const second = await commitFile("b.txt", "b\n", "second");
    const res = await revertCommit(runGit, dir, second);
    assert.deepEqual(res, { reverted: true });
    const { stdout } = await git("log", "--format=%s", "-n", "1");
    assert.match(stdout, /Revert "second"/);
    await assert.rejects(fs.stat(path.join(dir, "b.txt")));
  });

  it("aborts a clashing revert and names the files", async () => {
    await freshRepo();
    const base = await commitFile("f.txt", "base\n", "base");
    await commitFile("f.txt", "main\n", "main change");
    // Reverting base under a conflicting child triggers a conflict.
    const err = await revertCommit(runGit, dir, base).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a conflict error");
    assert.equal(err.conflict, true);
    assert.deepEqual(err.conflictedFiles, ["f.txt"]);
    await assert.rejects(git("rev-parse", "--verify", "REVERT_HEAD"));
  });

  it("refuses dirty trees and suspicious refs", async () => {
    await freshRepo();
    await commitFile("a.txt", "a\n", "first");
    await fs.writeFile(path.join(dir, "a.txt"), "dirty\n");
    await assert.rejects(revertCommit(runGit, dir, "abc"), /not clean/);
    await assert.rejects(revertCommit(runGit, dir, "--evil"), /suspicious ref/);
    await assert.rejects(revertCommit(runGit, undefined, "abc"), /No git repository/);
  });
});

describe("rewrite flows with stubbed git (fast)", () => {
  // Keyed stub: exact `args.join(" ")` -> output (or Error to throw).
  function stubRun(responses = {}) {
    const calls = [];
    const run = async (root, args) => {
      calls.push(args.join(" "));
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

  const SEP = "\x1f";
  const rangeLog = ["aaa", "bbb", "ccc"].join("\n");

  function historyStub(extra = {}) {
    return stubRun({
      "status --porcelain": "",
      "log --reverse --format=%H HEAD": rangeLog,
      [`log --reverse --format=%H${SEP}%P${SEP}%s aaa..HEAD`]: `bbb${SEP}${SEP}second\nccc${SEP}${SEP}third\n`,
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "ccc\n",
      ...extra,
    });
  }

  it("error shapes carry conflict flags and file lists", () => {
    const r = new RebaseConflictError("stop", ["f.txt"]);
    assert.equal(r.conflict, true);
    assert.deepEqual(r.conflictedFiles, ["f.txt"]);
    const m = new MergeConflictError("stop", []);
    assert.equal(m.conflict, true);
    assert.deepEqual(m.conflictedFiles, []);
  });

  it("executeRewrite validates the spec before touching git", async () => {
    const { run } = historyStub();
    await assert.rejects(executeRewrite(run, "/repo", {}), /Nothing to do/);
    await assert.rejects(
      executeRewrite(run, "/repo", { reword: { hash: "bbb", message: "  " } }),
      /non-empty message/,
    );
    await assert.rejects(
      executeRewrite(run, "/repo", { drop: ["zzz"] }),
      /not in the current branch/,
    );
    await assert.rejects(executeRewrite(run, "/repo", { drop: ["aaa"] }), /root commit/);
  });

  it("executeRewrite refuses merges in range", async () => {
    const { run } = historyStub({
      [`log --reverse --format=%H${SEP}%P${SEP}%s aaa..HEAD`]: `bbb${SEP}aaa xyz${SEP}merge\n`,
    });
    await assert.rejects(executeRewrite(run, "/repo", { drop: ["bbb"] }), /Merge commit/);
  });

  it("rebaseOnto sequences backup then rebase with a inert editor", async () => {
    const { calls, run } = historyStub();
    const res = await rebaseOnto(run, "/repo", "main");
    assert.equal(res.rebased, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\/main-\d+$/);
    assert.ok(calls.includes("status --porcelain"));
    assert.ok(calls.includes("rebase main"));
    await assert.rejects(rebaseOnto(run, "/repo", "  "), /needs a target/);
  });

  it("mergeBranch sequences backup then merge", async () => {
    const { calls, run } = historyStub();
    const res = await mergeBranch(run, "/repo", "feature");
    assert.equal(res.merged, true);
    assert.match(res.backupRef, /^refs\/plegma-backup\//);
    assert.deepEqual(calls.slice(-1), ["merge --no-edit feature"]);
  });

  it("cherryPick, resetTo, and revertCommit run the expected commands", async () => {
    const { calls, run } = historyStub();
    assert.deepEqual((await cherryPick(run, "/repo", "bbb")).picked, true);
    assert.deepEqual((await resetTo(run, "/repo", "aaa", "soft")).reset, true);
    assert.deepEqual((await revertCommit(run, "/repo", "bbb")).reverted, true);
    for (const cmd of ["cherry-pick bbb", "reset --soft aaa", "revert --no-edit bbb"]) {
      assert.ok(calls.includes(cmd), `ran ${cmd}`);
    }
  });

  it("mergeStatus detects MERGE_HEAD via stub", async () => {
    const present = stubRun({ "rev-parse --verify MERGE_HEAD": "abc\n" });
    assert.deepEqual(await mergeStatus(present.run, "/repo"), {
      inProgress: true,
      conflictedFiles: [],
    });
  });

  it("rebaseContinue and rebaseSkip run the expected commands", async () => {
    const { calls, run } = stubRun();
    assert.deepEqual(await rebaseContinue(run, "/repo"), { continued: true });
    assert.deepEqual(await rebaseSkip(run, "/repo"), { skipped: true });
    assert.deepEqual(calls, ["rebase --continue", "rebase --skip"]);
    await assert.rejects(rebaseContinue(run, undefined), /No git repository/);
  });
});
