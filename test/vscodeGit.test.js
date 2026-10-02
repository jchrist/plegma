import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { probeVscodeGitApi, HybridGitService } from "../src/git/vscodeGit.js";
import { CliGitService } from "../src/git/cliGit.js";

// A malformed built-in API: commits without hashes, one shapeless branch.
// Reads must ignore it and serve exact CLI data anyway.
function fakeVscodeWithBadApi(calls) {
  const badRepo = {
    async log() {
      return [{ message: "no hash here" }];
    },
    async getBranches() {
      calls.push(["api.getBranches"]);
      return [{ name: "main" }];
    },
    async checkout(ref) {
      calls.push(["api.checkout", ref]);
    },
    async pull() {
      calls.push(["api.pull"]);
    },
    async push() {
      calls.push(["api.push"]);
    },
  };
  return {
    extensions: {
      getExtension: (id) =>
        id === "vscode.git"
          ? {
              isActive: true,
              packageJSON: { version: "x" },
              exports: { getAPI: () => ({ repositories: [badRepo] }) },
            }
          : undefined,
    },
  };
}

function stubRun() {
  const calls = [];
  const run = async (root, args) => {
    calls.push(args.join(" "));
    if (args[0] === "log") {
      return "\x1e" + "abc\x1fp1\x1fA\x1fa@x\x1f123\x1fsub\x1f\x1f\x1f" + "\n";
    }
    if (args[0] === "for-each-ref" && args.includes("refs/heads")) {
      return "refs/heads/main\x1fab12\x1fab12full\x1f\x1f*\x1f";
    }
    if (args[0] === "for-each-ref") {
      return "v1\x1faa11\x1f\x1fcommit\x1f\x1f\x1fsubject";
    }
    return "";
  };
  return { calls, run };
}

