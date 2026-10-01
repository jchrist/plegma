// git log --format=%x1e%H%x1f%P%x1f%aN%x1f%aE%x1f%at%x1f%s%x1f%b%x1f%D%x1f%G?%x1f%GS%x1f --numstat
const LOG_FIELD_SEP = "\x1f";
const LOG_RECORD_SEP = "\x1e";

// git prints a commit's `--numstat` block *after* its header, so the record
// separator has to lead the format: with a trailing separator the stats of
// commit N would open the record of commit N+1. The header closes with a
// field separator of its own, which is what splits the stat block off —
// paths never contain a raw \x1f (git escapes those), so the last one in a
// record is always the header's.
function parseNumstat(block) {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of block.split("\n")) {
    const [add, del] = line.split("\t");
    // Binary files report "-\t-\tpath": they count as changed files with no
    // line counts, exactly as git's own summary reports them.
    if (add === undefined || del === undefined || !line.includes("\t")) {
      continue;
    }
    filesChanged++;
    additions += Number.parseInt(add, 10) || 0;
    deletions += Number.parseInt(del, 10) || 0;
  }
  return { filesChanged, additions, deletions };
}

function parseLog(output) {
  const commits = [];
  const records = String(output || "").split(LOG_RECORD_SEP);
  for (const record of records) {
    const headerEnd = record.lastIndexOf(LOG_FIELD_SEP);
    if (headerEnd < 0) {
      continue; // no header terminator: malformed record
    }
    const fields = record.slice(0, headerEnd).split(LOG_FIELD_SEP);
    if (fields.length < 8) {
      continue;
    }
    const [hash, parentsRaw, authorName, authorEmail, tsRaw, subject, body, refsRaw] = fields;
    if (!hash) {
      continue;
    }
    const sigStatus = (fields[8] || "").trim();
    commits.push({
      hash: hash.trim(),
      parents: parentsRaw.trim() ? parentsRaw.trim().split(" ") : [],
      authorName,
      authorEmail,
      timestamp: Number.parseInt(tsRaw, 10) || 0,
      subject,
      body: body.replace(/\n$/, ""),
      refs: refsRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      sigStatus,
      sigSigner: (fields[9] || "").trim(),
      ...parseNumstat(record.slice(headerEnd + 1)),
    });
  }
  return commits;
}

