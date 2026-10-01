import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  LOG_FIELD_SEP,
  LOG_RECORD_SEP,
  parseLog,
  parseBranches,
  parseTags,
  parseNameStatus,
  parseStatus,
  parseStashList,
  parseWorktrees,
} from "../src/git/parsers.js";

// Mirrors what `git log --format=%x1e<fields>%x1f --numstat` prints for one
// commit: a leading record separator, the header fields, the field separator
// that ends the header, then the stat block git appends after the header.
function logRecord(fields, statLines = []) {
  const stats = statLines.length ? `\n\n${statLines.join("\n")}\n` : "\n";
  return `${LOG_RECORD_SEP}${fields.join(LOG_FIELD_SEP)}${LOG_FIELD_SEP}${stats}`;
}

describe("parseLog", () => {
  it("parses a single commit with parents and refs", () => {
    const out = logRecord([
      "abc123",
      "p1 p2",
      "Jane",
      "j@x.com",
      "1700000000",
      "my subject",
      "my body",
      "HEAD -> main, origin/main",
    ]);
    const [c] = parseLog(out);
    assert.equal(c.hash, "abc123");
    assert.deepEqual(c.parents, ["p1", "p2"]);
    assert.equal(c.authorName, "Jane");
    assert.equal(c.timestamp, 1700000000);
    assert.deepEqual(c.refs, ["HEAD -> main", "origin/main"]);
  });

  it("parses a root commit with no parents or refs", () => {
    const out = logRecord(["abc", "", "A", "a@x", "123", "s", "", ""]);
    const [c] = parseLog(out);
    assert.deepEqual(c.parents, []);
    assert.deepEqual(c.refs, []);
  });

  it("parses signature status and signer", () => {
    const out = logRecord([
      "abc123",
      "",
      "Jane",
      "j@x.com",
      "1700000000",
      "s",
      "",
      "",
      "G",
      "Jane Doe <jane@x.com>",
    ]);
    const [c] = parseLog(out);
    assert.equal(c.sigStatus, "G");
    assert.equal(c.sigSigner, "Jane Doe <jane@x.com>");
  });

  it("defaults signature fields for older or unsigned records", () => {
    const [c] = parseLog(logRecord(["abc", "", "A", "a@x", "1", "s", "", ""]));
    assert.equal(c.sigStatus, "");
    assert.equal(c.sigSigner, "");
  });

  it("returns empty for empty output", () => {
    assert.deepEqual(parseLog(""), []);
    assert.deepEqual(parseLog("\n"), []);
  });

  it("skips malformed records", () => {
    assert.deepEqual(parseLog(`short${LOG_FIELD_SEP}record${LOG_RECORD_SEP}`), []);
  });

  it("counts changed files and added/removed lines from the numstat block", () => {
    const out = logRecord(
      ["abc123", "p1", "Jane", "j@x.com", "1700000000", "s", "", ""],
      ["3\t1\tsrc/a.js", "10\t0\tsrc/b.js", "0\t4\tsrc/c.js"],
    );
    const [c] = parseLog(out);
    assert.equal(c.filesChanged, 3);
    assert.equal(c.additions, 13);
    assert.equal(c.deletions, 5);
  });

  it("counts a binary file as changed with no line counts", () => {
    // git prints "-\t-\tpath" for a file with no textual diff.
    const out = logRecord(
      ["abc123", "", "Jane", "j@x.com", "1", "s", "", ""],
      ["-\t-\tlogo.png", "2\t0\tsrc/a.js"],
    );
    const [c] = parseLog(out);
    assert.equal(c.filesChanged, 2);
    assert.equal(c.additions, 2);
    assert.equal(c.deletions, 0);
  });

  it("reports zero stats for a commit with no diff (a merge)", () => {
    const out = logRecord(["abc123", "p1 p2", "Jane", "j@x.com", "1", "s", "", ""]);
    const [c] = parseLog(out);
    assert.deepEqual(
      { filesChanged: c.filesChanged, additions: c.additions, deletions: c.deletions },
      { filesChanged: 0, additions: 0, deletions: 0 },
    );
  });

  it("keeps stats with their own commit across a multi-record log", () => {
    // The record separator leads the format precisely so a stat block never
    // drifts onto the next commit's record.
    const out =
      logRecord(["a1", "", "Jane", "j@x.com", "2", "first", "", ""], ["1\t0\ta.txt"]) +
      logRecord(
        ["b2", "a1", "Jane", "j@x.com", "1", "second", "body line", ""],
        ["5\t5\tb.txt", "0\t2\tc.txt"],
      );
    const [first, second] = parseLog(out);
    assert.deepEqual(
      [first.hash, first.filesChanged, first.additions],
      ["a1", 1, 1],
      "the older commit keeps its own stat block",
    );
    assert.deepEqual(
      [second.hash, second.filesChanged, second.additions, second.deletions],
      ["b2", 2, 5, 7],
    );
    assert.equal(second.body, "body line", "a multi-line body stays intact");
  });

  it("keeps a signer that contains a newline out of the stat block", () => {
    const out = logRecord(
      ["abc123", "", "Jane", "j@x.com", "1", "s", "", "", "G", "Good signature from Jane\nDOE"],
      ["1\t1\ta.txt"],
    );
    const [c] = parseLog(out);
    assert.equal(c.sigSigner, "Good signature from Jane\nDOE");
    assert.equal(c.filesChanged, 1);
    assert.equal(c.additions, 1);
  });
});