describe("HybridGitService with malformed built-in API", () => {
  it("serves reads from CLI despite bad API data", async () => {
    const apiCalls = [];
    const { run } = stubRun();
    const svc = new HybridGitService(fakeVscodeWithBadApi(apiCalls), "/repo");
    svc.cli = new CliGitService("/repo", run);

    const commits = await svc.listCommits(5);
    assert.deepEqual(
      commits.map((c) => c.hash),
      ["abc"],
    );
    const branches = await svc.listBranches();
    assert.deepEqual(
      branches.map((b) => b.name),
      ["main"],
    );
    assert.equal(branches[0].isHead, true);
    const tags = await svc.listTags();
    assert.deepEqual(tags, [
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
    assert.deepEqual(apiCalls, [], "API reads must not be used");
  });

  it("prefers the API for pull/push but checks out via CLI", async () => {
    const apiCalls = [];
    const { calls, run } = stubRun();
    const svc = new HybridGitService(fakeVscodeWithBadApi(apiCalls), "/repo");
    svc.cli = new CliGitService("/repo", run);
    await svc.checkout("main");
    await svc.pull();
    await svc.push(false);
    assert.deepEqual(apiCalls, [["api.pull"], ["api.push"]]);
    assert.ok(calls.includes("checkout main"), "checkout runs on the CLI service");
  });
});

describe("probeVscodeGitApi", () => {
  it("reports unavailable without the extension", async () => {
    const probe = await probeVscodeGitApi({ extensions: { getExtension: () => undefined } });
    assert.equal(probe.vscodeGitAvailable, false);
    assert.equal(probe.fallback, "cli");
  });

  it("activates an inactive extension and reads capabilities", async () => {
    let activated = false;
    const vscode = {
      extensions: {
        getExtension: (id) =>
          id === "vscode.git"
            ? {
                isActive: false,
                activate: async () => {
                  activated = true;
                },
                packageJSON: { version: "9.9" },
                exports: {
                  getAPI: () => ({
                    repositories: [
                      {
                        log() {},
                        getBranches() {},
                        getTags() {},
                        checkout() {},
                        pull() {},
                        push() {},
                      },
                    ],
                  }),
                },
              }
            : undefined,
      },
    };
    const probe = await probeVscodeGitApi(vscode);
    assert.equal(activated, true);
    assert.equal(probe.vscodeGitAvailable, true);
    assert.equal(probe.vscodeGitVersion, "9.9");
    assert.equal(probe.repositoryCount, 1);
    assert.deepEqual(probe.capabilities, {
      log: true,
      branches: true,
      tags: true,
      checkout: true,
      pull: true,
      push: true,
    });
  });

  it("reports unavailable without an API object", async () => {
    const vscode = {
      extensions: {
        getExtension: () => ({ isActive: true, exports: {} }),
      },
    };
    const probe = await probeVscodeGitApi(vscode);
    assert.equal(probe.vscodeGitAvailable, false);
  });

  it("reports unavailable when the extension host throws", async () => {
    const vscode = {
      extensions: {
        getExtension: () => {
          throw new Error("host down");
        },
      },
    };
    const probe = await probeVscodeGitApi(vscode);
    assert.equal(probe.vscodeGitAvailable, false);
    assert.equal(probe.fallback, "cli");
  });
});

describe("HybridGitService write fallback", () => {
  function throwingApi(calls) {
    return {
      extensions: {
        getExtension: () => ({
          isActive: true,
          packageJSON: {},
          exports: {
            getAPI: () => ({
              repositories: [
                {
                  checkout: async (ref) => {
                    calls.push(["api.checkout", ref]);
                    throw new Error("api down");
                  },
                  pull: async () => {
                    calls.push(["api.pull"]);
                    throw new Error("api down");
                  },
                  push: async () => {
                    calls.push(["api.push"]);
                    throw new Error("api down");
                  },
                },
              ],
            }),
          },
        }),
      },
    };
  }

  it("falls back to CLI when API writes fail", async () => {
    const apiCalls = [];
    const cliCalls = [];
    const run = async (root, args) => {
      cliCalls.push(args.join(" "));
      return "";
    };
    const svc = new HybridGitService(throwingApi(apiCalls), "/repo");
    svc.cli = new CliGitService("/repo", run);
    await svc.checkout("main");
    await svc.pull();
    await svc.push(false);
    assert.deepEqual(apiCalls, [["api.pull"], ["api.push"]]);
    assert.ok(cliCalls.includes("checkout main"), "checkout always runs on CLI");
    assert.ok(cliCalls.includes("pull --ff-only"));
    assert.ok(cliCalls.includes("push"));
  });

  it("force push always goes CLI with a backup", async () => {
    const apiCalls = [];
    const run = async (root, args) => {
      const key = args.join(" ");
      if (key === "rev-parse --abbrev-ref HEAD") {
        return "main\n";
      }
      if (key === "rev-parse HEAD") {
        return "abc\n";
      }
      return "";
    };
    const svc = new HybridGitService(throwingApi(apiCalls), "/repo");
    svc.cli = new CliGitService("/repo", run);
    const backup = await svc.push(true);
    assert.match(backup, /^refs\/plegma-backup\/main-\d+$/);
    assert.deepEqual(apiCalls, [], "API push must not run for force push");
  });

  it("picks the API repo matching this root, never a sibling root", async () => {
    const apiCalls = [];
    const vscode = {
      extensions: {
        getExtension: () => ({
          isActive: true,
          exports: {
            getAPI: () => ({
              repositories: [
                {
                  rootUri: { fsPath: "/other" },
                  pull: async () => {
                    apiCalls.push(["api.pull", "/other"]);
                  },
                },
                {
                  rootUri: { fsPath: "/repo" },
                  pull: async () => {
                    apiCalls.push(["api.pull", "/repo"]);
                  },
                },
              ],
            }),
          },
        }),
      },
    };
    const svc = new HybridGitService(vscode, "/repo");
    svc.cli = new CliGitService("/repo", async () => {
      throw new Error("CLI must not run when the matching API repo exists");
    });
    await svc.pull();
    assert.deepEqual(apiCalls, [["api.pull", "/repo"]]);
  });

  it("falls back to CLI when no API repo matches this root", async () => {
    const apiCalls = [];
    const cliCalls = [];
    const vscode = {
      extensions: {
        getExtension: () => ({
          isActive: true,
          exports: {
            getAPI: () => ({
              repositories: [
                {
                  rootUri: { fsPath: "/other" },
                  pull: async () => {
                    apiCalls.push(["api.pull", "/other"]);
                  },
                },
              ],
            }),
          },
        }),
      },
    };
    const svc = new HybridGitService(vscode, "/repo");
    svc.cli = new CliGitService("/repo", async (root, args) => {
      cliCalls.push(args.join(" "));
      return "";
    });
    await svc.pull();
    assert.deepEqual(apiCalls, [], "wrong-root API repo must not be touched");
    assert.ok(cliCalls.includes("pull --ff-only"), "pull falls back to CLI");
  });
});

describe("HybridGitService CLI-only passthroughs", () => {
  it("delegates every non-hybrid method to the CLI service", async () => {
    const calls = [];
    const run = async (root, args) => {
      const key = args.join(" ");
      calls.push(key);
      if (key === "rev-parse --abbrev-ref HEAD") {
        return "main\n";
      }
      if (key === "rev-parse HEAD") {
        return "abc\n";
      }
      if (key === "log --reverse --format=%H HEAD") {
        return "aaa\nbbb\n";
      }
      if (key.startsWith("log --reverse")) {
        return "aaa\x1f\x1fA\nbbb\x1f\x1fB\n";
      }
      if (key === "worktree list --porcelain") {
        return "";
      }
      if (key === "rev-parse --verify MERGE_HEAD") {
        throw new Error("unknown revision MERGE_HEAD");
      }
      if (key === "status --porcelain") {
        return "";
      }
      if (key.endsWith("@{upstream}")) {
        return "origin/f2\n";
      }
      if (key === "remote") {
        return "origin\n";
      }
      return "";
    };
    const svc = new HybridGitService({ extensions: { getExtension: () => undefined } }, "/repo");
    svc.cli = new CliGitService("/repo", run);
    assert.deepEqual(await svc.listWorktrees(), []);
    await svc.createBranch("f", "aaa");
    await svc.createTag("v1", "aaa");
    await svc.renameBranch("a", "b");
    await svc.deleteBranch("gone");
    assert.deepEqual(await svc.mergeStatus(), { inProgress: false, conflictedFiles: [] });
    assert.deepEqual(await svc.mergeContinue(), { continued: true });
    assert.deepEqual(await svc.mergeAbort(), { aborted: true });
    assert.deepEqual((await svc.cherryPick("bbb")).picked, true);
    assert.deepEqual((await svc.resetTo("aaa", "mixed")).reset, true);
    assert.deepEqual((await svc.revertCommit("bbb")).reverted, true);
    assert.deepEqual((await svc.rewrite({ drop: ["bbb"] })).rewritten, true);
    assert.deepEqual((await svc.rebaseOnto("main")).rebased, true);
    assert.deepEqual(await svc.commitContext(["zz"]), { head: null, commits: {} });
    assert.deepEqual(await svc.rebaseContinue(), { continued: true });
    assert.deepEqual(await svc.rebaseSkip(), { skipped: true });
    assert.deepEqual(await svc.rebaseAbort(), { aborted: true });
    assert.deepEqual(await svc.rebaseStatus(), { inProgress: false, conflictedFiles: [] });
    assert.deepEqual(await svc.updateBranch("f2"), {
      updated: "f2",
      backTo: "main",
      stashed: false,
    });
    assert.deepEqual(await svc.statusFiles(), []);
    assert.deepEqual(await svc.stashPush("wip"), { stashed: true });
    assert.deepEqual(await svc.fileDiff({ sha: "aaa", parentSha: "bbb", path: "f" }), {
      text: "",
      truncated: false,
    });
    assert.deepEqual(await svc.worktreeFileDiff("f"), { text: "" });
    await svc.fetch(true);
    assert.match(await svc.fingerprint(), /^abc\n[0-9a-f]{40}$/);
    for (const cmd of [
      "branch f aaa",
      "tag v1 aaa",
      "branch -m a b",
      "branch -d gone",
      "merge --continue",
      "merge --abort",
      "cherry-pick bbb",
      "reset --mixed aaa",
      "revert --no-edit bbb",
      "fetch --all --prune",
      "checkout f2",
      "pull --ff-only",
      "checkout main",
      "status --porcelain=v1",
      "stash push -u -m wip",
      "diff --no-color --no-ext-diff -M bbb aaa -- f",
      "diff --no-color --no-ext-diff -M HEAD -- f",
      "status --porcelain -- f",
    ]) {
      assert.ok(calls.includes(cmd), `CLI ran ${cmd}`);
    }
  });
});
