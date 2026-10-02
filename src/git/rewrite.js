const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runGit, createBackupRef } = require("./cliGit");

// Pure: build an interactive-rebase todo for non-sequential squash.
// entries: [{ hash, subject }] oldest-first, covering base..HEAD.
// squash: hashes to combine (any positions). drop: hashes to remove.
// reword: { hash, message } | null — single commit (or the squash group).
// The squashed group lands at the earliest selected position, in entries order.
function planRewrite(entries, { squash = [], drop = [] } = {}, reword = null) {
  const known = new Set(entries.map((e) => e.hash));
  for (const h of [...squash, ...drop]) {
    if (!known.has(h)) {
      throw new Error(`Commit ${h} is not in the current branch history.`);
    }
  }
  if (reword && !known.has(reword.hash)) {
    throw new Error(`Commit ${reword.hash} is not in the current branch history.`);
  }
  const squashSet = new Set(squash);
  const dropSet = new Set(drop);
  for (const h of squashSet) {
    if (dropSet.has(h)) {
      throw new Error(`Commit ${h} cannot be both squashed and dropped.`);
    }
  }
  const ordered = entries.filter((e) => squashSet.has(e.hash));
  const lines = [];
  let groupMessage = reword && squashSet.has(reword.hash) ? reword.message : null;
  let anchored = ordered.length === 0;
  for (const e of entries) {
    if (dropSet.has(e.hash)) {
      lines.push(`drop ${e.hash} ${e.subject || ""}`.trimEnd());
      continue;
    }
    if (squashSet.has(e.hash)) {
      if (!anchored) {
        anchored = true;
        const verb = groupMessage ? "reword" : "pick";
        lines.push(`${verb} ${e.hash} ${e.subject || ""}`.trimEnd());
        for (const g of ordered.slice(1)) {
          lines.push(`squash ${g.hash}`);
        }
      }
      continue;
    }
    if (reword && e.hash === reword.hash) {
      lines.push(`reword ${e.hash} ${e.subject || ""}`.trimEnd());
      continue;
    }
    lines.push(`pick ${e.hash} ${e.subject || ""}`.trimEnd());
  }
  return { todo: lines.join("\n") + "\n", message: groupMessage };
}

// Shell snippets git runs as GIT_SEQUENCE_EDITOR / GIT_EDITOR.
// git appends the file path, so "$@" is the target file. Needs POSIX sh
// (bundled with standard git installations on Windows; native elsewhere).
function buildSequenceEditor() {
  return `sh -c 'cat "\${PLEGMA_TODO_SRC}" > "$@"' sh`;
}

function buildMessageEditor() {
  return `sh -c 'printf %s "\${PLEGMA_MESSAGE}" > "$@"' sh`;
}

class RebaseConflictError extends Error {
  constructor(message, conflictedFiles) {
    super(message);
    this.name = "RebaseConflictError";
    this.conflictedFiles = conflictedFiles || [];
    this.conflict = true;
  }
}

class MergeConflictError extends Error {
  constructor(message, conflictedFiles) {
    super(message);
    this.name = "MergeConflictError";
    this.conflictedFiles = conflictedFiles || [];
    this.conflict = true;
  }
}

// Untracked files do not count: git refuses to overwrite them on its own.
async function hasTrackedChanges(run, repoRoot) {
  const out = await run(repoRoot, ["status", "--porcelain", "--untracked-files=no"]);
  return out.trim() !== "";
}

async function guardClean(run, repoRoot) {
  if (await hasTrackedChanges(run, repoRoot)) {
    throw new Error("Working tree is not clean. Commit or stash changes first.");
  }
}

// For verbs git offers no --autostash for. Each of them aborts itself on
// failure, so the stash is restored either way.
async function withAutostash(run, repoRoot, label, fn) {
  if (!(await hasTrackedChanges(run, repoRoot))) {
    return fn();
  }
  await run(repoRoot, ["stash", "push", "-m", `plegma: autostash before ${label}`]);
  let stashSha = null;
  try {
    stashSha = (await run(repoRoot, ["rev-parse", "--verify", "refs/stash"])).trim() || null;
  } catch {
    stashSha = null;
  }
  const restore = async () => {
    try {
      await run(repoRoot, ["stash", "pop"]);
      return "";
    } catch (e) {
      const where = stashSha ? `stash ${stashSha.slice(0, 7)}` : "your new stash entry";
      return ` Your uncommitted changes are safe in ${where} (restore failed: ${(e && e.message) || e}). Recover with \`git stash pop\`.`;
    }
  };
  let result;
  try {
    result = await fn();
  } catch (err) {
    const note = await restore();
    if (err && note) {
      err.message = `${err.message}${note}`;
    }
    throw err;
  }
  const note = await restore();
  if (note) {
    throw new Error(`${label} succeeded, but${note.replace(/^ Your/, " your")}`);
  }
  return result;
}

