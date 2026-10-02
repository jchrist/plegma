const { findRepoRoot } = require("./cliGit");
const { HybridGitService } = require("./vscodeGit");

function getWorkspaceRoots(vscode) {
  const folders = (vscode.workspace && vscode.workspace.workspaceFolders) || [];
  if (folders.length > 0) {
    return folders.map((f) => f.uri.fsPath);
  }
  return [process.cwd()];
}

async function createGitService(vscode, output) {
  const store = await createRootStore(vscode, output);
  return store.getService();
}

// Multi-root store: one service per repository, one active at a time.
// The webview lists `roots`, switches with `useRoot`, and talks to the
// active service for everything else.
async function createRootStore(vscode, output) {
  const roots = [];
  const services = new Map();
  for (const startDir of getWorkspaceRoots(vscode)) {
    const name = startDir.split("/").pop() || startDir;
    const repoRoot = await findRepoRoot(startDir);
    roots.push({ name, folder: startDir, root: repoRoot || null });
    if (repoRoot && !services.has(repoRoot)) {
      services.set(repoRoot, new HybridGitService(vscode, repoRoot));
    }
  }
  let activeRoot = (roots.find((r) => r.root) || {}).root;
  if (output) {
    try {
      const names = roots.map((r) => `${r.name}=${r.root || "(no repo)"}`).join(", ");
      output.appendLine(`[git-service] roots: ${names}; active=${activeRoot || "(none)"}`);
    } catch {
      // Logging must never break activation.
    }
  }
  return {
    roots,
    getActiveRoot: () => activeRoot,
    useRoot(root) {
      const known = roots.some((r) => r.root === root);
      if (!known) {
        throw new Error(`Unknown repository: ${root}`);
      }
      if (root && !services.has(root)) {
        services.set(root, new HybridGitService(vscode, root));
      }
      activeRoot = root;
      return { root: activeRoot };
    },
    getService() {
      const svc = activeRoot ? services.get(activeRoot) : undefined;
      if (!svc) {
        throw new Error("No git repository selected.");
      }
      return svc;
    },
  };
}

function autostashOpt(args) {
  return { autostash: !!(args && args.autostash) };
}