describe("parseBranches", () => {
  it("distinguishes local, remote, head, and upstream", () => {
    const out = [
      "refs/heads/main\x1fab12\x1fab12full\x1f\x1f*\x1f",
      "refs/heads/feat\x1fcd34\x1fcd34full\x1f\x1f\x1forigin/main",
      "refs/remotes/origin/main\x1fef56\x1fef56full\x1f\x1f\x1f",
    ].join("\n");
    const branches = parseBranches(out);
    assert.equal(branches.length, 3);
    assert.deepEqual(branches[0], {
      name: "main",
      kind: "local",
      target: "ab12full",
      isHead: true,
      upstream: undefined,
    });
    assert.equal(branches[1].upstream, "origin/main");
    assert.equal(branches[1].isHead, false);
    assert.equal(branches[2].kind, "remote");
    assert.equal(branches[2].name, "origin/main");
  });

  it("prefers peeled target for annotated refs", () => {
    const out = "refs/heads/x\x1faa\x1fcommitsha\x1fpeeledsha\x1f\x1f";
    const [b] = parseBranches(out);
    assert.equal(b.target, "peeledsha");
  });

  it("drops origin/HEAD when it just repeats another remote ref", () => {
    const out = [
      "refs/heads/main\x1fab12\x1fab12full\x1f\x1f*\x1f",
      "refs/remotes/origin/HEAD\x1fef56\x1fef56full\x1f\x1f\x1f",
      "refs/remotes/origin/main\x1fef56\x1fef56full\x1f\x1f\x1f",
      "refs/remotes/origin/next\x1fcd34\x1fcd34full\x1f\x1f\x1f",
    ].join("\n");
    const branches = parseBranches(out);
    assert.deepEqual(
      branches.map((b) => b.name),
      ["main", "origin/main", "origin/next"],
      "the symbolic HEAD adds nothing next to origin/main",
    );
  });

  it("keeps a remote HEAD that stands alone", () => {
    const out = [
      "refs/remotes/origin/HEAD\x1fef56\x1fef56full\x1f\x1f\x1f",
      "refs/remotes/origin/main\x1fab12\x1fab12full\x1f\x1f\x1f",
    ].join("\n");
    assert.deepEqual(
      parseBranches(out).map((b) => b.name),
      ["origin/HEAD", "origin/main"],
      "no duplicate commit, so it still names the remote's default",
    );
  });

  it("does not let a remote HEAD stand in for an upstream remote", () => {
    const out = [
      "refs/remotes/upstream/HEAD\x1fef56\x1fef56full\x1f\x1f\x1f",
      "refs/remotes/origin/main\x1fef56\x1fef56full\x1f\x1f\x1f",
    ].join("\n");
    assert.deepEqual(
      parseBranches(out).map((b) => b.name),
      ["origin/main"],
    );
  });
});