// entries oldest-first with parents, for base..HEAD.
async function readRange(run, repoRoot, base) {
  const SEP = "\x1f";
  const out = await run(repoRoot, [
    "log",
    "--reverse",
    `--format=%H${SEP}%P${SEP}%s`,
    `${base}..HEAD`,
  ]);
  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [hash, parentsRaw, subject] = line.split(SEP);
      return {
        hash: (hash || "").trim(),
        parents: (parentsRaw || "").trim() ? parentsRaw.trim().split(" ") : [],
        subject: subject || "",
      };
    });
}

function guardNoMerges(entries) {
  const merge = entries.find((e) => e.parents.length > 1);
  if (merge) {
    throw new Error(`Merge commit ${merge.hash.slice(0, 7)} in range — not supported in V1.`);
  }
}

async function writeTempFile(content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-rewrite-"));
  const file = path.join(dir, "todo.txt");
  await fs.writeFile(file, content, "utf8");
  return file;
}

async function rebaseStatus(run, repoRoot) {
  try {
    const gitDir = (await run(repoRoot, ["rev-parse", "--git-path", "rebase-merge"])).trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);
    await fs.stat(abs);
    let conflictedFiles = [];
    try {
      const out = await run(repoRoot, ["diff", "--name-only", "--diff-filter=U"]);
      conflictedFiles = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      conflictedFiles = [];
    }
    return { inProgress: true, conflictedFiles };
  } catch {
    return { inProgress: false, conflictedFiles: [] };
  }
}

async function throwIfConflict(run, repoRoot, label) {
  const status = await rebaseStatus(run, repoRoot);
  if (status.inProgress) {
    const files = status.conflictedFiles.length ? `: ${status.conflictedFiles.join(", ")}` : "";
    throw new RebaseConflictError(
      `${label} stopped with conflicts${files}. Resolve them, then Continue, Skip, or Abort.`,
      status.conflictedFiles,
    );
  }
}

// Execute squash/drop/reword on the current branch.
// spec: { squash[], drop[], reword: {hash,message}|null }.
// Returns { rewritten: true, backupRef } or throws RebaseConflictError.
async function executeRewrite(run, repoRoot, spec) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  const squash = spec.squash || [];
  const drop = spec.drop || [];
  const reword = spec.reword || null;
  if (squash.length === 0 && drop.length === 0 && !reword) {
    throw new Error("Nothing to do: select commits to squash, drop, or reword.");
  }
  if (reword && (!reword.message || !reword.message.trim())) {
    throw new Error("Reword needs a non-empty message.");
  }
  if (!spec.autostash) {
    await guardClean(run, repoRoot);
  }
  // Base = parent of the oldest affected commit in HEAD history.
  const allLog = await run(repoRoot, ["log", "--reverse", "--format=%H", "HEAD"]);
  const order = allLog
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const affected = [...squash, ...drop, ...(reword ? [reword.hash] : [])];
  let oldestIdx = Infinity;
  for (const h of affected) {
    const i = order.indexOf(h);
    if (i === -1) {
      throw new Error(`Commit ${h} is not in the current branch history.`);
    }
    oldestIdx = Math.min(oldestIdx, i);
  }
  if (oldestIdx === 0) {
    throw new Error("Cannot rewrite the root commit in V1.");
  }
  const base = order[oldestIdx - 1];
  const entries = await readRange(run, repoRoot, base);
  guardNoMerges(entries);
  const { todo, message } = planRewrite(entries, { squash, drop }, reword);
  const backupRef = await createBackupRef(run, repoRoot);
  const todoFile = await writeTempFile(todo);
  const env = {
    ...process.env,
    GIT_SEQUENCE_EDITOR: buildSequenceEditor(),
    PLEGMA_TODO_SRC: todoFile,
    GIT_EDITOR: message ? buildMessageEditor() : "true",
    ...(message ? { PLEGMA_MESSAGE: message } : {}),
  };
  try {
    await run(repoRoot, ["rebase", "-i", ...(spec.autostash ? ["--autostash"] : []), base], {
      env,
    });
  } catch (err) {
    await throwIfConflict(run, repoRoot, "Rewrite");
    throw err;
  }
  return { rewritten: true, backupRef };
}

