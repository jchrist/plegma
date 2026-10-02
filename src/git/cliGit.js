const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  LOG_FIELD_SEP,
  LOG_RECORD_SEP,
  parseBranches,
  parseLog,
  parseNameStatus,
  parseStatus,
  parseStashList,
  parseTags,
  parseWorktrees,
} = require("./parsers");

const execFileAsync = promisify(execFile);

// Empty-tree object name, for diffing root commits (which have no parent).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Inline diffs are rendered line-by-line in the webview; cap them so a
// huge generated file cannot freeze the panel.
const MAX_DIFF_LINES = 3000;
const MAX_UNTRACKED_BYTES = 256 * 1024;

function truncateDiff(text) {
  const lines = String(text).split("\n");
  if (lines.length <= MAX_DIFF_LINES) {
    return { text, truncated: false };
  }
  return {
    text:
      lines.slice(0, MAX_DIFF_LINES).join("\n") +
      "\n… (truncated, open the full diff in the editor)",
    truncated: true,
  };
}

function assertSafePath(p) {
  if (
    !p ||
    typeof p !== "string" ||
    !p.trim() ||
    p.startsWith("-") ||
    p.includes("..") ||
    p.includes("\0")
  ) {
    throw new Error(`Refusing to diff suspicious path: ${p}`);
  }
}

function assertSafeRev(r, what) {
  if (!r || typeof r !== "string" || r.startsWith("-")) {
    throw new Error(`Refusing to diff suspicious ref: ${what}`);
  }
}

function assertStashRef(ref) {
  if (!ref || !/^stash@\{\d+\}$/.test(ref)) {
    throw new Error(`Refusing to touch suspicious stash ref: ${ref}`);
  }
}

// Remote names validate like branch names. URLs only need to be
// non-empty and option-safe; spaces are allowed (local paths can have
// them), a leading dash is not.
function assertRemoteName(name, what) {
  const clean = (name || "").trim();
  if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
    throw new Error(`Refusing to ${what} with suspicious remote name: ${name}`);
  }
  return clean;
}

function assertRemoteUrl(url, what) {
  const clean = (url || "").trim();
  if (!clean || clean.startsWith("-")) {
    throw new Error(`Refusing to ${what} with suspicious remote URL: ${url}`);
  }
  return clean;
}

// Author avatar data. Gravatar identifies an author by the MD5 of the
// lower-cased, trimmed email; the webview cannot hash (SubtleCrypto has no
// MD5), so the backend computes it once per log load. Initials come from
// the display name and are the offline fallback.
function avatarFor(name, email) {
  const clean = String(email || "")
    .trim()
    .toLowerCase();
  const hash = clean ? crypto.createHash("md5").update(clean).digest("hex") : "";
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let initials = "";
  if (parts.length >= 2) {
    initials = (parts[0][0] || "") + (parts[parts.length - 1][0] || "");
  } else if (parts.length === 1) {
    initials = parts[0].slice(0, 2);
  }
  initials = initials.toUpperCase();
  return {
    hash,
    initials,
    url: hash ? `https://www.gravatar.com/avatar/${hash}?d=404` : "",
  };
}

// Ref names for `git log <refs...>`. Anything that could be read as an
// option or a revision range is dropped rather than escaped: the caller
// sends names that came from `git for-each-ref`, so a rejected entry is a
// bug, not a user intent.
function normalizeRefs(refs) {
  if (!Array.isArray(refs)) {
    return [];
  }
  const out = [];
  for (const raw of refs) {
    const r = String(raw == null ? "" : raw).trim();
    if (!r) {
      continue;
    }
    if (r.startsWith("-") || /[\s~^:?*[\\]|\.\./.test(r) || r.includes("..")) {
      continue;
    }
    if (!out.includes(r)) {
      out.push(r);
    }
  }
  return out;
}

// Ref glob patterns for `git log --glob=<pattern>`. Only fully-qualified
// `refs/...` patterns are accepted: the caller expands user shorthand.
function normalizeGlobs(patterns) {
  const list = Array.isArray(patterns)
    ? patterns
    : String(patterns || "")
        .split(/[,\s]+/)
        .filter(Boolean);
  const out = [];
  for (const raw of list) {
    const p = String(raw == null ? "" : raw).trim();
    if (!p) {
      continue;
    }
    if (!/^refs\/[A-Za-z0-9._/-]+(\*[A-Za-z0-9._/-]*)?$/.test(p) || p.includes("..")) {
      continue;
    }
    if (!out.includes(p)) {
      out.push(p);
    }
  }
  return out;
}

async function runGit(repoRoot, args, opts) {
  const cwd = repoRoot || process.cwd();
  const { env: optEnv, ...rest } = opts || {};
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    // Fail fast instead of hanging forever: the extension host has no TTY,
    // so any credential prompt would block until the webview gives up and
    // reports a cryptic timeout. This turns it into a real git error.
    // The 25s kill is a backstop so a wedged git still answers before the
    // webview's 30s request timeout fires. Caller env (e.g. GIT_EDITOR for
    // rewrite flows) is preserved.
    timeout: 25000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...optEnv },
    ...rest,
  });
  return stdout;
}

