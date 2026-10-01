const { CliGitService } = require("./cliGit");

// Best-effort adapter over the built-in vscode.git extension API.
// The API is unversioned/unstable, so every access is defensive.
// Anything missing falls back per-method to CLI.

async function probeVscodeGitApi(vscode) {
  const fallback = {
    vscodeGitAvailable: false,
    capabilities: {},
    fallback: "cli",
  };
  try {
    const ext = vscode.extensions.getExtension("vscode.git");
    if (!ext) {
      return fallback;
    }
    if (!ext.isActive) {
      await ext.activate();
    }
    const api = ext.exports && ext.exports.getAPI ? ext.exports.getAPI(1) : null;
    if (!api) {
      return fallback;
    }
    const repos = api.repositories || [];
    const repo = repos[0];
    const caps = {
      log: !!repo && (typeof repo.log === "function" || typeof repo.getCommits === "function"),
      branches: !!repo && typeof repo.getBranches === "function",
      tags: !!repo && typeof repo.getTags === "function",
      checkout: !!repo && typeof repo.checkout === "function",
      pull: !!repo && typeof repo.pull === "function",
      push: !!repo && typeof repo.push === "function",
    };
    return {
      vscodeGitAvailable: true,
      vscodeGitVersion: ext.packageJSON && ext.packageJSON.version,
      repositoryCount: repos.length,
      capabilities: caps,
      fallback: "cli",
    };
  } catch {
    return fallback;
  }
}

function getApiRepo(vscode, repoRoot) {
  try {
    const ext = vscode.extensions.getExtension("vscode.git");
    const api = ext && ext.exports && ext.exports.getAPI ? ext.exports.getAPI(1) : null;
    const repos = (api && api.repositories) || [];
    if (repos.length === 0) {
      return null;
    }
    if (!repoRoot) {
      return repos[0] || null;
    }
    const norm = String(repoRoot).replace(/\/+$/, "");
    const match = repos.find((r) => {
      try {
        const p = r && r.rootUri && (r.rootUri.fsPath || r.rootUri.path);
        return !!p && String(p).replace(/\/+$/, "") === norm;
      } catch {
        return false;
      }
    });
    if (match) {
      return match;
    }
    // Repos expose roots but none match this service: never write to the
    // wrong repo (silent success on another root). Fall back to CLI.
    if (repos.some((r) => r && r.rootUri)) {
      return null;
    }
    return repos[0] || null;
  } catch {
    return null;
  }
}

class HybridGitService {
  constructor(vscode, repoRoot) {
    this.vscode = vscode;
    this.repoRoot = repoRoot;
    this.cli = new CliGitService(repoRoot);
  }

  async probe() {
    const probe = await probeVscodeGitApi(this.vscode);
    // CLI always covers everything; vscode.git covers what it exposes.
    const cliCaps = await this.cli.probe();
    return {
      ...probe,
      capabilities: { ...cliCaps.capabilities, ...probe.capabilities },
      fallback: "cli",
    };
  }

  pickRepo() {
    return getApiRepo(this.vscode, this.repoRoot);
  }

  async listCommits(limit = 500, filters = {}) {
    // Reads always go CLI: it is exact (full hashes, all refs) and fast.
    // The built-in API shape varies across versions and has produced
    // truncated data here before, so it is not trusted for reads.
    return this.cli.listCommits(limit, filters);
  }

  async listBranches() {
    // See listCommits: CLI-only for reads.
    return this.cli.listBranches();
  }

  async listTags() {
    // See listCommits: CLI-only for reads.
    return this.cli.listTags();
  }

  listCommitFiles(sha) {
    return this.cli.listCommitFiles(sha);
  }

  fileDiff(spec) {
    // Diff text for the inline panel view; always CLI.
    return this.cli.fileDiff(spec);
  }

  worktreeFileDiff(relPath) {
    return this.cli.worktreeFileDiff(relPath);
  }

  statusFiles() {
    return this.cli.statusFiles();
  }

  stashList() {
    return this.cli.stashList();
  }

  stashApply(name) {
    return this.cli.stashApply(name);
  }

  stashPop(name) {
    return this.cli.stashPop(name);
  }

  stashDrop(name) {
    return this.cli.stashDrop(name);
  }

  stashBranch(branchName, stashName) {
    return this.cli.stashBranch(branchName, stashName);
  }

  stashPush(message, opts) {
    return this.cli.stashPush(message, opts);
  }

  discardWorktree(paths) {
    return this.cli.discardWorktree(paths);
  }