// git for-each-ref --format=%(refname)%x1f%(objectname:short)%x1f%(objectname)%x1f%(*objectname)%x1f%(HEAD)%x1f%(upstream:short)
function parseBranches(output) {
  const branches = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [refname, _short, target, peeled, head, upstream] = line.split("\x1f");
    if (!refname) {
      continue;
    }
    const isRemote = refname.startsWith("refs/remotes/");
    const name = isRemote
      ? refname.replace(/^refs\/remotes\//, "")
      : refname.replace(/^refs\/heads\//, "");
    branches.push({
      name,
      kind: isRemote ? "remote" : "local",
      target: (peeled || target || "").trim(),
      isHead: (head || "").trim() === "*",
      upstream: upstream && upstream.trim() ? upstream.trim() : undefined,
    });
  }
  return dropRedundantRemoteHeads(branches);
}

// `<remote>/HEAD` is a symbolic pointer to that remote's default branch, so
// on every normal clone it sits on exactly the same commit as `origin/main`
// and the row would show the same commit twice with nothing added. Drop it
// whenever another remote-tracking ref shares its commit. A lone `origin/HEAD`
// is kept: then it is the only sign the commit is the remote's default branch,
// and it names no branch of its own.
function dropRedundantRemoteHeads(branches) {
  const remoteTargets = new Set(
    branches.filter((b) => b.kind === "remote" && !isRemoteHeadRef(b.name)).map((b) => b.target),
  );
  const kept = branches.filter(
    (b) => !(b.kind === "remote" && isRemoteHeadRef(b.name) && remoteTargets.has(b.target)),
  );
  return kept.length === branches.length ? branches : kept;
}

function isRemoteHeadRef(name) {
  return /^[^/]+\/HEAD$/.test(name || "");
}

// git for-each-ref --format=%(refname:short)%x1f%(objectname)%x1f%(*objectname)
//   %x1f%(objecttype)%x1f%(taggername)%x1f%(taggeremail:trim)%x1f%(taggerdate:unix)%x1f%(contents)
// The tag object itself carries the annotation; for a lightweight tag
// %(contents) is the tagged commit's message, so it is only kept when
// %(objecttype) says the ref points at a tag object.
function parseTags(output) {
  const tags = [];
  for (const line of String(output || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [name, target, peeled, type, taggerName, taggerEmail, tsRaw, contents] =
      line.split("\x1f");
    if (!name) {
      continue;
    }
    const annotated = String(type || "").trim() === "tag";
    tags.push({
      name: name.trim(),
      target: (peeled || target || "").trim(),
      annotated,
      taggerName: (taggerName || "").trim(),
      taggerEmail: (taggerEmail || "").trim(),
      timestamp: Number.parseInt(tsRaw, 10) || 0,
      message: annotated ? String(contents || "").trim() : "",
    });
  }
  return tags;
}

// git worktree list --porcelain. One block per worktree:
//   worktree <path>\nHEAD <sha>\nbranch refs/heads/<name> | detached | bare\n
// Returns [{ path, hash, branch|null, bare, detached }].
function parseWorktrees(output) {
  const worktrees = [];
  let current = null;
  function flush() {
    if (current && current.path) {
      worktrees.push(current);
    }
    current = null;
  }
  for (const raw of String(output || "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      flush();
      current = { path: value, hash: "", branch: null, bare: false, detached: false };
    } else if (!current) {
      continue;
    } else if (key === "HEAD") {
      current.hash = value;
    } else if (key === "branch") {
      const m = value.match(/^refs\/heads\/(.+)$/);
      current.branch = m ? m[1] : null;
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "bare") {
      current.bare = true;
    }
  }
  flush();
  return worktrees;
}

// git status --porcelain=v1. One line per entry:
//   XY path            (ordinary) | XY orig -> new (renames/copies)
// Returns [{ path, oldPath|null, status }] where status matches the
// parseNameStatus vocabulary plus "Untracked". X is the index state,
// Y the worktree state; the index letter wins unless it is blank (or
// both are '?', which is untracked).
function statusWord(letter) {
  switch (letter) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "?":
      return "Untracked";
    default:
      // M (modified), T (type change), U (unmerged), !, etc.
      return "Modified";
  }
}

function parseStatus(output) {
  const files = [];
  for (const line of String(output || "").split("\n")) {
    if (!line || line.length < 4) {
      continue;
    }
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);
    if (!rest) {
      continue;
    }
    const code = x !== " " && x !== "?" ? x : y;
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) {
      files.push({
        path: rest.slice(arrow + 4),
        oldPath: rest.slice(0, arrow),
        status: statusWord(code),
      });
    } else {
      files.push({ path: rest, status: statusWord(code) });
    }
  }
  return files;
}

// git stash list --format=%H%x1f%gd%x1f%gs%x1f%at
// One line per entry: "<hash> stash@{n} <message> <timestamp>".
// Returns [{ hash, name, message, timestamp }].
function parseStashList(output) {
  const stashes = [];
  for (const line of String(output || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\x1f");
    if (parts.length < 4) {
      continue;
    }
    const hash = parts[0].trim();
    const name = parts[1].trim();
    if (!hash || !name) {
      continue;
    }
    stashes.push({
      hash,
      name,
      message: parts.slice(2, -1).join("\x1f").trim(),
      timestamp: Number.parseInt(parts[parts.length - 1], 10) || 0,
    });
  }
  return stashes;
}

// git diff-tree --no-commit-id --name-status -r <sha>
function parseNameStatus(output) {
  const files = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [code, ...rest] = line.split("\t");
    const statusLetter = code.trim().charAt(0);
    if (statusLetter === "R" || statusLetter === "C") {
      const [oldPath, path] = rest;
      files.push({
        path: path ?? oldPath,
        oldPath,
        status: statusLetter === "R" ? "Renamed" : "Copied",
      });
    } else {
      const path = rest.join("\t");
      files.push({
        path,
        status:
          statusLetter === "A"
            ? "Added"
            : statusLetter === "D"
              ? "Deleted"
              : statusLetter === "M"
                ? "Modified"
                : "Unknown",
      });
    }
  }
  return files;
}

module.exports = {
  LOG_FIELD_SEP,
  LOG_RECORD_SEP,
  parseLog,
  parseBranches,
  parseTags,
  parseNameStatus,
  parseStatus,
  parseStashList,
  parseWorktrees,
};
