import { describe, it, beforeEach, afterEach } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDiffSpecs,
  openFileDiff,
  openLocalDiff,
  openFileAtRevision,
  openWorkingFile,
  revertFileToRevision,
} from "../src/git/diff.js";

describe("resolveDiffSpecs", () => {
  it("maps Added to empty old side", () => {
    assert.deepEqual(
      resolveDiffSpecs({ sha: "abc", parentSha: "p", path: "n.js", status: "Added" }),
      { oldRev: null, oldPath: "n.js", newRev: "abc", newPath: "n.js" },
    );
  });

  it("maps Deleted to empty new side", () => {
    assert.deepEqual(
      resolveDiffSpecs({ sha: "abc", parentSha: "p", path: "g.js", status: "Deleted" }),
      { oldRev: "p", oldPath: "g.js", newRev: null, newPath: "g.js" },
    );
  });

  it("maps Modified in a root commit to empty old side", () => {
    const r = resolveDiffSpecs({ sha: "abc", parentSha: null, path: "a.js", status: "Modified" });
    assert.equal(r.oldRev, null);
    assert.equal(r.newRev, "abc");
  });

  it("uses oldPath for renames", () => {
    const r = resolveDiffSpecs({
      sha: "abc",
      parentSha: "p",
      path: "new.js",
      oldPath: "old.js",
      status: "Renamed",
    });
    assert.equal(r.oldPath, "old.js");
    assert.equal(r.newPath, "new.js");
  });
});