  // vscode.git exposes no rewrite/rebase verbs — always CLI.
  rewrite(spec) {
    return this.cli.rewrite(spec);
  }

  rebaseOnto(upstream) {
    return this.cli.rebaseOnto(upstream);
  }

  rebaseContinue() {
    return this.cli.rebaseContinue();
  }

  rebaseSkip() {
    return this.cli.rebaseSkip();
  }

  rebaseAbort() {
    return this.cli.rebaseAbort();
  }

  rebaseStatus() {
    return this.cli.rebaseStatus();
  }

  mergeBranch(name) {
    return this.cli.mergeBranch(name);
  }

  mergeCommit(sha) {
    return this.cli.mergeCommit(sha);
  }

  mergeStatus() {
    return this.cli.mergeStatus();
  }

  mergeContinue() {
    return this.cli.mergeContinue();
  }

  mergeAbort() {
    return this.cli.mergeAbort();
  }

  cherryPick(sha) {
    return this.cli.cherryPick(sha);
  }

  resetTo(sha, mode) {
    return this.cli.resetTo(sha, mode);
  }

  revertCommit(sha) {
    return this.cli.revertCommit(sha);
  }

  async checkout(ref) {
    // Branch switching must be exact; always CLI. The built-in API resolves
    // fine for single-root workspaces, but in multi-root it can report
    // success against the wrong repo while this root never switches — the
    // webview then shows "Checked out X" with nothing changed.
    return this.cli.checkout(ref);
  }

  deleteBranch(name, force = false) {
    return this.cli.deleteBranch(name, force);
  }

  checkoutDetached(sha) {
    return this.cli.checkoutDetached(sha);
  }

  checkoutTracking(ref) {
    return this.cli.checkoutTracking(ref);
  }

  deleteTag(name) {
    return this.cli.deleteTag(name);
  }

  pushTag(remote, name) {
    return this.cli.pushTag(remote, name);
  }

  deleteRemoteBranch(remote, name) {
    return this.cli.deleteRemoteBranch(remote, name);
  }

  mergeBase(a, b) {
    return this.cli.mergeBase(a, b);
  }

  compareRefs(oldRev, newRev) {
    return this.cli.compareRefs(oldRev, newRev);
  }

  createBranch(name, startPoint) {
    return this.cli.createBranch(name, startPoint);
  }

  createTag(name, target) {
    return this.cli.createTag(name, target);
  }

  renameBranch(oldName, newName) {
    return this.cli.renameBranch(oldName, newName);
  }

  revertFileToRevision(spec) {
    return this.cli.revertFileToRevision(spec);
  }

  listWorktrees() {
    return this.cli.listWorktrees();
  }

  async pull() {
    const repo = this.pickRepo();
    if (repo && typeof repo.pull === "function") {
      try {
        await repo.pull();
        return;
      } catch {
        // Fall through.
      }
    }
    return this.cli.pull();
  }

  updateBranch(name) {
    // Branch switching must be exact; always CLI.
    return this.cli.updateBranch(name);
  }

  fetch(prune = false, pruneTags = false) {
    return this.cli.fetch(prune, pruneTags);
  }

  fingerprint() {
    return this.cli.fingerprint();
  }

  listRemotes() {
    return this.cli.listRemotes();
  }

  listRemoteDetails() {
    return this.cli.listRemoteDetails();
  }

  addRemote(name, url) {
    return this.cli.addRemote(name, url);
  }

  renameRemote(oldName, newName) {
    return this.cli.renameRemote(oldName, newName);
  }

  setRemoteUrl(name, url) {
    return this.cli.setRemoteUrl(name, url);
  }

  removeRemote(name) {
    return this.cli.removeRemote(name);
  }

  fetchRemote(name, prune) {
    return this.cli.fetchRemote(name, prune);
  }

  fetchRemoteBranch(remote, branch, local) {
    return this.cli.fetchRemoteBranch(remote, branch, local);
  }

  pullRemoteBranch(remote, branch) {
    return this.cli.pullRemoteBranch(remote, branch);
  }

  pushBranch(name, opts) {
    return this.cli.pushBranch(name, opts);
  }

  async push(force = false) {
    const repo = this.pickRepo();
    if (!force && repo && typeof repo.push === "function") {
      try {
        await repo.push();
        return;
      } catch {
        // Fall through.
      }
    }
    return this.cli.push(force);
  }
}

module.exports = { probeVscodeGitApi, HybridGitService };
