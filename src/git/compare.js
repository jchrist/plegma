const path = require("node:path");

// Multi-file diff viewing, mirroring the native graph's "Open Changes"
// and "Compare with ..." flows. The native multi-file diff editor and
// the `git:` revision URIs are provided by the built-in Git extension,
// so these flows need it; every other plegma feature stays pure CLI.

function hasVscodeGit(vscode) {
  try {
    return !!(vscode && vscode.extensions && vscode.extensions.getExtension("vscode.git"));
  } catch {
    return false;
  }
}

function requireVscodeGit(vscode, what) {
  if (!hasVscodeGit(vscode)) {
    throw new Error(
      `${what} needs the built-in Git extension (vscode.git), which is not installed or disabled.`,
    );
  }
}

// Open a commit in the native multi-file diff editor by delegating to
// the built-in git extension's own `git.viewCommit` command (the same
// command behind native "Open Changes").
async function openCommit(vscode, repoRoot, sha) {
  if (!sha) {
    throw new Error("openCommit needs { sha }.");
  }
  requireVscodeGit(vscode, "Open Changes");
  await vscode.commands.executeCommand("git.viewCommit", vscode.Uri.file(repoRoot), sha);
  return { opened: true };
}

function gitFileUri(vscode, repoRoot, relPath, rev) {
  const abs = path.join(repoRoot, relPath);
  const fileUri = vscode.Uri.file(abs);
  return fileUri.with({ scheme: "git", query: JSON.stringify({ path: fileUri.fsPath, ref: rev }) });
}

// Open a native multi-file diff between two revisions:
// title "{old} ↔ {new}", empty diffs reported instead of opened.
async function openCompare(vscode, service, spec) {
  const s = spec || {};
  if (!s.oldRev || !s.newRev) {
    throw new Error("openCompare needs { oldRev, newRev }.");
  }
  requireVscodeGit(vscode, "Compare");
  const files = await service.compareRefs(s.oldRev, s.newRev);
  const oldLabel = s.oldLabel || String(s.oldRev).slice(0, 7);
  const newLabel = s.newLabel || String(s.newRev).slice(0, 7);
  if (!files || files.length === 0) {
    return {
      empty: true,
      message: `There are no changes between "${oldLabel}" and "${newLabel}".`,
    };
  }
  const repoRoot = service.repoRoot;
  const resources = files.map((f) => {
    if (f.status === "Added") {
      return {
        originalUri: undefined,
        modifiedUri: gitFileUri(vscode, repoRoot, f.path, s.newRev),
      };
    }
    if (f.status === "Deleted") {
      return {
        originalUri: gitFileUri(vscode, repoRoot, f.oldPath || f.path, s.oldRev),
        modifiedUri: undefined,
      };
    }
    return {
      originalUri: gitFileUri(vscode, repoRoot, f.oldPath || f.path, s.oldRev),
      modifiedUri: gitFileUri(vscode, repoRoot, f.path, s.newRev),
    };
  });
  const multiDiffSourceUri = vscode.Uri.from({
    scheme: "git-ref-compare",
    path: `${repoRoot}/${s.oldRev}..${s.newRev}`,
  });
  await vscode.commands.executeCommand("_workbench.openMultiDiffEditor", {
    multiDiffSourceUri,
    title: `${oldLabel} ↔ ${newLabel}`,
    resources,
  });
  return { opened: files.length };
}

// Open a native multi-file diff between a revision and the working tree.
// Same resource mapping as openCompare, except the new side is the plain
// working-copy file (no `git:` scheme) instead of another revision.
async function openCompareWorktree(vscode, service, spec) {
  const s = spec || {};
  if (!s.rev) {
    throw new Error("openCompareWorktree needs { rev }.");
  }
  requireVscodeGit(vscode, "Compare with working tree");
  const files = await service.compareWorktree(s.rev);
  const label = s.label || String(s.rev).slice(0, 7);
  if (!files || files.length === 0) {
    return {
      empty: true,
      message: `There are no changes between "${label}" and the working tree.`,
    };
  }
  const repoRoot = service.repoRoot;
  const resources = files.map((f) => {
    const worktreeUri = vscode.Uri.file(path.join(repoRoot, f.path));
    if (f.status === "Added") {
      return { originalUri: undefined, modifiedUri: worktreeUri };
    }
    if (f.status === "Deleted") {
      return {
        originalUri: gitFileUri(vscode, repoRoot, f.oldPath || f.path, s.rev),
        modifiedUri: undefined,
      };
    }
    return {
      originalUri: gitFileUri(vscode, repoRoot, f.oldPath || f.path, s.rev),
      modifiedUri: worktreeUri,
    };
  });
  const multiDiffSourceUri = vscode.Uri.from({
    scheme: "git-worktree-compare",
    path: `${repoRoot}/${s.rev}..worktree`,
  });
  await vscode.commands.executeCommand("_workbench.openMultiDiffEditor", {
    multiDiffSourceUri,
    title: `${label} ↔ working tree`,
    resources,
  });
  return { opened: files.length };
}

module.exports = { hasVscodeGit, openCommit, openCompare, openCompareWorktree };