async function findRepoRoot(startDir) {
  try {
    const out = await runGit(startDir, ["rev-parse", "--show-toplevel"]);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Create a recovery ref before a destructive push, e.g.
// refs/plegma-backup/main-1700000000000 -> <head sha>.
// Returns the full ref name. Exported for unit tests.
async function createBackupRef(run, repoRoot) {
  const branch = (await run(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const sha = (await run(repoRoot, ["rev-parse", "HEAD"])).trim();
  const safeBranch = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
  const ref = `refs/plegma-backup/${safeBranch}-${Date.now()}`;
  await run(repoRoot, ["update-ref", ref, sha]);
  return ref;
}

class CliGitService {
  constructor(repoRoot, run) {
    this.repoRoot = repoRoot;
    this.run = run || runGit;
  }

  async probe() {
    return {
      vscodeGitAvailable: false,
      capabilities: {
        log: true,
        branches: true,
        tags: true,
        files: true,
        checkout: true,
        pull: true,
        push: true,
      },
      fallback: "cli",
    };
  }

  requireRepo() {
    if (!this.repoRoot) {
      throw new Error("No git repository found in workspace.");
    }
  }

  async listCommits(limit = 500, filters = {}) {
    this.requireRepo();
    // The record separator leads the format and a field separator closes
    // the header, so the per-commit `--numstat` block git prints after each
    // header lands inside the same record (see parsers.parseLog).
    const format =
      LOG_RECORD_SEP +
      ["%H", "%P", "%aN", "%aE", "%at", "%s", "%b", "%D", "%G?", "%GS"].join(LOG_FIELD_SEP) +
      LOG_FIELD_SEP;
    const f = filters || {};
    // Exclude the stash and plegma backup refs: they are not branch history,
    // but --all would list their commits as regular rows. Those rows look
    // actionable, yet every rewrite validates against HEAD history and fails
    // with "not in the current branch history". (--exclude applies to the
    // --all that follows it.)
    const args = [
      "log",
      `--format=${format}`,
      // File count and +/- per commit for the hover card's summary line.
      "--numstat",
      "--decorate=full",
      "--exclude=refs/stash",
      "--exclude=refs/plegma-backup/*",
    ];
    // Branch filtering happens here rather than in the webview: the refs
    // are passed to git so the log is built from the selected histories
    // only. An empty or all-invalid list means "everything" (--all).
    const globs = normalizeGlobs(f.globs);
    const refs = normalizeRefs(f.refs);
    if (globs.length > 0) {
      // A pattern replaces the picked refs: git ORs revisions and globs,
      // so mixing them would silently widen the filter.
      for (const g of globs) {
        args.push(`--glob=${g}`);
      }
    } else if (refs.length > 0) {
      args.push(...refs);
    } else {
      args.push("--all");
    }
    // Ordering, all newest-first. Topological is the default because the
    // swimlane graph reads wrong when a parent is listed after its child;
    // date order is looser, author-date follows the author's clock.
    const order = f.order === "date" || f.order === "author-date" ? f.order : "topo";
    if (order === "date") {
      args.push("--date-order");
    } else if (order === "author-date") {
      args.push("--author-date-order");
    } else {
      args.push("--topo-order");
    }
    if (f.author && f.author.trim()) {
      args.push(`--author=${f.author.trim()}`);
    }
    if (f.since && f.since.trim()) {
      args.push(`--since=${f.since.trim()}`);
    }
    if (f.until && f.until.trim()) {
      args.push(`--until=${f.until.trim()}`);
    }
    args.push("-n", String(limit));
    if (f.path && f.path.trim()) {
      args.push("--", f.path.trim());
    }
    const out = await this.run(this.repoRoot, args);
    return parseLog(out).map((c) => ({ ...c, avatar: avatarFor(c.authorName, c.authorEmail) }));
  }

  async listBranches() {
    this.requireRepo();
    const SEP = "\x1f";
    const out = await this.run(this.repoRoot, [
      "for-each-ref",
      `--format=%(refname)${SEP}%(objectname:short)${SEP}%(objectname)${SEP}%(*objectname)${SEP}%(HEAD)${SEP}%(upstream:short)`,
      "refs/heads",
      "refs/remotes",
    ]);
    return parseBranches(out);
  }

  async listTags() {
    this.requireRepo();
    const SEP = "\x1f";
    const out = await this.run(this.repoRoot, [
      "for-each-ref",
      `--format=%(refname:short)${SEP}%(objectname)${SEP}%(*objectname)${SEP}%(objecttype)${SEP}%(taggername)${SEP}%(taggeremail:trim)${SEP}%(taggerdate:unix)${SEP}%(contents)`,
      "refs/tags",
    ]);
    return parseTags(out);
  }

  async listCommitFiles(sha) {
    this.requireRepo();
    if (!sha) {
      throw new Error("Missing commit hash.");
    }
    try {
      await this.run(this.repoRoot, ["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      throw new Error(
        "That commit is no longer in the history — it may have changed underneath the view. Refresh to reload.",
      );
    }
    const out = await this.run(this.repoRoot, [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      "--root",
      "-M",
      sha,
    ]);
    return parseNameStatus(out);
  }

  // Unified diff text of one file at a commit, for the inline panel view.
  // spec: { sha, parentSha|null, path, oldPath?, status? } (same shape as
  // openDiff). Root commits diff against the empty tree. First-parent
  // only; merge-commit combined diffs are out of scope.
  async fileDiff(spec) {
    this.requireRepo();
    const s = spec || {};
    if (!s.sha || !s.path) {
      throw new Error("fileDiff needs { sha, path }.");
    }
    assertSafePath(s.path);
    if (s.oldPath) {
      assertSafePath(s.oldPath);
    }
    assertSafeRev(s.sha, s.sha);
    const parent = s.parentSha || EMPTY_TREE;
    assertSafeRev(parent, parent);
    const out = await this.run(this.repoRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      parent,
      s.sha,
      "--",
      s.path,
    ]);
    if (out.includes("\0")) {
      return { binary: true };
    }
    return truncateDiff(out);
  }

  // Unified diff of one working-copy file against HEAD, for the inline
  // panel view of uncommitted changes. Untracked files are synthesized
  // as all-added from working-copy content.
  async worktreeFileDiff(relPath) {
    this.requireRepo();
    assertSafePath(relPath);
    const out = await this.run(this.repoRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      "HEAD",
      "--",
      relPath,
    ]);
    if (out.includes("\0")) {
      return { binary: true };
    }
    if (out.trim()) {
      return truncateDiff(out);
    }
    const st = await this.run(this.repoRoot, ["status", "--porcelain", "--", relPath]);
    if (!st.startsWith("??")) {
      return { text: "" };
    }
    let buf;
    try {
      buf = await fs.readFile(path.join(this.repoRoot, relPath));
    } catch {
      return { text: "" };
    }
    if (buf.length > MAX_UNTRACKED_BYTES) {
      return { text: "", tooLarge: true };
    }
    if (buf.includes(0)) {
      return { binary: true };
    }
    const content = buf.toString("utf8").replace(/\n$/, "");
    const added = content
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
    return truncateDiff(`--- /dev/null\n+++ b/${relPath}\n${added}\n`);
  }

  // Working-tree file list in listCommitFiles shape, for the
  // uncommitted-changes row and its Files panel listing.
  async statusFiles() {
    this.requireRepo();
    const out = await this.run(this.repoRoot, ["status", "--porcelain=v1"]);
    return parseStatus(out);
  }

  // Stash entries for the graph rows: [{ hash, name, message, timestamp }].
  async stashList() {
    this.requireRepo();
    const SEP = "\x1f";
    const out = await this.run(this.repoRoot, [
      "stash",
      "list",
      `--format=%H${SEP}%gd${SEP}%gs${SEP}%at`,
    ]);
    return parseStashList(out);
  }

  // Stash mutations for the stash rows (native Apply/Pop/Drop/Create-branch).
  // Stash refs are allow-listed to `stash@{n}` so no user input can reach
  // git as a flag or revision expression.
  async stashApply(name) {
    this.requireRepo();
    assertStashRef(name);
    await this.run(this.repoRoot, ["stash", "apply", name]);
  }

  async stashPop(name) {
    this.requireRepo();
    assertStashRef(name);
    await this.run(this.repoRoot, ["stash", "pop", name]);
  }

  async stashDrop(name) {
    this.requireRepo();
    assertStashRef(name);
    await this.run(this.repoRoot, ["stash", "drop", name]);
  }

  async stashBranch(branchName, stashName) {
    this.requireRepo();
    const clean = (branchName || "").trim();
    if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
      throw new Error(`Refusing to create branch with suspicious name: ${branchName}`);
    }
    assertStashRef(stashName);
    await this.run(this.repoRoot, ["stash", "branch", clean, stashName]);
  }

  // Stash the working tree under a message. Untracked files are included
  // unless opts.includeUntracked is false (a settings default).
  // Returns { stashed: true }; git errors surface to the caller.
  async stashPush(message, opts = {}) {
    this.requireRepo();
    const msg = (message && String(message).trim()) || "Plegma: working tree";
    const args = ["stash", "push"];
    if (opts.includeUntracked !== false) {
      args.push("-u");
    }
    args.push("-m", msg);
    await this.run(this.repoRoot, args);
    return { stashed: true };
  }

  // Discard uncommitted working-tree changes. Destructive and
  // unrecoverable — the webview confirms before calling.
  // paths: optional array of repo-relative paths to discard; when omitted,
  // every uncommitted change is dropped (tracked changes via reset --hard,
  // untracked files via clean -fd).
  async discardWorktree(paths) {
    this.requireRepo();
    if (paths === undefined || paths === null) {
      await this.run(this.repoRoot, ["reset", "--hard", "HEAD"]);
      await this.run(this.repoRoot, ["clean", "-fd"]);
      return { discarded: true };
    }
    const list = Array.isArray(paths) ? paths : [paths];
    if (list.length === 0) {
      throw new Error("discardWorktree needs at least one path, or no paths to discard all.");
    }
    for (const p of list) {
      assertSafePath(p);
    }
    // restore only knows tracked paths (it errors on untracked ones) while
    // clean only removes untracked ones, so split first: restore what git
    // knows, clean everything (a no-op for tracked paths).
    const lsOut = await this.run(this.repoRoot, ["ls-files", "--", ...list]);
    const known = new Set(
      lsOut
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const tracked = list.filter((p) => known.has(p));
    if (tracked.length > 0) {
      await this.run(this.repoRoot, [
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        ...tracked,
      ]);
    }
    await this.run(this.repoRoot, ["clean", "-f", "--", ...list]);
    return { discarded: list };
  }

  async checkout(ref) {
    this.requireRepo();
    await this.run(this.repoRoot, ["checkout", ref]);
  }

  // Detached checkout of a commit (native "Checkout (Detached)").
  async checkoutDetached(sha) {
    this.requireRepo();
    assertSafeRev(sha, sha);
    await this.run(this.repoRoot, ["checkout", "--detach", sha]);
  }

  // Check out a remote branch as a new local tracking branch
  // (native "Checkout" on a remote ref): `git checkout --track <ref>`.
  async checkoutTracking(ref) {
    this.requireRepo();
    if (!ref || typeof ref !== "string" || ref.startsWith("-") || /\s/.test(ref)) {
      throw new Error(`Refusing to track suspicious ref: ${ref}`);
    }
    await this.run(this.repoRoot, ["checkout", "--track", ref]);
  }

  async deleteTag(name) {
    this.requireRepo();
    const clean = (name || "").trim();
    if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
      throw new Error(`Refusing to delete tag with suspicious name: ${name}`);
    }
    await this.run(this.repoRoot, ["tag", "-d", clean]);
  }

  // Push a tag to a remote (native Push Tag...): explicit `tag` refspec
  // so only the tag is pushed.
  async pushTag(remote, name) {
    this.requireRepo();
    const cleanRemote = (remote || "").trim();
    const cleanName = (name || "").trim();
    if (!cleanRemote || cleanRemote.startsWith("-") || /\s/.test(cleanRemote)) {
      throw new Error(`Refusing to push to suspicious remote: ${remote}`);
    }
    if (!cleanName || cleanName.startsWith("-") || /\s/.test(cleanName)) {
      throw new Error(`Refusing to push tag with suspicious name: ${name}`);
    }
    await this.run(this.repoRoot, ["push", cleanRemote, "tag", cleanName]);
  }

  // Delete a branch from its remote (native remote-branch delete):
  // `git push <remote> --delete <name>`.
  async deleteRemoteBranch(remote, name) {
    this.requireRepo();
    const cleanRemote = (remote || "").trim();
    const cleanName = (name || "").trim();
    for (const n of [cleanRemote, cleanName]) {
      if (!n || n.startsWith("-") || /\s/.test(n) || n.includes("..")) {
        throw new Error(`Refusing to delete remote branch with suspicious name: ${remote}/${name}`);
      }
    }
    await this.run(this.repoRoot, ["push", cleanRemote, "--delete", cleanName]);
  }

  // How each commit relates to HEAD, so the menu offers only the history
  // verbs git would accept: no cherry-pick of what HEAD already has, no
  // revert or rewrite of what it does not.
  async commitContext(shas) {
    this.requireRepo();
    const list = (Array.isArray(shas) ? shas : [])
      .map((s) => String(s == null ? "" : s).trim())
      .filter((s) => /^[0-9a-fA-F]{4,64}$/.test(s))
      .slice(0, 50);
    let head = null;
    try {
      head = (await this.run(this.repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim();
    } catch {
      head = null;
    }
    head = head || null;
    const commits = {};
    for (const sha of list) {
      commits[sha] = head
        ? await this.relationToHead(sha)
        : { inHead: false, applied: false, mergesSince: 0 };
    }
    return { head, commits };
  }

  async relationToHead(sha) {
    const count = async (args) => {
      try {
        return Number((await this.run(this.repoRoot, args)).trim()) || 0;
      } catch {
        return 0;
      }
    };
    let inHead = false;
    try {
      await this.run(this.repoRoot, ["merge-base", "--is-ancestor", sha, "HEAD"]);
      inHead = true;
    } catch {
      inHead = false;
    }
    if (inHead) {
      return {
        inHead,
        applied: false,
        mergesSince: await count(["rev-list", "--count", "--merges", `${sha}..HEAD`]),
      };
    }
    let applied = false;
    try {
      const parents = (await this.run(this.repoRoot, ["rev-list", "--parents", "-n", "1", sha]))
        .trim()
        .split(/\s+/)
        .slice(1);
      // git cherry hashes the patch of every HEAD-only commit; past this many
      // it is too slow to run on a right-click.
      if (
        parents.length === 1 &&
        (await count(["rev-list", "--count", "--no-merges", `${sha}..HEAD`])) <= 2000
      ) {
        const out = await this.run(this.repoRoot, ["cherry", "HEAD", sha, `${sha}^`]);
        applied = out.split("\n").some((l) => l.startsWith("-"));
      }
    } catch {
      applied = false;
    }
    return { inHead, applied, mergesSince: 0 };
  }

  // Merge base of two revisions (native "Compare with Merge Base").
  async mergeBase(a, b) {
    this.requireRepo();
    assertSafeRev(a, a);
    assertSafeRev(b, b);
    return (await this.run(this.repoRoot, ["merge-base", a, b])).trim();
  }

  // Changed files between two revisions, in listCommitFiles shape, for
  // the compare flows (native "Compare with Remote/Merge Base/Ref").
  async compareRefs(oldRev, newRev) {
    this.requireRepo();
    assertSafeRev(oldRev, oldRev);
    assertSafeRev(newRev, newRev);
    const out = await this.run(this.repoRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      "--name-status",
      oldRev,
      newRev,
    ]);
    return parseNameStatus(out);
  }

  // Changed files between a revision and the working tree, same shape as
  // compareRefs. Added = new in the worktree, Deleted = gone from it.
  async compareWorktree(rev) {
    this.requireRepo();
    assertSafeRev(rev, rev);
    const out = await this.run(this.repoRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      "--name-status",
      rev,
    ]);
    return parseNameStatus(out);
  }

  async createBranch(name, startPoint) {
    this.requireRepo();
    const clean = (name || "").trim();
    if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
      throw new Error(`Refusing to create branch with suspicious name: ${name}`);
    }
    if (startPoint && startPoint.startsWith("-")) {
      throw new Error(`Refusing to branch from suspicious ref: ${startPoint}`);
    }
    const args = ["branch", clean];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.run(this.repoRoot, args);
  }

  async renameBranch(oldName, newName) {
    this.requireRepo();
    const cleanOld = (oldName || "").trim();
    const cleanNew = (newName || "").trim();
    for (const n of [cleanOld, cleanNew]) {
      if (!n || n.startsWith("-") || /\s/.test(n)) {
        throw new Error(`Refusing to rename branch with suspicious name: ${n}`);
      }
    }
    await this.run(this.repoRoot, ["branch", "-m", cleanOld, cleanNew]);
  }

  async createTag(name, target) {
    this.requireRepo();
    const clean = (name || "").trim();
    if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
      throw new Error(`Refusing to create tag with suspicious name: ${name}`);
    }
    if (target && target.startsWith("-")) {
      throw new Error(`Refusing to tag suspicious ref: ${target}`);
    }
    const args = ["tag", clean];
    if (target) {
      args.push(target);
    }
    await this.run(this.repoRoot, args);
  }

  // Safe delete only (-d): refuses unmerged branches and surfaces
  // git's message so the webview can show it. Pass force=true to delete
  // with -D instead (used after an explicit user confirmation). When the
  // branch is checked
  // out in a linked worktree, that worktree is removed first
  // (`git worktree remove` also deletes the worktree directory; its safe
  // form refuses dirty worktrees).
  async deleteBranch(name, force = false) {
    this.requireRepo();
    if (!name || name.startsWith("-")) {
      throw new Error(`Refusing to delete suspicious branch name: ${name}`);
    }
    const root = path.resolve(this.repoRoot);
    const worktrees = await this.listWorktrees();
    const wt = worktrees.find((w) => w.branch === name && path.resolve(w.path) !== root);
    if (wt) {
      await this.run(this.repoRoot, ["worktree", "remove", wt.path]);
    }
    const flag = force ? "-D" : "-d";
    try {
      await this.run(this.repoRoot, ["branch", flag, name]);
    } catch (e) {
      if (!force && /not fully merged/i.test((e && e.message) || "")) {
        const err = new Error(
          `Branch '${name}' is not fully merged (typical after a squash-merge).`,
        );
        err.notMerged = true;
        throw err;
      }
      throw e;
    }
  }

  async listWorktrees() {
    this.requireRepo();
    const out = await this.run(this.repoRoot, ["worktree", "list", "--porcelain"]);
    return parseWorktrees(out);
  }

  async pull() {
    this.requireRepo();
    await this.run(this.repoRoot, ["pull", "--ff-only"]);
  }

  // Pull one remote branch into the current branch
  // (`git pull <remote> <branch>`). Like pull() this is --ff-only: a
  // diverged history fails loudly instead of creating a surprise merge.
  async pullRemoteBranch(remote, branch) {
    this.requireRepo();
    const cleanRemote = assertRemoteName(remote, "pull remote branch from");
    const cleanBranch = (branch || "").trim();
    if (!cleanBranch || cleanBranch.startsWith("-") || /\s/.test(cleanBranch)) {
      throw new Error(`Refusing to pull suspicious branch: ${branch}`);
    }
    await this.run(this.repoRoot, ["pull", "--ff-only", cleanRemote, cleanBranch]);
    return { pulled: `${cleanRemote}/${cleanBranch}` };
  }

  // Update a branch in place with one-click stash handling: when the
  // working tree is dirty it is stashed first (including untracked
  // files, so checkout cannot trip over them either), then the branch
  // is checked out, pulled --ff-only, and checked back from. The stash
  // is popped last. A failed pop keeps the stash entry, so every
  // failure message names where the changes are, how to get them back,
  // and which branch is checked out.
  async updateBranch(name) {
    this.requireRepo();
    if (!name || name.startsWith("-")) {
      throw new Error(`Refusing to update suspicious branch name: ${name}`);
    }
    // Preflight before touching the working tree or switching branches:
    // pull --ff-only has nothing to fetch when the branch tracks no
    // upstream (typical for a freshly created local branch) or when the
    // repo has no remotes at all. Fail fast with a clear message instead
    // of churning through stash/checkout/pull and reporting the raw
    // git error afterwards.
    let upstream = "";
    try {
      upstream = (
        await this.run(this.repoRoot, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          `${name}@{upstream}`,
        ])
      ).trim();
    } catch {
      upstream = "";
    }
    if (!upstream) {
      let remotes = "";
      try {
        remotes = (await this.run(this.repoRoot, ["remote"])).trim();
      } catch {
        remotes = "";
      }
      if (!remotes) {
        const err = new Error(
          `Cannot update '${name}': no git remotes are configured, so there is nothing to pull from.`,
        );
        err.noUpstream = true;
        throw err;
      }
      const err = new Error(
        `Cannot update '${name}': it has no upstream branch configured, so there is nothing to pull. Push it first (e.g. \`git push -u origin ${name}\`) or set an upstream.`,
      );
      err.noUpstream = true;
      throw err;
    }
    const dirty = (await this.run(this.repoRoot, ["status", "--porcelain"])).trim() !== "";
    let stashSha = null;
    if (dirty) {
      try {
        await this.stashPush(`plegma: update ${name}`);
      } catch (e) {
        throw new Error(
          `Update ${name} failed before switching branches: cannot stash local changes (${(e && e.message) || e}). No branches were switched.`,
        );
      }
      try {
        stashSha = (await this.run(this.repoRoot, ["rev-parse", "--verify", "refs/stash"])).trim();
        if (!stashSha) {
          stashSha = null;
        }
      } catch {
        stashSha = null;
      }
    }
    const stashRef = stashSha ? `stash ${stashSha.slice(0, 7)}` : "your new stash entry";
    const recoverHint =
      "Recover with `git stash pop`, or inspect with `git stash show -p stash@{0}`.";
    let backTo = null;
    try {
      backTo = (await this.run(this.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      backTo = null;
    }
    if (backTo === "HEAD") {
      backTo = null; // detached: nothing to check back to
    }
    const currentBranch = async () => {
      try {
        return (await this.run(this.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      } catch {
        return "unknown";
      }
    };
    const restoreStash = async () => {
      if (!dirty) {
        return { restored: true };
      }
      try {
        await this.run(this.repoRoot, ["stash", "pop"]);
        return { restored: true };
      } catch (e) {
        return { restored: false, error: (e && e.message) || String(e) };
      }
    };
    try {
      await this.run(this.repoRoot, ["checkout", name]);
      await this.run(this.repoRoot, ["pull", "--ff-only"]);
      if (backTo && backTo !== name) {
        await this.run(this.repoRoot, ["checkout", backTo]);
      }
    } catch (e) {
      const where = await currentBranch();
      const r = await restoreStash();
      const restored = r.restored
        ? " Your stashed changes were restored."
        : ` Your pre-update changes are safe in ${stashRef} (restore failed: ${r.error}). ${recoverHint}`;
      throw new Error(
        `Update ${name} failed: ${(e && e.message) || e} You are on '${where}'.${restored}`,
      );
    }
    const r = await restoreStash();
    if (!r.restored) {
      throw new Error(
        `Updated ${name}, but could not restore your stashed changes (${r.error}). ` +
          `Your changes are safe in ${stashRef}. ${recoverHint}`,
      );
    }
    const data = { updated: name, stashed: dirty };
    if (backTo && backTo !== name) {
      data.backTo = backTo;
    }
    return data;
  }

  async fetch(prune = false, pruneTags = false) {
    this.requireRepo();
    const args = ["fetch", "--all"];
    if (prune) {
      args.push("--prune");
    }
    if (pruneTags) {
      args.push("--prune-tags");
    }
    await this.run(this.repoRoot, args);
  }

  // Cheap history identity for change detection: HEAD plus a hash of all
  // ref tips, the worktree list, and the working-tree status. Kept tiny
  // (your repo may have thousands of tags) since the webview polls it
  // every few seconds. The status digest is what refreshes the
  // uncommitted-changes row as files are edited.
  async fingerprint() {
    this.requireRepo();
    const crypto = require("node:crypto");
    const head = await this.run(this.repoRoot, ["rev-parse", "HEAD"]);
    const refs = await this.run(this.repoRoot, ["for-each-ref", "--format=%(objectname)"]);
    let worktrees = "";
    try {
      worktrees = await this.run(this.repoRoot, ["worktree", "list", "--porcelain"]);
    } catch {
      // Worktree listing must never break change detection.
    }
    let statusOut = "";
    try {
      statusOut = await this.run(this.repoRoot, ["status", "--porcelain"]);
    } catch {
      // Status must never break change detection either.
    }
    const digest = crypto
      .createHash("sha1")
      .update(refs)
      .update(worktrees)
      .update(statusOut)
      .digest("hex");
    return `${head.trim()}\n${digest}`;
  }

  // Remotes for push flows (names only; full management below).
  async listRemotes() {
    this.requireRepo();
    const out = await this.run(this.repoRoot, ["remote"]);
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Full remote management: list with URLs, add, rename, set-url, remove,
  // and single-remote fetch. Names validate like branch names; URLs must
  // be non-empty and must not read as an option (a leading dash).
  async listRemoteDetails() {
    this.requireRepo();
    const out = await this.run(this.repoRoot, ["remote", "-v"]);
    const byName = new Map();
    for (const line of out.split("\n")) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/);
      if (!m) {
        continue;
      }
      const name = m[1];
      if (!byName.has(name)) {
        byName.set(name, { name, fetchUrl: "", pushUrl: "" });
      }
      const rec = byName.get(name);
      if (m[3] === "fetch") {
        rec.fetchUrl = m[2];
      } else {
        rec.pushUrl = m[2];
      }
    }
    return [...byName.values()];
  }

  async addRemote(name, url) {
    this.requireRepo();
    const clean = assertRemoteName(name, "add remote");
    const target = assertRemoteUrl(url, "add remote");
    await this.run(this.repoRoot, ["remote", "add", clean, target]);
    return { added: clean };
  }

  async renameRemote(oldName, newName) {
    this.requireRepo();
    const from = assertRemoteName(oldName, "rename remote");
    const to = assertRemoteName(newName, "rename remote");
    await this.run(this.repoRoot, ["remote", "rename", from, to]);
    return { renamed: to };
  }

  async setRemoteUrl(name, url) {
    this.requireRepo();
    const clean = assertRemoteName(name, "set remote URL for");
    const target = assertRemoteUrl(url, "set remote URL for");
    await this.run(this.repoRoot, ["remote", "set-url", clean, target]);
    return { updated: clean };
  }

  async removeRemote(name) {
    this.requireRepo();
    const clean = assertRemoteName(name, "remove remote");
    await this.run(this.repoRoot, ["remote", "remove", clean]);
    return { removed: clean };
  }

  async fetchRemote(name, prune = false) {
    this.requireRepo();
    const clean = assertRemoteName(name, "fetch from remote");
    const args = ["fetch", clean];
    if (prune) {
      args.push("--prune");
    }
    await this.run(this.repoRoot, args);
    return { fetched: clean };
  }

  // Fetch one remote branch into a local branch
  // (`git fetch <remote> <branch>:<local>`, defaulting to the same-named
  // local branch). The in-place fast-forward behind Update on branches
  // other than the checked-out one: no checkout, no stash, the working
  // tree is never touched, and git itself refuses non-fast-forwards.
  // Refuses when that local branch is checked out: git would reject the
  // fetch into HEAD with a cryptic error, so say it plainly first.
  async fetchRemoteBranch(remote, branch, localBranch) {
    this.requireRepo();
    const cleanRemote = assertRemoteName(remote, "fetch remote branch from");
    const cleanBranch = (branch || "").trim();
    if (!cleanBranch || cleanBranch.startsWith("-") || /\s/.test(cleanBranch)) {
      throw new Error(`Refusing to fetch suspicious branch: ${branch}`);
    }
    const cleanLocal = localBranch === undefined ? cleanBranch : String(localBranch || "").trim();
    if (!cleanLocal || cleanLocal.startsWith("-") || /\s/.test(cleanLocal)) {
      throw new Error(`Refusing to fetch into suspicious branch: ${localBranch}`);
    }
    let current = "";
    try {
      current = (await this.run(this.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      current = "";
    }
    if (current && current !== "HEAD" && current === cleanLocal) {
      throw new Error(
        `Cannot fetch into '${cleanLocal}': it is currently checked out. Switch branches first.`,
      );
    }
    await this.run(this.repoRoot, ["fetch", cleanRemote, `${cleanBranch}:${cleanLocal}`]);
    return { fetched: cleanLocal };
  }

  // Push a branch (native Push Branch...). The caller resolves the remote
  // (upstream's remote, single remote, or user-picked); the backend keeps
  // a defensive fallback. Plain pushes run without confirmation; force
  // pushes create a backup ref first and use --force-with-lease.
  async pushBranch(name, opts = {}) {
    this.requireRepo();
    const clean = (name || "").trim();
    if (!clean || clean.startsWith("-") || /\s/.test(clean)) {
      throw new Error(`Refusing to push suspicious branch name: ${name}`);
    }
    const o = opts || {};
    let remote = (o.remote && String(o.remote).trim()) || "";
    if (remote && (remote.startsWith("-") || /\s/.test(remote))) {
      throw new Error(`Refusing to push to suspicious remote: ${o.remote}`);
    }
    const force = !!o.force;
    let setUpstream = !!o.setUpstream;
    let current = "";
    try {
      current = (await this.run(this.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      current = "";
    }
    const isCurrent = current !== "" && current !== "HEAD" && current === clean;
    let upstream = "";
    try {
      upstream = (
        await this.run(this.repoRoot, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          `${clean}@{upstream}`,
        ])
      ).trim();
    } catch {
      upstream = "";
    }
    if (!remote) {
      if (isCurrent && upstream && !force && !setUpstream) {
        // Config-faithful plain push of the current branch.
        await this.run(this.repoRoot, ["push"]);
        return { pushed: clean };
      }
      if (upstream && upstream.includes("/")) {
        remote = upstream.slice(0, upstream.indexOf("/"));
      } else {
        const remotes = await this.listRemotes();
        if (remotes.length === 0) {
          const err = new Error(`Cannot push '${clean}': no git remotes are configured.`);
          err.noUpstream = true;
          throw err;
        }
        if (remotes.length > 1) {
          throw new Error(
            `Cannot push '${clean}': it has no upstream and there are multiple remotes (${remotes.join(", ")}).`,
          );
        }
        remote = remotes[0];
        if (!upstream) {
          setUpstream = true;
        }
      }
    }
    const args = ["push"];
    let backupRef = null;
    if (force) {
      const sha = (await this.run(this.repoRoot, ["rev-parse", clean])).trim();
      const safeBranch = clean.replace(/[^A-Za-z0-9._-]+/g, "-");
      backupRef = `refs/plegma-backup/${safeBranch}-${Date.now()}`;
      await this.run(this.repoRoot, ["update-ref", backupRef, sha]);
      args.push("--force-with-lease");
    }
    if (setUpstream) {
      args.push("--set-upstream");
    }
    args.push(remote, clean);
    await this.run(this.repoRoot, args);
    return backupRef ? { pushed: clean, backupRef } : { pushed: clean };
  }

  // Returns the backup ref name when force is true, else undefined.
  async push(force = false) {
    this.requireRepo();
    if (!force) {
      await this.run(this.repoRoot, ["push"]);
      return undefined;
    }
    const backupRef = await createBackupRef(this.run, this.repoRoot);
    await this.run(this.repoRoot, ["push", "--force-with-lease"]);
    return backupRef;
  }

  // History rewrite + rebase flows live in ./rewrite and always use the
  // injected runner, so unit tests can stub git.
  async revertFileToRevision(spec) {
    const { revertFileToRevision } = require("./diff");
    return revertFileToRevision(this.repoRoot, spec, { run: this.run });
  }

  async rewrite(spec) {
    const { executeRewrite } = require("./rewrite");
    return executeRewrite(this.run, this.repoRoot, spec);
  }

  async rebaseOnto(upstream, opts) {
    const { rebaseOnto } = require("./rewrite");
    return rebaseOnto(this.run, this.repoRoot, upstream, opts);
  }

  async rebaseContinue() {
    const { rebaseContinue } = require("./rewrite");
    return rebaseContinue(this.run, this.repoRoot);
  }

  async rebaseSkip() {
    const { rebaseSkip } = require("./rewrite");
    return rebaseSkip(this.run, this.repoRoot);
  }

  async rebaseAbort() {
    const { rebaseAbort } = require("./rewrite");
    return rebaseAbort(this.run, this.repoRoot);
  }

  async rebaseStatus() {
    const { rebaseStatus } = require("./rewrite");
    return rebaseStatus(this.run, this.repoRoot);
  }

  async mergeBranch(name, opts) {
    const { mergeBranch } = require("./rewrite");
    return mergeBranch(this.run, this.repoRoot, name, opts);
  }

  async mergeCommit(sha, opts) {
    const { mergeCommit } = require("./rewrite");
    return mergeCommit(this.run, this.repoRoot, sha, opts);
  }

  async mergeStatus() {
    const { mergeStatus } = require("./rewrite");
    return mergeStatus(this.run, this.repoRoot);
  }

  async mergeContinue() {
    const { mergeContinue } = require("./rewrite");
    return mergeContinue(this.run, this.repoRoot);
  }

  async mergeAbort() {
    const { mergeAbort } = require("./rewrite");
    return mergeAbort(this.run, this.repoRoot);
  }

  async cherryPick(sha, opts) {
    const { cherryPick } = require("./rewrite");
    return cherryPick(this.run, this.repoRoot, sha, opts);
  }

  async resetTo(sha, mode, opts) {
    const { resetTo } = require("./rewrite");
    return resetTo(this.run, this.repoRoot, sha, mode, opts);
  }

  async revertCommit(sha, opts) {
    const { revertCommit } = require("./rewrite");
    return revertCommit(this.run, this.repoRoot, sha, opts);
  }
}

module.exports = {
  runGit,
  findRepoRoot,
  createBackupRef,
  normalizeRefs,
  normalizeGlobs,
  CliGitService,
};