async function rebaseOnto(run, repoRoot, upstream, opts = {}) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  if (!upstream || !upstream.trim()) {
    throw new Error("Rebase needs a target branch.");
  }
  const autostash = !!(opts && opts.autostash);
  if (!autostash) {
    await guardClean(run, repoRoot);
  }
  const backupRef = await createBackupRef(run, repoRoot);
  try {
    await run(repoRoot, ["rebase", ...(autostash ? ["--autostash"] : []), upstream.trim()], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    await throwIfConflict(run, repoRoot, `Rebase onto ${upstream.trim()}`);
    throw err;
  }
  return { rebased: true, backupRef };
}

async function rebaseContinue(run, repoRoot) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  try {
    await run(repoRoot, ["rebase", "--continue"], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    await throwIfConflict(run, repoRoot, "Rebase");
    throw err;
  }
  return { continued: true };
}

async function rebaseSkip(run, repoRoot) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  try {
    await run(repoRoot, ["rebase", "--skip"]);
  } catch (err) {
    await throwIfConflict(run, repoRoot, "Rebase");
    throw err;
  }
  return { skipped: true };
}

async function rebaseAbort(run, repoRoot) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  await run(repoRoot, ["rebase", "--abort"]);
  return { aborted: true };
}

async function unmergedFiles(run, repoRoot) {
  try {
    const out = await run(repoRoot, ["diff", "--name-only", "--diff-filter=U"]);
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Merge a branch into the current one. On conflict the merge is left in
// progress and a MergeConflictError carries the conflicted files, so the
// webview banner can offer Continue/Abort.
async function mergeBranch(run, repoRoot, name, opts = {}) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  const target = (name || "").trim();
  if (!target || target.startsWith("-")) {
    throw new Error(`Refusing to merge suspicious ref: ${name}`);
  }
  const autostash = !!(opts && opts.autostash);
  if (!autostash) {
    await guardClean(run, repoRoot);
  }
  const backupRef = await createBackupRef(run, repoRoot);
  try {
    await run(repoRoot, ["merge", ...(autostash ? ["--autostash"] : []), "--no-edit", target], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    const files = await unmergedFiles(run, repoRoot);
    const status = await mergeStatus(run, repoRoot);
    if (status.inProgress) {
      const list = files.length ? `: ${files.join(", ")}` : "";
      throw new MergeConflictError(
        `Merge of ${target} stopped with conflicts${list}. Resolve them, stage, then Continue — or Abort. Backup: ${backupRef}`,
        files,
      );
    }
    throw err;
  }
  return { merged: true, backupRef };
}

// Merge a commit into the current one (native "Merge into current
// branch..."). Shares mergeBranch's conflict flow; the SHA allow-list
// keeps user input from reaching git as a flag or revision expression.
async function mergeCommit(run, repoRoot, sha, opts = {}) {
  const target = (sha || "").trim();
  if (!/^[0-9a-fA-F]{4,40}$/.test(target)) {
    throw new Error(`Refusing to merge suspicious commit: ${sha}`);
  }
  return mergeBranch(run, repoRoot, target, opts);
}

async function mergeStatus(run, repoRoot) {
  try {
    await run(repoRoot, ["rev-parse", "--verify", "MERGE_HEAD"]);
  } catch {
    return { inProgress: false, conflictedFiles: [] };
  }
  return { inProgress: true, conflictedFiles: await unmergedFiles(run, repoRoot) };
}

async function mergeContinue(run, repoRoot) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  try {
    await run(repoRoot, ["merge", "--continue"], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    const status = await mergeStatus(run, repoRoot);
    if (status.inProgress) {
      const files = status.conflictedFiles;
      const list = files.length ? `: ${files.join(", ")}` : "";
      throw new MergeConflictError(`Merge still has conflicts${list}.`, files);
    }
    throw err;
  }
  return { continued: true };
}

async function mergeAbort(run, repoRoot) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  await run(repoRoot, ["merge", "--abort"]);
  return { aborted: true };
}

// Apply one commit onto the current branch. On conflict the pick is
// aborted and a conflict-shaped error lists the files, so the repo is
// never left mid-pick (no cherry-pick banner in V1).
async function cherryPick(run, repoRoot, sha, opts = {}) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  const target = (sha || "").trim();
  if (!target || target.startsWith("-")) {
    throw new Error(`Refusing to cherry-pick suspicious ref: ${sha}`);
  }
  if (opts && opts.autostash) {
    return withAutostash(run, repoRoot, `cherry-pick ${target.slice(0, 7)}`, () =>
      cherryPick(run, repoRoot, target),
    );
  }
  await guardClean(run, repoRoot);
  const backupRef = await createBackupRef(run, repoRoot);
  try {
    await run(repoRoot, ["cherry-pick", target], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    const files = await unmergedFiles(run, repoRoot);
    try {
      await run(repoRoot, ["cherry-pick", "--abort"]);
    } catch {
      // Best effort: abort fails when no pick was in progress.
    }
    const list = files.length ? `: ${files.join(", ")}` : "";
    throw new RebaseConflictError(
      `Cherry-pick of ${target.slice(0, 7)} stopped with conflicts${list}. It was aborted; resolve manually and pick again. Backup: ${backupRef}`,
      files,
    );
  }
  return { picked: true, backupRef };
}

// Move the current branch head to a commit. Mode is soft (HEAD only),
// mixed (HEAD + index, keeps files), or hard (discards all changes).
// Hard requires a clean tree since uncommitted work is unrecoverable;
// every mode takes a backup ref first.
async function resetTo(run, repoRoot, sha, mode, opts = {}) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  const target = (sha || "").trim();
  if (!target || target.startsWith("-")) {
    throw new Error(`Refusing to reset to suspicious ref: ${sha}`);
  }
  const cleanMode = (mode || "mixed").trim();
  if (!["soft", "mixed", "hard"].includes(cleanMode)) {
    throw new Error(`Unknown reset mode: ${mode}`);
  }
  let stashed = false;
  if (cleanMode === "hard") {
    // A hard reset with autostash keeps the changes in a stash instead of
    // discarding them, and deliberately does not restore them.
    if (opts && opts.autostash && (await hasTrackedChanges(run, repoRoot))) {
      await run(repoRoot, ["stash", "push", "-m", `plegma: before reset to ${target.slice(0, 7)}`]);
      stashed = true;
    }
    await guardClean(run, repoRoot);
  }
  const backupRef = await createBackupRef(run, repoRoot);
  await run(repoRoot, ["reset", `--${cleanMode}`, target]);
  return stashed ? { reset: true, backupRef, stashed: true } : { reset: true, backupRef };
}

