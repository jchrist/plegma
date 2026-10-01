const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runGit } = require("./cliGit");

// Pure: decide which revisions to show for each side of the diff.
// Returns { oldRev: string|null, oldPath, newRev: string|null, newPath }.
// null rev means "empty side" (file did not exist there).
function resolveDiffSpecs({ sha, parentSha, path: filePath, oldPath, status }) {
  const oldFile = oldPath || filePath;
  switch (status) {
    case "Added":
      return { oldRev: null, oldPath: oldFile, newRev: sha, newPath: filePath };
    case "Deleted":
      return { oldRev: parentSha, oldPath: oldFile, newRev: null, newPath: filePath };
    default:
      // Modified, Renamed, Copied, Unknown: compare parent version with new.
      // Root commits have no parent, so the old side is empty.
      return {
        oldRev: parentSha || null,
        oldPath: oldFile,
        newRev: sha,
        newPath: filePath,
      };
  }
}

async function showRev(repoRoot, rev, filePath, run = runGit) {
  const out = await run(repoRoot, ["show", `${rev}:${filePath}`]);
  return out;
}

function looksBinary(content) {
  return content.includes("\0");
}

async function writeSideFile(baseDir, side, spec, content) {
  const filePath = side === "old" ? spec.oldPath : spec.newPath;
  const safeName = String(filePath || "file").replace(/[/\\]/g, "_") || "file";
  const dir = path.join(baseDir, side);
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, safeName);
  await fs.writeFile(full, content ?? "", "utf8");
  return full;
}

// Open a VS Code diff editor for one file at a commit.
// vscode: the vscode API object (injected for testability).
// run: git runner, defaults to runGit(repoRoot, args).
// Returns { opened: true } or { binary: true } when content is binary.
async function openFileDiff(vscode, repoRoot, spec, deps = {}) {
  const run = deps.run || runGit;
  const tmpBase = deps.tmpBase || os.tmpdir();
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!spec || !spec.sha || !spec.path) {
    throw new Error("openDiff needs { sha, path }.");
  }
  const resolved = resolveDiffSpecs(spec);
  let oldContent = "";
  let newContent = "";
  if (resolved.oldRev) {
    try {
      oldContent = await showRev(repoRoot, resolved.oldRev, resolved.oldPath, run);
    } catch (err) {
      // Parent may not contain the path (e.g. rename across parents) — empty side.
      if (
        !/exists|does not exist|bad default revision|ambiguous argument/i.test(err.message || "")
      ) {
        throw err;
      }
      oldContent = "";
    }
  }
  if (resolved.newRev) {
    try {
      newContent = await showRev(repoRoot, resolved.newRev, resolved.newPath, run);
    } catch (err) {
      if (
        !/exists|does not exist|bad default revision|ambiguous argument/i.test(err.message || "")
      ) {
        throw err;
      }
      newContent = "";
    }
  }
  if (looksBinary(oldContent) || looksBinary(newContent)) {
    return { binary: true };
  }
  const dir = await fs.mkdtemp(path.join(tmpBase, "plegma-diff-"));
  const oldFile = await writeSideFile(dir, "old", resolved, oldContent);
  const newFile = await writeSideFile(dir, "new", resolved, newContent);
  const { Uri } = vscode;
  const short = String(spec.sha).slice(0, 7);
  const title = `${spec.path} (${short}^ ↔ ${short})`;
  await vscode.commands.executeCommand("vscode.diff", Uri.file(oldFile), Uri.file(newFile), title);
  return { opened: true };
}

