import { describe, it, beforeAll, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRootStore } from "../src/git/index.js";

const ex = promisify(execFile);

describe("createRootStore", () => {
  let repoDir;
  let plainDir;

  function fakeVscode(...dirs) {
    return {
      workspace: {
        workspaceFolders: dirs.map((d) => ({ uri: { fsPath: d } })),
      },
    };
  }

  beforeAll(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-root-a-"));
    plainDir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-root-b-"));
    await ex("git", ["init", "-b", "main", "--quiet"], { cwd: repoDir });
    await ex("git", ["config", "user.email", "t@t"], { cwd: repoDir });
    await ex("git", ["config", "user.name", "t"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "f.txt"), "x\n");
    await ex("git", ["add", "f.txt"], { cwd: repoDir });
    await ex("git", ["commit", "-m", "init", "--quiet"], { cwd: repoDir });
  });

  afterAll(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(plainDir, { recursive: true, force: true });
  });

  it("lists one entry per workspace folder with detected roots", async () => {
    const store = await createRootStore(fakeVscode(repoDir, plainDir));
    assert.equal(store.roots.length, 2);
    assert.equal(store.roots[0].root, repoDir);
    assert.equal(store.roots[1].root, null);
  });

  it("activates the first repository by default", async () => {
    const store = await createRootStore(fakeVscode(plainDir, repoDir));
    assert.equal(store.getActiveRoot(), repoDir);
  });

  it("switches active root and serves from it", async () => {
    const store = await createRootStore(fakeVscode(repoDir, plainDir));
    assert.deepEqual(store.useRoot(repoDir), { root: repoDir });
    const commits = await store.getService().listCommits(5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, "init");
  });

  it("rejects unknown roots", async () => {
    const store = await createRootStore(fakeVscode(repoDir));
    assert.throws(() => store.useRoot("/nope"), /Unknown repository/);
  });

  it("reports no repository when none is selected", async () => {
    const store = await createRootStore(fakeVscode(plainDir));
    assert.equal(store.getActiveRoot(), undefined);
    assert.throws(() => store.getService(), /No git repository selected/);
  });
});