// Create a new commit that undoes another one. Nothing is destroyed, so
// no backup ref — but conflicts still abort with a conflict-shaped error.
async function revertCommit(run, repoRoot, sha, opts = {}) {
  if (!repoRoot) {
    throw new Error("No git repository found in workspace.");
  }
  const target = (sha || "").trim();
  if (!target || target.startsWith("-")) {
    throw new Error(`Refusing to revert suspicious ref: ${sha}`);
  }
  if (opts && opts.autostash) {
    return withAutostash(run, repoRoot, `revert ${target.slice(0, 7)}`, () =>
      revertCommit(run, repoRoot, target),
    );
  }
  await guardClean(run, repoRoot);
  try {
    await run(repoRoot, ["revert", "--no-edit", target], {
      env: { ...process.env, GIT_EDITOR: "true" },
    });
  } catch (err) {
    const files = await unmergedFiles(run, repoRoot);
    try {
      await run(repoRoot, ["revert", "--abort"]);
    } catch {
      // Best effort: abort fails when no revert was in progress.
    }
    const list = files.length ? `: ${files.join(", ")}` : "";
    throw new RebaseConflictError(
      `Revert of ${target.slice(0, 7)} stopped with conflicts${list}. It was aborted; resolve manually and revert again.`,
      files,
    );
  }
  return { reverted: true };
}

module.exports = {
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
};