// Open a VS Code diff editor comparing one file at a commit with the
// current working-copy version. Deleted files have no local version.
async function openLocalDiff(vscode, repoRoot, spec, deps = {}) {
  const run = deps.run || runGit;
  const tmpBase = deps.tmpBase || os.tmpdir();
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!spec || !spec.sha || !spec.path) {
    throw new Error("openLocalDiff needs { sha, path }.");
  }
  if (spec.status === "Deleted") {
    throw new Error("Deleted files have no local version to compare.");
  }
  let revContent = "";
  try {
    revContent = await showRev(repoRoot, spec.sha, spec.path, run);
  } catch (err) {
    if (!/exists|does not exist|bad default revision|ambiguous argument/i.test(err.message || "")) {
      throw err;
    }
    revContent = "";
  }
  if (looksBinary(revContent)) {
    return { binary: true };
  }
  const dir = await fs.mkdtemp(path.join(tmpBase, "plegma-local-"));
  const revFile = await writeSideFile(dir, "old", { oldPath: spec.path }, revContent);
  const { Uri } = vscode;
  const short = String(spec.sha).slice(0, 7);
  const title = `${spec.path} (${short} ↔ local)`;
  await vscode.commands.executeCommand(
    "vscode.diff",
    Uri.file(revFile),
    Uri.file(path.join(repoRoot, spec.path)),
    title,
  );
  return { opened: true };
}

// Open a read-only snapshot of one file at a commit ("View File at this
// Revision"). Files deleted at that revision have no content to show.
async function openFileAtRevision(vscode, repoRoot, spec, deps = {}) {
  const run = deps.run || runGit;
  const tmpBase = deps.tmpBase || os.tmpdir();
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!spec || !spec.sha || !spec.path) {
    throw new Error("openFileAtRevision needs { sha, path }.");
  }
  let content = "";
  try {
    content = await showRev(repoRoot, spec.sha, spec.path, run);
  } catch (err) {
    if (!/exists|does not exist|bad default revision|ambiguous argument/i.test(err.message || "")) {
      throw err;
    }
    throw new Error(`File not found at that revision: ${spec.path}`);
  }
  if (looksBinary(content)) {
    return { binary: true };
  }
  const dir = await fs.mkdtemp(path.join(tmpBase, "plegma-file-"));
  const full = await writeSideFile(dir, "rev", { newPath: spec.path }, content);
  const { Uri } = vscode;
  await vscode.commands.executeCommand("vscode.open", Uri.file(full));
  return { opened: true };
}

// Open the working-copy version of a file ("Open File").
async function openWorkingFile(vscode, repoRoot, spec) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!spec || !spec.path) {
    throw new Error("openWorkingFile needs { path }.");
  }
  if (String(spec.path).includes("..")) {
    throw new Error(`Refusing to open outside the repository: ${spec.path}`);
  }
  const { Uri } = vscode;
  await vscode.commands.executeCommand("vscode.open", Uri.file(path.join(repoRoot, spec.path)));
  return { opened: true };
}

// Restore one working-copy file to its content at a commit, without
// touching the index. Refuses Deleted files (no revision content) and
// binary content (stdout decoding would corrupt it).
// Returns { reverted: true } or { binary: true }.
async function revertFileToRevision(repoRoot, spec, deps = {}) {
  const run = deps.run || runGit;
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!spec || !spec.sha || !spec.path) {
    throw new Error("revertFile needs { sha, path }.");
  }
  if (spec.status === "Deleted") {
    throw new Error("Deleted files have no revision content to restore.");
  }
  if (spec.path.includes("..")) {
    throw new Error(`Refusing to write outside the repository: ${spec.path}`);
  }
  let revContent = "";
  try {
    revContent = await showRev(repoRoot, spec.sha, spec.path, run);
  } catch (err) {
    if (!/exists|does not exist|bad default revision|ambiguous argument/i.test(err.message || "")) {
      throw err;
    }
    throw new Error(`File not found at that revision: ${spec.path}`);
  }
  if (looksBinary(revContent)) {
    return { binary: true };
  }
  const full = path.join(repoRoot, spec.path);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, revContent, "utf8");
  return { reverted: true };
}

module.exports = {
  resolveDiffSpecs,
  openFileDiff,
  openLocalDiff,
  openFileAtRevision,
  openWorkingFile,
  revertFileToRevision,
};