describe("openFileDiff", () => {
  let tmp;
  let vscodeCalls;
  let vscode;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    vscodeCalls = [];
    vscode = {
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: {
        async executeCommand(...args) {
          vscodeCalls.push(args);
        },
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function stubRun(files) {
    // files: { 'rev:path': content }
    return async (_root, args) => {
      assert.equal(args[0], "show");
      const key = args[1];
      if (!(key in files)) {
        throw new Error(`path 'x' does not exist in '${key.split(":")[0]}'`);
      }
      return files[key];
    };
  }

  it("opens vscode.diff with old and new contents", async () => {
    const run = stubRun({ "p:a.js": "old\n", "abc:a.js": "new\n" });
    const res = await openFileDiff(
      vscode,
      "/repo",
      { sha: "abc", parentSha: "p", path: "a.js", status: "Modified" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { opened: true });
    assert.equal(vscodeCalls.length, 1);
    const [cmd, oldUri, newUri, title] = vscodeCalls[0];
    assert.equal(cmd, "vscode.diff");
    assert.match(title, /a\.js \(abc\^ ↔ abc\)/);
    assert.equal(await fs.readFile(oldUri.fsPath, "utf8"), "old\n");
    assert.equal(await fs.readFile(newUri.fsPath, "utf8"), "new\n");
  });

  it("reports binary instead of opening a diff", async () => {
    const run = stubRun({ "p:img.png": "a\0b", "abc:img.png": "c\0d" });
    const res = await openFileDiff(
      vscode,
      "/repo",
      { sha: "abc", parentSha: "p", path: "img.png", status: "Modified" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { binary: true });
    assert.equal(vscodeCalls.length, 0);
  });

  it("throws without a repo root", async () => {
    await assert.rejects(
      openFileDiff(vscode, undefined, { sha: "abc", path: "a.js" }, { tmpBase: tmp }),
      /No git repository/,
    );
  });
});

describe("openLocalDiff", () => {
  let tmp;
  let vscodeCalls;
  let vscode;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    vscodeCalls = [];
    vscode = {
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: {
        async executeCommand(...args) {
          vscodeCalls.push(args);
        },
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function stubRun(files) {
    return async (_root, args) => {
      assert.equal(args[0], "show");
      const key = args[1];
      if (!(key in files)) {
        throw new Error(`path 'x' does not exist in '${key.split(":")[0]}'`);
      }
      return files[key];
    };
  }

  it("diffs the revision content against the working-copy file", async () => {
    const run = stubRun({ "abc:a.js": "committed\n" });
    const res = await openLocalDiff(
      vscode,
      "/repo",
      { sha: "abc", path: "a.js", status: "Modified" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { opened: true });
    assert.equal(vscodeCalls.length, 1);
    const [cmd, revUri, localUri, title] = vscodeCalls[0];
    assert.equal(cmd, "vscode.diff");
    assert.match(title, /a\.js \(abc ↔ local\)/);
    assert.equal(await fs.readFile(revUri.fsPath, "utf8"), "committed\n");
    assert.equal(localUri.fsPath, path.join("/repo", "a.js"));
  });

  it("refuses Deleted files and reports binary", async () => {
    const run = stubRun({ "abc:img.png": "c\0d" });
    await assert.rejects(
      openLocalDiff(
        vscode,
        "/repo",
        { sha: "abc", path: "g.js", status: "Deleted" },
        { run, tmpBase: tmp },
      ),
      /no local version/,
    );
    const res = await openLocalDiff(
      vscode,
      "/repo",
      { sha: "abc", path: "img.png", status: "Modified" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { binary: true });
    assert.equal(vscodeCalls.length, 0);
  });
});

describe("revertFileToRevision", () => {
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("restores the working file to the revision content", async () => {
    await fs.writeFile(path.join(tmp, "a.js"), "local edits\n");
    const run = async () => "committed\n";
    const res = await revertFileToRevision(
      tmp,
      { sha: "abc", path: "a.js", status: "Modified" },
      { run },
    );
    assert.deepEqual(res, { reverted: true });
    assert.equal(await fs.readFile(path.join(tmp, "a.js"), "utf8"), "committed\n");
  });

  it("refuses Deleted, binary, escaping, and incomplete specs", async () => {
    const run = async () => "x\n";
    await assert.rejects(
      revertFileToRevision(tmp, { sha: "abc", path: "g.js", status: "Deleted" }, { run }),
      /no revision content/,
    );
    await assert.rejects(
      revertFileToRevision(tmp, { sha: "abc", path: "../evil.js", status: "Modified" }, { run }),
      /outside the repository/,
    );
    await assert.rejects(
      revertFileToRevision(tmp, { sha: "abc" }, { run }),
      /needs \{ sha, path \}/,
    );
    await assert.rejects(
      revertFileToRevision(undefined, { sha: "a", path: "b" }, { run }),
      /No git repository/,
    );
    const bin = await revertFileToRevision(
      tmp,
      { sha: "abc", path: "img.png", status: "Modified" },
      { run: async () => "c\0d" },
    );
    assert.deepEqual(bin, { binary: true });
  });
});

describe("openFileDiff error paths", () => {
  let tmp;
  let vscode;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    vscode = {
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: { async executeCommand() {} },
    };
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("treats a missing parent path as an empty old side", async () => {
    const run = async (_root, args) => {
      if (args[1].startsWith("p:")) {
        throw new Error("path 'old.js' does not exist in 'p'");
      }
      return "new\n";
    };
    const res = await openFileDiff(
      vscode,
      "/repo",
      { sha: "abc", parentSha: "p", path: "new.js", oldPath: "old.js", status: "Renamed" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { opened: true });
  });

  it("rethrows unexpected git errors instead of swallowing them", async () => {
    const run = async () => {
      throw new Error("boom: disk failure");
    };
    await assert.rejects(
      openFileDiff(
        vscode,
        "/repo",
        { sha: "abc", parentSha: "p", path: "a.js", status: "Modified" },
        { run, tmpBase: tmp },
      ),
      /boom: disk failure/,
    );
  });
});

describe("openFileAtRevision", () => {
  let tmp;
  let vscodeCalls;
  let vscode;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-test-"));
    vscodeCalls = [];
    vscode = {
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: {
        async executeCommand(...args) {
          vscodeCalls.push(args);
        },
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function stubRun(files) {
    return async (_root, args) => {
      assert.equal(args[0], "show");
      const key = args[1];
      if (!(key in files)) {
        throw new Error(`path 'x' does not exist in '${key.split(":")[0]}'`);
      }
      return files[key];
    };
  }

  it("opens the revision content read-only", async () => {
    const run = stubRun({ "abc:a.js": "committed\n" });
    const res = await openFileAtRevision(
      vscode,
      "/repo",
      { sha: "abc", path: "a.js" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { opened: true });
    assert.equal(vscodeCalls.length, 1);
    const [cmd, uri] = vscodeCalls[0];
    assert.equal(cmd, "vscode.open");
    assert.equal(await fs.readFile(uri.fsPath, "utf8"), "committed\n");
  });

  it("reports missing files and binary content", async () => {
    const run = stubRun({ "abc:img.png": "c\0d" });
    await assert.rejects(
      openFileAtRevision(vscode, "/repo", { sha: "abc", path: "gone.js" }, { run, tmpBase: tmp }),
      /not found at that revision/,
    );
    const res = await openFileAtRevision(
      vscode,
      "/repo",
      { sha: "abc", path: "img.png" },
      { run, tmpBase: tmp },
    );
    assert.deepEqual(res, { binary: true });
    assert.equal(vscodeCalls.length, 0);
  });
});

describe("openWorkingFile", () => {
  it("opens the working-copy file", async () => {
    const vscodeCalls = [];
    const vscode = {
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: {
        async executeCommand(...args) {
          vscodeCalls.push(args);
        },
      },
    };
    const res = await openWorkingFile(vscode, "/repo", { path: "src/a.js" });
    assert.deepEqual(res, { opened: true });
    assert.deepEqual(vscodeCalls, [["vscode.open", { fsPath: path.join("/repo", "src/a.js") }]]);
  });

  it("refuses paths outside the repository", async () => {
    const vscode = { Uri: { file: (p) => ({ fsPath: p }) }, commands: {} };
    await assert.rejects(
      openWorkingFile(vscode, "/repo", { path: "../evil.js" }),
      /outside the repository/,
    );
    await assert.rejects(openWorkingFile(vscode, undefined, { path: "a.js" }), /No git repository/);
  });
});