describe("parseTags", () => {
  it("parses light and annotated tags with their annotation", () => {
    const out = [
      ["v1", "aa11", "", "commit", "", "", "", "the commit subject"].join("\x1f"),
      ["v2", "bb22", "cc33", "tag", "Ada", "ada@x", "1700000000", "Release notes"].join("\x1f"),
    ].join("\n");
    assert.deepEqual(parseTags(out), [
      {
        name: "v1",
        target: "aa11",
        annotated: false,
        taggerName: "",
        taggerEmail: "",
        timestamp: 0,
        // A lightweight tag has no message of its own: the commit subject
        // that %(contents) reports must not be passed off as one.
        message: "",
      },
      {
        name: "v2",
        target: "cc33",
        annotated: true,
        taggerName: "Ada",
        taggerEmail: "ada@x",
        timestamp: 1700000000,
        message: "Release notes",
      },
    ]);
  });
});

describe("parseWorktrees", () => {
  it("parses main, linked, and detached worktrees", () => {
    const out = [
      "worktree /repo",
      "HEAD aaa111",
      "branch refs/heads/main",
      "",
      "worktree /repo-wt",
      "HEAD bbb222",
      "branch refs/heads/feature",
      "",
      "worktree /repo-det",
      "HEAD ccc333",
      "detached",
      "",
    ].join("\n");
    assert.deepEqual(parseWorktrees(out), [
      { path: "/repo", hash: "aaa111", branch: "main", bare: false, detached: false },
      { path: "/repo-wt", hash: "bbb222", branch: "feature", bare: false, detached: false },
      { path: "/repo-det", hash: "ccc333", branch: null, bare: false, detached: true },
    ]);
  });

  it("returns empty for empty output", () => {
    assert.deepEqual(parseWorktrees(""), []);
  });
});

describe("parseNameStatus", () => {
  it("parses added, modified, deleted, renamed, copied", () => {
    const out = [
      "M\tsrc/a.js",
      "A\tnew.js",
      "D\tgone.js",
      "R100\told.js\tnew2.js",
      "C075\tsrc.js\tdup.js",
    ].join("\n");
    const files = parseNameStatus(out);
    assert.deepEqual(files, [
      { path: "src/a.js", status: "Modified" },
      { path: "new.js", status: "Added" },
      { path: "gone.js", status: "Deleted" },
      { path: "new2.js", oldPath: "old.js", status: "Renamed" },
      { path: "dup.js", oldPath: "src.js", status: "Copied" },
    ]);
  });

  it("marks unknown status letters as Unknown", () => {
    const [f] = parseNameStatus("X\tweird.js");
    assert.equal(f.status, "Unknown");
  });
});

describe("parseStatus", () => {
  it("parses staged, unstaged, untracked, and renamed entries", () => {
    const out = [
      "M  staged.js",
      " M worktree.js",
      "AM both.js",
      "A  added.js",
      " D gone.js",
      "?? new.txt",
      "R  old.js -> new.js",
    ].join("\n");
    assert.deepEqual(parseStatus(out), [
      { path: "staged.js", status: "Modified" },
      { path: "worktree.js", status: "Modified" },
      { path: "both.js", status: "Added" },
      { path: "added.js", status: "Added" },
      { path: "gone.js", status: "Deleted" },
      { path: "new.txt", status: "Untracked" },
      { path: "new.js", oldPath: "old.js", status: "Renamed" },
    ]);
  });

  it("returns empty for clean trees", () => {
    assert.deepEqual(parseStatus(""), []);
    assert.deepEqual(parseStatus("\n"), []);
  });
});

describe("parseStashList", () => {
  const SEP = "\x1f";
  it("parses stash entries with hash, ref, message, and timestamp", () => {
    const out = [
      `abc123${SEP}stash@{0}${SEP}WIP on main: 111aaa first${SEP}1700000000`,
      `def456${SEP}stash@{1}${SEP}On feature: unfinished${SEP}1699990000`,
    ].join("\n");
    assert.deepEqual(parseStashList(out), [
      {
        hash: "abc123",
        name: "stash@{0}",
        message: "WIP on main: 111aaa first",
        timestamp: 1700000000,
      },
      {
        hash: "def456",
        name: "stash@{1}",
        message: "On feature: unfinished",
        timestamp: 1699990000,
      },
    ]);
  });

  it("returns empty for no stashes and skips malformed lines", () => {
    assert.deepEqual(parseStashList(""), []);
    assert.deepEqual(parseStashList("\n"), []);
    assert.deepEqual(parseStashList("not-a-stash-line\n"), []);
  });
});