// Dispatch a { type:'git/request', id, method, args } message to the service.
// Returns the { type:'git/response', ... } object (or null if not a git message).
async function handleGitRequest(service, msg) {
  if (!msg || msg.type !== "git/request") {
    return null;
  }
  const { id, method, args } = msg;
  try {
    let data;
    switch (method) {
      case "probe":
        data = await service.probe();
        break;
      case "log":
        data = await service.listCommits(args && args.limit, {
          author: args && args.author,
          since: args && args.since,
          until: args && args.until,
          path: args && args.path,
          refs: args && args.refs,
          globs: args && args.globs,
          order: args && args.order,
        });
        break;
      case "branches":
        data = await service.listBranches();
        break;
      case "tags":
        data = await service.listTags();
        break;
      case "files":
        data = await service.listCommitFiles(args && args.sha);
        break;
      case "fileDiff":
        data = await service.fileDiff(args || {});
        break;
      case "worktreeFileDiff":
        data = await service.worktreeFileDiff(args && args.path);
        break;
      case "statusFiles":
        data = await service.statusFiles();
        break;
      case "stashList":
        data = await service.stashList();
        break;
      case "stashApply":
        data = await service.stashApply(args && args.name).then(() => ({ ok: true }));
        break;
      case "stashPop":
        data = await service.stashPop(args && args.name).then(() => ({ ok: true }));
        break;
      case "stashDrop":
        data = await service.stashDrop(args && args.name).then(() => ({ ok: true }));
        break;
      case "stashBranch":
        data = await service
          .stashBranch(args && args.branchName, args && args.stashName)
          .then(() => ({ ok: true }));
        break;
      case "stashPush":
        data = await service.stashPush(args && args.message, {
          includeUntracked: args && args.includeUntracked,
        });
        break;
      case "discardWorktree":
        data = await service.discardWorktree(args && args.paths);
        break;
      case "checkout":
        data = await service.checkout(args && args.ref).then(() => ({ ok: true }));
        break;
      case "checkoutDetached":
        data = await service.checkoutDetached(args && args.sha).then(() => ({ ok: true }));
        break;
      case "checkoutTracking":
        data = await service.checkoutTracking(args && args.ref).then(() => ({ ok: true }));
        break;
      case "deleteTag":
        data = await service.deleteTag(args && args.name).then(() => ({ ok: true }));
        break;
      case "pushTag":
        data = await service
          .pushTag(args && args.remote, args && args.name)
          .then(() => ({ ok: true }));
        break;
      case "deleteRemoteBranch":
        data = await service
          .deleteRemoteBranch(args && args.remote, args && args.name)
          .then(() => ({ ok: true }));
        break;
      case "mergeBase": {
        const sha = await service.mergeBase(args && args.a, args && args.b);
        data = { sha };
        break;
      }
      case "compareRefs":
        data = await service.compareRefs(args && args.oldRev, args && args.newRev);
        break;
      case "deleteBranch":
        data = await service
          .deleteBranch(args && args.name, args && args.force)
          .then(() => ({ ok: true }));
        break;
      case "createBranch":
        data = await service
          .createBranch(args && args.name, args && args.startPoint)
          .then(() => ({ ok: true }));
        break;
      case "createTag":
        data = await service
          .createTag(args && args.name, args && args.target)
          .then(() => ({ ok: true }));
        break;
      case "renameBranch":
        data = await service
          .renameBranch(args && args.oldName, args && args.newName)
          .then(() => ({ ok: true }));
        break;
      case "worktrees":
        data = await service.listWorktrees();
        break;
      case "revertFile": {
        const result = await service.revertFileToRevision(args || {});
        if (result && result.binary) {
          throw new Error("Binary file — refusing to rewrite it from decoded output.");
        }
        data = { ok: true };
        break;
      }
      case "pull":
        data = await service.pull().then(() => ({ ok: true }));
        break;
      case "updateBranch":
        data = await service.updateBranch(args && args.name);
        break;
      case "fetch":
        data = await service
          .fetch(args && args.prune, args && args.pruneTags)
          .then(() => ({ ok: true }));
        break;
      case "fingerprint":
        data = await service.fingerprint();
        break;
      case "push": {
        const backupRef = await service.push(args && args.force);
        data = { ok: true };
        if (backupRef) {
          data.backupRef = backupRef;
        }
        break;
      }
      case "pushBranch":
        data = await service.pushBranch(args && args.name, {
          remote: args && args.remote,
          setUpstream: args && args.setUpstream,
          force: args && args.force,
        });
        break;
      case "listRemotes":
        data = await service.listRemotes();
        break;
      case "remoteDetails":
        data = await service.listRemoteDetails();
        break;
      case "addRemote":
        data = await service.addRemote(args && args.name, args && args.url);
        break;
      case "renameRemote":
        data = await service.renameRemote(args && args.oldName, args && args.newName);
        break;
      case "setRemoteUrl":
        data = await service.setRemoteUrl(args && args.name, args && args.url);
        break;
      case "removeRemote":
        data = await service.removeRemote(args && args.name).then(() => ({ ok: true }));
        break;
      case "fetchRemote":
        data = await service.fetchRemote(args && args.name, args && args.prune);
        break;
      case "fetchRemoteBranch":
        data = await service.fetchRemoteBranch(
          args && args.remote,
          args && args.branch,
          args && args.local,
        );
        break;
      case "pullRemoteBranch":
        data = await service.pullRemoteBranch(args && args.remote, args && args.branch);
        break;
      case "rewrite":
        data = await service.rewrite(args || {});
        break;
      case "rebase":
        data = await service.rebaseOnto(args && args.upstream, autostashOpt(args));
        break;
      case "mergeBranch":
        data = await service.mergeBranch(args && args.name, autostashOpt(args));
        break;
      case "mergeCommit":
        data = await service.mergeCommit(args && args.sha, autostashOpt(args));
        break;
      case "mergeContinue":
        data = await service.mergeContinue();
        break;
      case "mergeAbort":
        data = await service.mergeAbort();
        break;
      case "mergeStatus":
        data = await service.mergeStatus();
        break;
      case "cherryPick":
        data = await service.cherryPick(args && args.sha, autostashOpt(args));
        break;
      case "resetTo":
        data = await service.resetTo(args && args.sha, args && args.mode, autostashOpt(args));
        break;
      case "revertCommit":
        data = await service.revertCommit(args && args.sha, autostashOpt(args));
        break;
      case "commitContext":
        data = await service.commitContext(args && args.shas);
        break;
      case "rebaseContinue":
        data = await service.rebaseContinue();
        break;
      case "rebaseSkip":
        data = await service.rebaseSkip();
        break;
      case "rebaseAbort":
        data = await service.rebaseAbort();
        break;
      case "rebaseStatus":
        data = await service.rebaseStatus();
        break;
      default:
        throw new Error(`Unknown git method: ${method}`);
    }
    return { type: "git/response", id, ok: true, data };
  } catch (err) {
    const response = {
      type: "git/response",
      id,
      ok: false,
      error: (err && err.message) || String(err),
    };
    if (err && err.conflict) {
      response.conflict = true;
      response.conflictedFiles = err.conflictedFiles || [];
    }
    if (err && err.notMerged) {
      response.notMerged = true;
    }
    if (err && err.noUpstream) {
      response.noUpstream = true;
    }
    return response;
  }
}

module.exports = { createGitService, createRootStore, handleGitRequest };
