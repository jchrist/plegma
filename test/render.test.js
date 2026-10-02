// Renders the REAL bundled webview (out/webview.js) inside jsdom with a
// faked host API. Fails on any bundle error — this is the automated version
// of "open the window and see a black screen".
import { describe, it, beforeAll, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUNDLE = path.join(__dirname, "..", "out", "webview.js");

const FIXTURE = {
  log: [
    {
      hash: "aaa111",
      parents: ["bbb222"],
      authorName: "Ada",
      authorEmail: "ada@x",
      avatar: { hash: "aa11", initials: "AD", url: "https://www.gravatar.com/avatar/aa11?d=404" },
      sigStatus: "G",
      sigSigner: "Ada <ada@x>",
      timestamp: 1700000000,
      subject: "feat: render me",
      body: "longer description here",
      refs: [],
      filesChanged: 3,
      additions: 12,
      deletions: 4,
    },
    {
      hash: "bbb222",
      parents: [],
      authorName: "Bob",
      authorEmail: "bob@x",
      avatar: { hash: "bb22", initials: "BO", url: "https://www.gravatar.com/avatar/bb22?d=404" },
      timestamp: 1699990000,
      subject: "chore: base",
      body: "fixes #12 with **bold** and `code`, see https://example.dev/ or mail ada@example.dev :bug:",
      refs: [],
      // A merge: git's numstat has nothing for it, and so does the card.
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    },
  ],
  branches: [
    { name: "main", kind: "local", target: "aaa111", isHead: true, upstream: "origin/main" },
    { name: "feature", kind: "local", target: "bbb222", isHead: false, upstream: "origin/feature" },
    { name: "lonely", kind: "local", target: "bbb222", isHead: false },
    // Tracks a ref that no longer exists (deleted on the remote, pruned
    // locally): no Update action may be offered for it. Points at the side
    // commit so the base-row chip assertions stay exact.
    { name: "stale", kind: "local", target: "s11111", isHead: false, upstream: "origin/stale" },
    { name: "origin/main", kind: "remote", target: "aaa111", isHead: false },
    { name: "origin/feature", kind: "remote", target: "bbb222", isHead: false },
    { name: "origin/next", kind: "remote", target: "aaa111", isHead: false },
  ],
  tags: [
    {
      name: "v0.1",
      target: "bbb222",
      annotated: true,
      taggerName: "Bob",
      taggerEmail: "bob@x",
      timestamp: 1699990000,
      message: "First **release** — see https://example.dev/notes",
    },
    { name: "v0.0", target: "bbb222", annotated: false },
  ],
  files: [
    { path: "src/app.js", status: "Modified" },
    { path: "src/util.js", status: "Added" },
    { path: "README.md", status: "Modified" },
  ],
  status: [{ path: "dirty.js", status: "Modified" }],
  stashes: [
    {
      hash: "st1",
      name: "stash@{0}",
      message: "WIP on main: aaa111 experiment",
      timestamp: 1700000700,
    },
  ],
  worktrees: [
    { path: "/repo", hash: "aaa111", branch: "main", bare: false, detached: false },
    { path: "/wt/feature", hash: "bbb222", branch: "feature", bare: false, detached: false },
  ],
};

const mergeFixture = { inProgress: false, conflictedFiles: [] };
const seenRequests = [];
// Method + args of every request, so a test can assert what a prompt was
// seeded with (the prefill of "create a branch from origin/x").
const seenRequestArgs = [];
// Args of every `log` request, so tests can check the branch filter.
const logArgsSeen = [];

// One-shot failure injector for error-path render tests: the next
// request with a matching method fails with the given error payload.
let failNext = null;

// One-shot slow-response injector, same shape: holds the next request with
// this method for `ms`, so a test can inspect the view while it is busy.
let slowNext = null;

// Longer than the app's BUSY_DELAY_MS, so a settled view really is settled and
// not merely unobserved.
const IDLE_SETTLE_MS = 400;

function respond(data) {
  switch (data.method) {
    case "log": {
      // Honor the requested limit with generated filler so paging tests
      // see full pages; real fixture commits stay first. A side-branch
      // commit exercises multi-lane layout and lineage highlight.
      const n = (data.args && data.args.limit) || 500;
      const extra = [
        {
          hash: "s11111",
          parents: ["bbb222"],
          authorName: "Sid",
          authorEmail: "s@x",
          timestamp: 1699980000,
          subject: "side: experiment",
          body: "",
          refs: [],
        },
      ];
      for (let i = 0; i < n - FIXTURE.log.length - 1; i++) {
        const h = "f" + String(i).padStart(5, "0");
        extra.push({
          hash: h,
          parents: [i === 0 ? "bbb222" : "f" + String(i - 1).padStart(5, "0")],
          authorName: "Gen",
          authorEmail: "g@x",
          timestamp: 1699900000 - i,
          subject: "filler " + i,
          body: "",
          refs: [],
        });
      }
      return [...FIXTURE.log, ...extra];
    }
    case "branches":
      return FIXTURE.branches;
    case "tags":
      return FIXTURE.tags;
    case "files":
      return FIXTURE.files;
    case "statusFiles":
      return FIXTURE.status;
    case "stashList":
      return FIXTURE.stashes || [];
    case "stashPush":
      return { stashed: true };
    case "stashApply":
      return { ok: true };
    case "stashPop":
      return { ok: true };
    case "stashDrop":
      return { ok: true };
    case "stashBranch":
      return { ok: true };
    case "revealScm":
      return { ok: true };
    case "worktreeFileDiff":
      return { text: "@@ -1 +1 @@\n-wtold\n+wtnew\n", truncated: false };
    case "fileDiff":
      return { text: "@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n", truncated: false };
    case "openDiff":
      return { opened: true };
    case "openFileAtRevision":
      return { opened: true };
    case "openWorkingFile":
      return { opened: true };
    case "openCompareWorktree":
      return { opened: 2 };
    case "worktrees":
      return FIXTURE.worktrees;
    case "rebaseStatus":
      return { inProgress: false, conflictedFiles: [] };
    case "rebase":
      return { rebased: true };
    case "checkout":
      return { ok: true };
    case "checkoutDetached":
      return { ok: true };
    case "checkoutTracking":
      return { ok: true };
    case "deleteBranch":
      return { ok: true };
    case "deleteTag":
      return { ok: true };
    case "pushTag":
      return { ok: true };
    case "deleteRemoteBranch":
      return { ok: true };
    case "pull":
      return { ok: true };
    case "pushBranch":
      return { pushed: true };
    case "remoteDetails":
      return [
        { name: "origin", fetchUrl: "git@x:plegma.git", pushUrl: "git@x:plegma.git" },
        { name: "upstream", fetchUrl: "https://x/other.git", pushUrl: "https://x/other.git" },
      ];
    case "addRemote":
      return { added: data.args.name };
    case "renameRemote":
      return { renamed: data.args.newName };
    case "setRemoteUrl":
      return { updated: data.args.name };
    case "removeRemote":
      return { ok: true };
    case "fetchRemote":
      return { fetched: data.args.name };
    case "fetchRemoteBranch":
      return { fetched: data.args.branch };
    case "pullRemoteBranch":
      return { pulled: "origin/feature" };
    case "listRemotes":
      return ["origin"];
    case "fetch":
      return { ok: true };
    case "mergeBranch":
      return { merged: true };
    case "mergeCommit":
      return { merged: true };
    case "mergeContinue":
      return { continued: true };
    case "mergeAbort":
      mergeFixture.inProgress = false;
      mergeFixture.conflictedFiles = [];
      return { aborted: true };
    case "mergeStatus":
      return mergeFixture;
    case "promptPick":
      return { value: "soft" };
    case "promptInput":
      return { value: null };
    case "updateBranch":
      return { updated: data.args.name, backTo: "main" };
    case "discardWorktree":
      return { discarded: true };
    case "deleteBranch":
      return { ok: true };
    case "fingerprint":
      return "fp1";
    case "roots":
      return { roots: [{ name: "fixture", folder: "/repo", root: "/repo" }], activeRoot: "/repo" };
    case "useRoot":
      return { root: "/repo" };
    default:
      throw new Error(`unexpected method in render test: ${data.method}`);
  }
}

async function mountBundle() {
  const bundleJs = fs.readFileSync(BUNDLE, "utf8");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e));

  const html = `<!DOCTYPE html><html><head></head><body>
<div id="root"></div>
<script type="application/json" id="plegma-initial-state">{"type":"hello","location":"editor"}</script>
<script>${bundleJs}</script>
</body></html>`;

  const dom = new JSDOM(html, {
    url: "https://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // jsdom has no clipboard; record what the webview copies.
      window.__copied = [];
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text) => {
            window.__copied.push(text);
            return Promise.resolve();
          },
        },
      });
      window.acquireVsCodeApi = () => ({
        postMessage: (msg) => {
          seenRequests.push(msg.method);
          seenRequestArgs.push({ method: msg.method, args: msg.args || {} });
          if (msg.method === "log") {
            logArgsSeen.push(msg.args || {});
          }
          // `slowNext` holds one response back so a test can watch the busy
          // indicator while an action is still running.
          const hold = slowNext && slowNext.method === msg.method ? slowNext.ms : 0;
          if (hold) {
            slowNext = null;
          }
          setTimeout(() => {
            if (failNext && failNext.method === msg.method) {
              const f = failNext;
              failNext = null;
              window.dispatchEvent(
                new window.MessageEvent("message", {
                  data: {
                    type: "git/response",
                    id: msg.id,
                    ok: false,
                    error: f.error,
                    ...f.extra,
                  },
                }),
              );
              return;
            }
            const data = respond(msg);
            window.dispatchEvent(
              new window.MessageEvent("message", {
                data: { type: "git/response", id: msg.id, ok: true, data },
              }),
            );
          }, hold);
        },
      });
    },
  });

  // Wait until the app renders the fixture commit (or time out).
  const deadline = Date.now() + 8000;
  for (;;) {
    const body = dom.window.document.body.textContent || "";
    if (body.includes("feat: render me")) {
      break;
    }
    if (Date.now() > deadline) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { dom, errors };
}

describe("webview bundle render", () => {
  let dom;
  let errors;

  beforeAll(async () => {
    const mounted = await mountBundle();
    dom = mounted.dom;
    errors = mounted.errors;
  });

  afterAll(() => {
    if (dom) {
      dom.window.close(); // stop the app's fingerprint interval so the runner exits
    }
  });

  // Commit rows only: the table also leads with the worktree node row.
  function commitRows() {
    return [...dom.window.document.querySelectorAll("tr.plegma-row")].filter(
      (r) => !r.classList.contains("plegma-row-worktree"),
    );
  }

  function rootText() {
    const root = dom.window.document.getElementById("root");
    return (root && root.textContent) || "";
  }

  // Poll for an expected UI state instead of sleeping fixed durations.
  async function waitFor(fn, label, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const got = await fn();
      if (got) {
        return got;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${label}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // Chip lookup by ref name. Paired chips (a local branch and its
  // same-named remote on one commit) are icon-only, so the accessible name
  // is the only place both names show up; unpaired chips keep a visible
  // label.
  function refChip(name) {
    return [...dom.window.document.querySelectorAll("span.plegma-ref")].find(
      (s) =>
        (s.textContent || "").includes(name) || (s.getAttribute("aria-label") || "").includes(name),
    );
  }

  function bodyText() {
    return dom.window.document.body.textContent || "";
  }

  // The commit row a chip belongs to.
  function chipForRow(chip) {
    return chip && chip.closest("tr.plegma-row");
  }

  function menuItems() {
    return [...dom.window.document.querySelectorAll(".plegma-menu-item")].map((d) =>
      (d.textContent || "").trim(),
    );
  }

  function findMenuItem(text) {
    return [...dom.window.document.querySelectorAll(".plegma-menu-item")].find((d) =>
      (d.textContent || "").trim().includes(text),
    );
  }

  // Nested lists (Checkout, Rebase onto, Compare with) open on hover, the
  // way a pointer opens them.
  async function openSubmenuByText(text) {
    const parent = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item.plegma-menu-sub")].find((d) =>
          (d.textContent || "").includes(text),
        ),
      `submenu parent "${text}"`,
    );
    parent.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
    await waitFor(
      () => !!dom.window.document.querySelector(".plegma-menu-submenu"),
      `submenu "${text}"`,
    );
    return parent;
  }

  it("mounts without bundle errors", () => {
    assert.deepEqual(
      errors.map((e) => e.message || String(e)),
      [],
    );
    assert.ok(rootText().length > 0, "root has rendered content");
  });

  it("renders the commit graph", () => {
    const text = rootText();
    assert.match(text, /feat: render me/);
    assert.match(text, /chore: base/);
    assert.ok(
      !dom.window.document.querySelector('[aria-label="Resize files panel"]'),
      "history uses the full width before a commit is selected",
    );
  });

  it("renders branch and tag chips on commits", () => {
    const text = rootText();
    assert.match(text, /main/);
    // origin/main is folded into main's chip, so only the unpaired remote
    // keeps its own chip; both names stay reachable accessibly.
    assert.match(text, /origin\/next/);
    assert.match(
      [...dom.window.document.querySelectorAll("span.plegma-ref")]
        .map((s) => s.getAttribute("aria-label") || "")
        .join(" "),
      /origin\/main/,
    );
    assert.match(text, /v0\.1/);
  });

  it("renders branches as native-style chips with checkout on double-click", () => {
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    assert.ok(spans.length > 0, "ref chips use the native-style class");
    const local = refChip("lonely");
    assert.ok(local, "local branch chip rendered");
    assert.match(local.getAttribute("aria-label") || "", /double-click to check out/i);
    assert.ok(local.querySelector("svg"), "branch chip carries the native branch icon");
    const remote = spans.find((s) => s.classList.contains("plegma-ref-remote"));
    assert.ok(remote, "remote branch chip rendered");
    assert.match(remote.textContent || "", /origin\/next/);
    assert.ok(remote.querySelector("svg"), "remote chip carries the native cloud icon");
    assert.ok(
      !/double-click/i.test(remote.getAttribute("aria-label") || ""),
      "remote branch chip offers no double-click checkout",
    );
    // main + origin/main share one chip: the local name plus a cloud icon
    // for the remote half, and it still marks the current branch.
    const head = spans.find((s) => s.classList.contains("plegma-ref-head"));
    assert.ok(head, "current branch chip is marked as HEAD");
    assert.match(head.getAttribute("aria-label") || "", /main and origin\/main/);
    assert.equal((head.textContent || "").trim(), "main", "paired chip keeps the local name");
    assert.equal(head.querySelectorAll("svg").length, 2, "paired chip adds a cloud to its icon");
    const tag = spans.find((s) => s.classList.contains("plegma-ref-tag"));
    assert.ok(tag, "tag chip rendered");
    assert.ok(tag.querySelector("svg"), "tag chip carries the native tag icon");
  });

  it("gives a local branch and its same-named remote one chip with both marks", async () => {
    // main + origin/main and feature + origin/feature each become a single
    // chip: the local name, plus a cloud icon standing for the remote half.
    const rows = commitRows();
    const headRow = rows.find((r) => (r.textContent || "").includes("feat: render me"));
    const headChips = Array.from(headRow.querySelectorAll("span.plegma-ref"));
    assert.equal(headChips.length, 2, "one chip for main+origin/main, one for origin/next");
    assert.deepEqual(
      headChips.map((c) => (c.textContent || "").trim()),
      ["main", "origin/next"],
      "every branch chip keeps its name",
    );
    const baseRow = rows.find((r) => (r.textContent || "").includes("chore: base"));
    const baseChips = Array.from(baseRow.querySelectorAll("span.plegma-ref"));
    assert.deepEqual(
      baseChips.map((c) => (c.textContent || "").trim()),
      ["feature", "lonely", "v0.1", "v0.0"],
      "feature+origin/feature is one chip, lonely and the tags keep theirs",
    );
    // The paired chip is marked remote with a second icon, not a label swap.
    const paired = refChip("feature");
    assert.ok(paired.classList.contains("plegma-ref-local"), "paired chip is a local chip");
    assert.equal(paired.querySelectorAll("svg").length, 3, "branch, cloud and worktree icons");
    // The chip still carries both refs' actions.
    refChip("feature").dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const items = await waitFor(() => {
      const found = menuItems();
      return found.includes("Delete feature from origin") ? found : null;
    }, "paired chip menu");
    for (const item of [
      "Push feature to origin/feature", // local
      "Force Push feature…", // local (has an upstream)
      "Delete feature from origin", // remote half of the pair
      "Merge origin/feature into main",
    ]) {
      assert.ok(items.includes(item), `paired chip menu has "${item}"`);
    }
    assert.ok(
      !items.some((t) => t.startsWith("Fetch origin/")),
      "no separate fetch item: Update (first) owns the fast-forward",
    );
    assert.ok(
      !items.some((t) => t.includes("as a new local branch")),
      "no tracking checkout for a ref that already has a local branch",
    );
  });

  it("colors ref chips with their commit's graph lane color, like native", () => {
    // Native (scmHistory.ts) paints each badge with the swimlane color of
    // the commit it points to — never a fixed color per ref type — so a
    // local branch and a remote branch on the same commit share one color.
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    assert.ok(spans.length > 0, "ref chips rendered");
    for (const chip of spans) {
      const bg = chip.style.background;
      assert.ok(
        bg && bg.includes("scmGraph"),
        `chip background is a graph lane color, got "${bg}"`,
      );
    }
    const local = refChip("lonely");
    const remote = spans.find((s) => s.classList.contains("plegma-ref-remote"));
    assert.ok(local && remote, "branch chips on the same commit rendered");
    assert.equal(
      remote.style.background,
      local.style.background,
      "chips on the same commit share the lane color",
    );
    const tag = spans.find((s) => s.classList.contains("plegma-ref-tag"));
    assert.ok(
      tag &&
        (tag.style.background.includes("scmGraph-foreground") ||
          tag.style.background.includes("scmGraph-historyItemRefColor")),
      "tag chips use lane colors, not a fixed tag color",
    );
  });

  it("places refs between the graph and the commit subject", () => {
    const row = commitRows().find((r) => (r.textContent || "").includes("feat: render me"));
    assert.ok(row, "commit row rendered");
    const cell = row.querySelectorAll("td")[1];
    const content = cell && cell.querySelector(".plegma-subject-content");
    assert.ok(content, "commit cell has a single content row");
    const [refs, subject] = [...content.children];
    assert.ok(refs.classList.contains("plegma-refs"), "refs appear first after the graph");
    assert.ok(subject.classList.contains("plegma-subject"), "subject follows refs");
    assert.match(subject.textContent || "", /feat: render me/);
    assert.ok(refs.querySelector(".plegma-ref-head"), "current branch is visible before subject");
  });
  it("opens a branch context menu on chip right-click", async () => {
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy branch name"), "branch menu");
    // NOTE: exact element text, not body text — the inlined bundle script
    // contains these static labels, so body text matches vacuously.
    const items = menuItems();
    for (const item of [
      "Update feature from origin/feature",
      "Merge feature into main",
      "Push feature to origin/feature",
      "Force Push feature…",
      "Delete feature and its worktree",
      "Copy branch name",
      "Rename feature…",
    ]) {
      assert.ok(items.includes(item), `branch menu has "${item}"`);
    }
    // Every label names both ends of what it does, so it can be read
    // without a glossary: nothing says "fetch into…" and leaves the rest
    // to be guessed.
    for (const item of items) {
      assert.ok(
        !/^(Fetch|Pull|Update|Push) into\b/.test(item) && !item.endsWith(" into "),
        `item "${item}" leaves its target unstated`,
      );
    }
  });

  it("offers pull (not check-out-and-back) for the current branch", async () => {
    const head = [...dom.window.document.querySelectorAll("span.plegma-ref")].find((s) =>
      s.classList.contains("plegma-ref-head"),
    );
    assert.ok(head, "HEAD chip rendered");
    head.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Pull latest into main"), "current-branch menu");
    assert.ok(
      !menuItems().some((t) => t.startsWith("Update main")),
      "no check-out-and-back wording for the branch I'm already on",
    );
    // The checked-out branch keeps the pull flow (not the in-place fetch).
    const mark = seenRequests.length;
    findMenuItem("Pull latest into main").dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (pull)");
    assert.ok(seenRequests.slice(mark).includes("updateBranch"), "pull ran updateBranch");
    assert.ok(
      !seenRequests.slice(mark).includes("fetchRemoteBranch"),
      "no in-place fetch for the checked-out branch",
    );
    await waitFor(
      () => !menuItems().includes("Pull latest into main"),
      "current-branch menu dismissed",
    );
  });

  it("marks branches checked out in a worktree differently", () => {
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    assert.ok(chip.classList.contains("plegma-ref-worktree"));
    // branch + cloud (its same-named remote) + worktree folder
    assert.equal(
      chip.querySelectorAll("svg").length,
      3,
      "branch, cloud and worktree icons are visible",
    );
    assert.match(chip.getAttribute("aria-label") || "", /\/wt\/feature/);
    const main = spans.find((s) => s.classList.contains("plegma-ref-head"));
    assert.ok(main, "main branch chip rendered");
    assert.ok(!main.classList.contains("plegma-ref-worktree"), "plain branch has no worktree mark");
  });

  it("shows the GPG signature status in the Details pane", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Verified · Ada <ada@x>"), "signed commit details");
    assert.ok(rootText().includes("Signature"), "Details has a Signature row");
    rows[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Unsigned"), "unsigned commit details");
  });

  it("shows a commit details pane once a commit is selected", async () => {
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("longer description here"), "details body");
    const text = rootText();
    for (const item of ["Details", "aaa111", "ada@x", "longer description here"]) {
      assert.ok(text.includes(item), `details pane shows "${item}"`);
    }
  });

  it("shows author avatars and falls back to initials when the image fails", async () => {
    const doc = dom.window.document;
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    const img = rows[0].querySelector("img.plegma-avatar-img");
    assert.ok(img, "gravatar image rendered for the first commit");
    assert.equal(img.getAttribute("src"), "https://www.gravatar.com/avatar/aa11?d=404");
    // A failed fetch (offline, unknown address) swaps in the initials.
    img.dispatchEvent(new dom.window.Event("error"));
    const initials = await waitFor(
      () => rows[0].querySelector(".plegma-avatar-initials"),
      "initials fallback",
    );
    assert.equal(initials.textContent.trim(), "AD");
    assert.ok(!rows[0].querySelector("img.plegma-avatar-img"), "image removed after failure");
    // A second commit keeps its own avatar state.
    const other = rows[1].querySelector("img.plegma-avatar-img");
    assert.ok(other, "other commit still shows its avatar");
  });

  it("renders commit messages as rich text: links, emphasis, code, emoji", async () => {
    const row = commitRows().find((r) => (r.textContent || "").includes("chore: base"));
    assert.ok(row, "older commit row rendered");
    row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const code = await waitFor(
      () => dom.window.document.querySelector("#root code.plegma-rt-code"),
      "rich text details body",
    );
    assert.equal(code.textContent, "code");
    const doc = dom.window.document;
    const url = doc.querySelector('#root a[href="https://example.dev/"]');
    assert.ok(url, "URL rendered as a link");
    assert.equal(url.getAttribute("target"), "_blank");
    assert.ok(doc.querySelector("#root strong"), "bold rendered");
    const mail = doc.querySelector('#root a[href="mailto:ada@example.dev"]');
    assert.ok(mail, "email rendered as a mailto link");
    const emoji = doc.querySelector("#root span.plegma-rt-emoji");
    assert.ok(emoji, "gitmoji shortcode rendered as emoji");
    assert.equal(emoji.getAttribute("title"), ":bug:");
  });

  it("compares the working tree with a commit from the commit menu", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    // The comparisons are grouped, like the native graph groups its own.
    await openSubmenuByText("Compare with");
    const item = await waitFor(
      () => findMenuItem("Working tree vs. this commit"),
      "compare worktree item",
    );
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("openCompareWorktree"),
      "openCompareWorktree requested",
    );
  });

  it("pulls a remote branch into the current branch from a paired chip", async () => {
    const featChip = refChip("origin/feature");
    assert.ok(featChip, "origin/feature chip rendered (paired with feature)");
    featChip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(
      () => findMenuItem("Merge origin/feature into main"),
      "merge remote branch item",
    );
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("pullRemoteBranch"),
      "pullRemoteBranch requested",
    );
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (pull)");
    assert.ok(!rootText().includes("failed"), "no error shown (pull)");
  });

  it("offers no separate fetch where Update covers it", async () => {
    // A paired chip's branch tracks a live ref, so Update (first item) owns
    // the in-place fast-forward and no fetch item duplicates it — including
    // on the checked-out branch.
    for (const [name, update] of [
      ["origin/feature", "Update feature from origin/feature"],
      ["origin/main", "Pull latest into main"],
    ]) {
      const chip = refChip(name);
      assert.ok(chip, `${name} chip rendered`);
      chip.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
      );
      await waitFor(() => menuItems().includes(update), `update covers ${name}`);
      assert.ok(
        !menuItems().some((t) => t.startsWith("Fetch origin/")),
        `no separate fetch item beside ${update}`,
      );
      dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
      await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");
    }
  });

  it("opens a commit context menu with branch and tag actions", async () => {
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    // An older commit: the ones at the tip of the checked-out branch hide
    // the actions that would be no-ops there.
    const base = rows.find((r) => (r.textContent || "").includes("chore: base"));
    base.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy Commit Hash"), "commit menu");
    for (const item of [
      "Open Changes",
      "Checkout (Detached)",
      "Checkout ▸",
      "Create Branch…",
      "Create Tag…",
      "Cherry Pick",
      "Compare with… ▸",
      "Rebase main onto… ▸",
      "Revert this commit",
      "Reset current branch to here…",
      "Merge into current branch…",
      "Copy Commit Hash",
      "Copy Commit Message",
    ]) {
      assert.ok(menuItems().includes(item), `commit menu has "${item}"`);
    }
    // The per-branch lists live in the submenus now, and a commit with
    // nothing to squash does not get a squashed-into-nothing row.
    assert.ok(
      !menuItems().some((t) => t.includes("Squash")),
      "no squash item with a single commit",
    );
    assert.ok(menuItems().includes("Drop this commit"));
    // The nested list is one hover away and lists what this commit can be
    // checked out from.
    await openSubmenuByText("Checkout");
    assert.ok(
      menuItems().some((t) => t === "lonely"),
      "the checkout submenu lists the branch on this commit",
    );
    assert.ok(!menuItems().some((t) => t === "feature"), "not the branch a linked worktree holds");
    assert.ok(
      menuItems().some((t) => t === "v0.1"),
      "and its tags",
    );
    // Scrolling the parent menu drops the nested list: it is
    // viewport-positioned, so kept open it would drift off its parent row.
    const parentMenu = [...dom.window.document.querySelectorAll(".plegma-menu")].find(
      (m) => !m.classList.contains("plegma-menu-submenu"),
    );
    assert.ok(parentMenu, "parent menu rendered");
    parentMenu.dispatchEvent(new dom.window.Event("scroll", { bubbles: false }));
    await waitFor(
      () => !dom.window.document.querySelector(".plegma-menu-submenu"),
      "submenu closed by parent scroll",
    );
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !menuItems().includes("Copy Commit Hash"), "menu closed by Escape");
  });

  it("hides the actions that would be no-ops on the branch tip", async () => {
    const rows = commitRows();
    const tip = rows.find((r) => (r.textContent || "").includes("feat: render me"));
    tip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy Commit Hash"), "commit menu");
    for (const item of [
      "Checkout (Detached)",
      "Reset current branch to here…",
      "Merge into current branch…",
      "Cherry Pick",
    ]) {
      assert.ok(
        !menuItems().includes(item),
        `no "${item}" on the tip of the branch that is checked out`,
      );
    }
    // What is left still acts on it.
    assert.ok(menuItems().includes("Open Changes"));
    assert.ok(menuItems().includes("Drop this commit"));
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !menuItems().includes("Copy Commit Hash"), "menu dismissed");
  });

  it("offers only set-wide actions when several commits are selected", async () => {
    const rows = commitRows();
    const base = rows.find((r) => (r.textContent || "").includes("chore: base"));
    const side = rows.find((r) => (r.textContent || "").includes("side: experiment"));
    // A plain click first, so the selection starts from a known state
    // whatever earlier tests left ticked.
    base.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    side.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await waitFor(
      () =>
        base.classList.contains("plegma-row-checked") &&
        side.classList.contains("plegma-row-active"),
      "two commits ticked",
    );
    base.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Squash 2 selected into the oldest"), "multi menu");
    for (const item of [
      "Squash 2 selected into the oldest",
      "Drop 2 selected",
      "Copy 2 Commit Hashes",
      "Copy 2 Commit Messages",
    ]) {
      assert.ok(menuItems().includes(item), `multi menu has "${item}"`);
    }
    for (const item of [
      "Open Changes",
      "Revert this commit",
      "Reset current branch to here…",
      "Cherry Pick",
      "Checkout (Detached)",
      "Rebase main onto… ▸",
    ]) {
      assert.ok(!menuItems().includes(item), `multi menu drops "${item}"`);
    }
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !menuItems().includes("Drop 2 selected"), "multi menu dismissed");
    // Leave a single selection behind: a two-commit selection would turn
    // every later right-click into a multi menu.
    side.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  it("prefills a remote branch's short name when creating a branch", async () => {
    const chip = refChip("origin/next");
    assert.ok(chip, "unpaired remote branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(() => findMenuItem("Create Branch…"), "create branch item");
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const asked = await waitFor(
      () => seenRequestArgs.slice(mark).find((r) => r.method === "promptInput"),
      "promptInput",
    );
    assert.equal(asked.args.value, "next", "the local branch keeps the remote's name");
    assert.match(asked.args.prompt, /origin\/next/, "the prompt still names the start point");
  });

  it("opens a tag context menu with checkout and delete actions", async () => {
    const tag = [...dom.window.document.querySelectorAll("span.plegma-ref-tag")].find((s) =>
      (s.textContent || "").includes("v0.1"),
    );
    assert.ok(tag, "tag chip rendered");
    tag.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => rootText().includes("Delete Tag"), "tag menu");
    for (const item of ["(detached)", "Push Tag", "Copy tag name", "Delete Tag"]) {
      assert.ok(rootText().includes(item), `tag menu has "${item}"`);
    }
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(
      () =>
        ![...dom.window.document.querySelectorAll(".plegma-menu-item")].some((d) =>
          (d.textContent || "").includes("Delete Tag"),
        ),
      "tag menu closed by Escape",
    );
  });

  it("checks out a detached HEAD from the commit menu", async () => {
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    const base = rows.find((r) => (r.textContent || "").includes("chore: base"));
    base.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(() => findMenuItem("Checkout (Detached)"), "detached checkout item");
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("checkoutDetached"),
      "checkoutDetached requested",
    );
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (detach)");
    assert.ok(!rootText().includes("failed"), "no error shown (detach)");
  });

  it("offers tracking checkout and remote delete on unpaired remote branches", async () => {
    const chip = refChip("origin/next");
    assert.ok(chip, "unpaired remote branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    // The full remote name leads: the menu is about origin/next, and there
    // is no local "next" to confuse it with.
    const item = await waitFor(
      () => findMenuItem("Check out origin/next as new local branch next"),
      "remote branch menu",
    );
    assert.ok(item, "tracking checkout leads with the remote name");
    assert.ok(
      menuItems().includes("Merge origin/next into main"),
      "merge names the remote in full",
    );
    // There is no local "next" to fetch into, so the fetch is not offered
    // at all — it would silently create that branch.
    assert.ok(
      !menuItems().some((t) => t.startsWith("Fetch origin/next")),
      "no fetch into a branch that does not exist",
    );
    const del = await waitFor(() => findMenuItem("Delete next from origin"), "remote delete item");
    del.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("removes it from the remote"), "remote delete confirm");
    const confirm = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Delete",
    );
    assert.ok(confirm, "remote delete confirm button rendered");
    const mark = seenRequests.length;
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("deleteRemoteBranch"),
      "deleteRemoteBranch requested",
    );
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (delete)");
    assert.ok(!rootText().includes("failed"), "no error shown (delete)");
  });

  it("pushes a branch from the branch menu without confirming", async () => {
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(() => findMenuItem("Push feature to origin/feature"), "branch menu");
    assert.ok(item, "plain push item rendered (no confirm)");
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("pushBranch"), "pushBranch requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (push)");
    assert.ok(!rootText().includes("failed"), "no error shown (push)");
  });

  it("force-pushes after confirming with a backup note", async () => {
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item")].find((d) =>
          (d.textContent || "").includes("Force Push"),
        ),
      "force push item",
    );
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("backup ref"), "force push confirm");
    const confirm = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Force push",
    );
    assert.ok(confirm, "force push confirm button rendered");
    const mark = seenRequests.length;
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("pushBranch"), "pushBranch requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (force push)");
    assert.ok(!rootText().includes("failed"), "no error shown (force push)");
  });

  it("pushes a tag from the tag menu", async () => {
    const tag = [...dom.window.document.querySelectorAll("span.plegma-ref-tag")].find((s) =>
      (s.textContent || "").includes("v0.1"),
    );
    assert.ok(tag, "tag chip rendered");
    tag.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    const item = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item")].find((d) =>
          (d.textContent || "").includes("Push Tag"),
        ),
      "push tag item",
    );
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("pushTag"), "pushTag requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (push tag)");
    assert.ok(!rootText().includes("failed"), "no error shown (push tag)");
  });

  it("shows annotated tag details in the tag menu", async () => {
    const doc = dom.window.document;
    const openMenu = async (name) => {
      const chip = [...doc.querySelectorAll("span.plegma-ref-tag")].find((sp) =>
        (sp.textContent || "").includes(name),
      );
      assert.ok(chip, name + " chip rendered");
      chip.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
      );
      await waitFor(() => rootText().includes("Delete Tag"), "tag menu");
    };
    await openMenu("v0.1");
    const menu = doc.querySelector(".plegma-menu");
    const annot = menu.querySelector(".plegma-tag-annotation");
    assert.ok(annot, "annotation block rendered");
    assert.match(annot.textContent || "", /Bob/, "tagger shown");
    assert.match(annot.textContent || "", /bob@x/, "tagger email shown");
    const msg = menu.querySelector(".plegma-tag-message");
    assert.ok(msg, "tag message rendered");
    assert.ok(msg.querySelector("strong"), "tag message is rich text");
    assert.ok(
      msg.querySelector('a[href="https://example.dev/notes"]'),
      "tag message links are clickable",
    );
    // A lightweight tag has no annotation to show.
    doc.body.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await openMenu("v0.0");
    const light = doc.querySelector(".plegma-menu");
    assert.match(rootText(), /lightweight/, "lightweight tags are labelled");
    assert.equal(light.querySelector(".plegma-tag-annotation"), null, "no annotation block");
  });
  it("deletes a tag after confirming", async () => {
    const tag = [...dom.window.document.querySelectorAll("span.plegma-ref-tag")].find((s) =>
      (s.textContent || "").includes("v0.1"),
    );
    assert.ok(tag, "tag chip rendered");
    tag.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => rootText().includes("Delete Tag"), "tag menu");
    const del = [...dom.window.document.querySelectorAll(".plegma-menu-item")].find((d) =>
      (d.textContent || "").includes("Delete Tag"),
    );
    assert.ok(del, "tag delete item rendered");
    del.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("removed locally"), "tag delete confirm");
    const confirm = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Delete",
    );
    assert.ok(confirm, "tag delete confirm button rendered");
    const mark = seenRequests.length;
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("deleteTag"), "deleteTag requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (delete tag)");
    assert.ok(!rootText().includes("failed"), "no error shown (delete tag)");
  });

  it("merges a commit from the commit menu", async () => {
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    const base = rows.find((r) => (r.textContent || "").includes("chore: base"));
    base.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(
      () => findMenuItem("Merge into current branch…"),
      "merge commit item",
    );
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("mergeCommit"), "mergeCommit requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (merge)");
    assert.ok(!rootText().includes("failed"), "no error shown (merge)");
  });

  it("rebases onto a commit from the commit menu", async () => {
    const rows = commitRows();
    const target = rows.find((r) => (r.textContent || "").includes("chore: base"));
    assert.ok(target, "older commit row rendered");
    target.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    // The rebase targets are grouped, and the commit itself is one of them.
    await openSubmenuByText("Rebase main onto");
    const item = await waitFor(
      () => findMenuItem("This commit (bbb222)"),
      "rebase-onto-commit item",
    );
    const mark = seenRequests.length;
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("rebase"), "rebase requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (rebase)");
    assert.ok(!rootText().includes("failed"), "no error shown (rebase)");
  });

  it("filters the log by picked branches and by glob pattern", async () => {
    const doc = dom.window.document;
    const btn = await waitFor(
      () => doc.querySelector('button[aria-label="Filter the log by branch"]'),
      "branch filter button",
    );
    assert.ok(btn, "toolbar has a branch filter button");
    btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const panel = await waitFor(
      () => doc.querySelector(".plegma-branchfilter-panel"),
      "branch filter panel",
    );
    assert.ok(panel, "panel opened");
    const pick = [...panel.querySelectorAll(".plegma-branchfilter-item")].find(
      (d) => (d.textContent || "").trim() === "feature",
    );
    assert.ok(pick, "feature branch listed");
    let mark = logArgsSeen.length;
    pick.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => logArgsSeen.slice(mark).some((a) => a.refs && a.refs.includes("feature")),
      "log re-queried with the picked ref",
    );
    assert.deepEqual(
      Array.from(logArgsSeen[logArgsSeen.length - 1].refs),
      ["feature"],
      "only the picked branch is sent",
    );
    // Picking again clears it.
    mark = logArgsSeen.length;
    pick.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => logArgsSeen.slice(mark).some((a) => Array.isArray(a.refs) && a.refs.length === 0),
      "log re-queried without refs",
    );
    // A pattern replaces the picked refs and expands to both namespaces.
    const input = doc.querySelector(".plegma-branchfilter-glob");
    assert.ok(input, "pattern input rendered");
    input.value = "feature/*";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const apply = [...panel.querySelectorAll(".plegma-menu-item")].find(
      (d) => (d.textContent || "").trim() === "Apply pattern",
    );
    mark = logArgsSeen.length;
    apply.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => logArgsSeen.slice(mark).some((a) => a.globs && a.globs.length === 2),
      "log re-queried with the pattern",
    );
    assert.deepEqual(Array.from(logArgsSeen[logArgsSeen.length - 1].globs), [
      "refs/heads/feature/*",
      "refs/remotes/feature/*",
    ]);
    assert.deepEqual(Array.from(logArgsSeen[logArgsSeen.length - 1].refs), []);

    // Clear it again. The filter is persisted to localStorage, and this
    // pattern matches nothing in the shared fixture — every later test that
    // counts commit rows then sees an empty history and fails, blaming itself.
    const clearItem = await waitFor(
      () =>
        [...doc.querySelectorAll(".plegma-menu-item")].find(
          (d) => (d.textContent || "").trim() === "Clear filter",
        ),
      "clear filter item",
    );
    mark = logArgsSeen.length;
    clearItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => logArgsSeen.slice(mark).some((a) => !a.globs || a.globs.length === 0),
      "log re-queried with no pattern",
    );
  });

  it("find mode jumps between matches instead of filtering the list", async () => {
    const doc = dom.window.document;
    const toggle = await waitFor(
      () => doc.querySelector('button[aria-label="Find in commits"]'),
      "find toggle",
    );
    toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const input = await waitFor(
      () => doc.querySelector('input[aria-label^="Find in commits"]'),
      "find input",
    );
    assert.ok(input, "search box became a find box");
    const before = commitRows().length;
    input.value = "chore";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(
      () => doc.querySelectorAll("tr.plegma-row-match").length > 0,
      "matches highlighted",
    );
    assert.equal(commitRows().length, before, "find mode keeps every row visible");
    const count = doc.querySelector(".plegma-find-count");
    assert.ok(count, "match counter rendered");
    assert.match(count.textContent || "", /1 of \d+/, "counter starts at the first match");
    // Enter walks to the next match and marks exactly one current row.
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await waitFor(
      () => doc.querySelectorAll("tr.plegma-row-match-current").length === 1,
      "one current",
    );
    const second = doc.querySelector("tr.plegma-row-match-current");
    assert.ok(second, "current match row marked");
    assert.ok(
      (second.textContent || "").includes("chore: base"),
      "Enter advanced to the next match",
    );
    // Escape leaves find mode and restores the plain search box.
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await waitFor(
      () => doc.querySelector('input[aria-label^="Search commits"]'),
      "search box restored",
    );
    assert.equal(doc.querySelectorAll("tr.plegma-row-match").length, 0, "highlights cleared");
  });

  it("hides and shows the Author and Date columns", async () => {
    const doc = dom.window.document;
    assert.ok(doc.querySelector("th.plegma-meta-author"), "author column shown by default");
    const toggle = await waitFor(
      () => doc.querySelector('button[aria-label="Show or hide columns"]'),
      "columns button",
    );
    toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const panel = await waitFor(() => doc.querySelector(".plegma-colmenu-panel"), "columns panel");
    const author = [...panel.querySelectorAll('[role="checkbox"]')].find((d) =>
      (d.textContent || "").includes("Author"),
    );
    assert.ok(author, "Author entry listed");
    author.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !doc.querySelector("th.plegma-meta-author"), "author column hidden");
    assert.equal(
      doc.querySelectorAll("td.plegma-meta-author").length,
      0,
      "author cells hidden too",
    );
    assert.ok(doc.querySelector("th.plegma-meta-date"), "date column untouched");
    // Showing it again brings the column back.
    const authorAgain = [...doc.querySelectorAll(".plegma-colmenu-panel [role=checkbox]")].find(
      (d) => (d.textContent || "").includes("Author"),
    );
    authorAgain.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !!doc.querySelector("th.plegma-meta-author"), "author column back");
  });

  it("re-queries the log when the commit order changes", async () => {
    const doc = dom.window.document;
    const select = await waitFor(
      () => doc.querySelector('select[aria-label="Commit order"]'),
      "order select",
    );
    assert.ok(select, "toolbar has an order select");
    assert.equal(select.value, "date", "date order by default");
    const mark = logArgsSeen.length;
    select.value = "author-date";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await waitFor(
      () => logArgsSeen.slice(mark).some((a) => a.order === "author-date"),
      "log re-queried with the new order",
    );
    assert.equal(
      logArgsSeen[logArgsSeen.length - 1].order,
      "author-date",
      "order sent to the backend",
    );
  });

  it("supports Ctrl+H to jump to HEAD and Ctrl+R to refresh", async () => {
    const doc = dom.window.document;
    const fire = (key) =>
      doc.body.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }),
      );
    fire("h");
    await waitFor(() => {
      const active = doc.querySelector("tr.plegma-row-active");
      return active && (active.textContent || "").includes("feat: render me");
    }, "HEAD row selected");
    const mark = seenRequests.length;
    fire("r");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (refresh)");
    // Inside a text field the shortcut belongs to the field, not the view.
    const search = doc.querySelector('input[aria-label^="Search commits"]');
    assert.ok(search, "search box present");
    const ev = new dom.window.KeyboardEvent("keydown", {
      key: "r",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false, "Ctrl+R in the search box is left alone");
  });

  it("shows one busy indicator for slow work and none for quick work", async () => {
    const doc = dom.window.document;
    const refresh = doc.querySelector('button[aria-label="Refresh"]');
    assert.ok(refresh, "refresh button rendered");
    // The status slot is always there, so the spinner can never push the
    // toolbar buttons (or the rows below) sideways.
    const slot = doc.querySelector(".plegma-status-slot");
    assert.ok(slot, "status slot rendered while idle");
    assert.match(slot.textContent || "", /commits?$/, "idle slot shows the loaded count");
    assert.equal(doc.querySelector(".plegma-spinner"), null, "no spinner while idle");
    // The indicator waits BUSY_DELAY_MS (120ms) before appearing, so a request
    // that comes back faster never makes the animation flicker.
    //
    // Watch the whole window rather than sampling once partway through: an
    // observer records whether the indicator was ever in the DOM, which is what
    // "never flickers" means and cannot be faked by checking after the fact.
    //
    // Answer the request with no hold at all. Holding it even 50ms left the
    // assertion straddling the 120ms threshold, and load() is not one request —
    // it is six in parallel, plus a second pass when the branch filter is on
    // its default — so on a loaded runner "fast" work still crossed 120ms.
    //
    // Settle first. This suite shares one jsdom across 84 tests, so requests
    // issued by earlier tests can still be in flight when this one starts —
    // they push busy depth on their own account and make the indicator appear
    // for reasons that have nothing to do with the click below. Watch with no
    // click for longer than the threshold and require that nothing shows.
    const seenDuring = [];
    const watch = new dom.window.MutationObserver(() => {
      const bar = doc.querySelector(".plegma-progress");
      const spin = doc.querySelector(".plegma-spinner");
      if (bar || spin) seenDuring.push({ bar: !!bar, spin: !!spin });
    });
    watch.observe(doc.body, { childList: true, subtree: true });
    await new Promise((r) => setTimeout(r, IDLE_SETTLE_MS));
    assert.deepEqual(seenDuring, [], "no leftover indicator from earlier tests");
    seenDuring.length = 0;

    let mark = seenRequests.length;
    slowNext = { method: "log", ms: 0 };
    refresh.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "quick refresh sent");
    // `refresh.disabled` tracks `loading`, which Vue only re-renders on the
    // next tick, so it is briefly still false. Wait for it to go busy first,
    // or this passes before the work has even started.
    await waitFor(() => refresh.disabled === true, "quick refresh started");
    await waitFor(() => refresh.disabled === false, "quick refresh finished");
    watch.disconnect();
    assert.ok(
      seenRequests.slice(mark).includes("log"),
      "the quick refresh was actually sent",
    );
    assert.deepEqual(seenDuring, [], "no indicator appeared at any point during quick work");
    assert.equal(doc.querySelector(".plegma-progress"), null, "no progress bar for quick work");
    assert.equal(doc.querySelector(".plegma-spinner"), null, "no spinner for quick work");
    // The label is load()'s to set and clear. If a quick load left it claimed,
    // the slow phase below would show a bar with no text naming the work.
    assert.equal(
      doc.querySelector(".plegma-busy-label"),
      null,
      "the quick load released the busy label",
    );

    // Hold the response and the same indicator shows for any action.
    mark = seenRequests.length;
    slowNext = { method: "log", ms: 600 };
    refresh.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "slow refresh sent");
    await waitFor(() => doc.querySelector(".plegma-progress"), "progress bar");
    assert.ok(
      doc.querySelector(".plegma-progress .plegma-progress-bar"),
      "the bar has the moving segment",
    );
    assert.ok(doc.querySelector(".plegma-spinner"), "spinner rendered");
    assert.match(
      (doc.querySelector(".plegma-busy-label") || {}).textContent || "",
      /Loading/,
      "the indicator says what is happening",
    );
    assert.equal(
      doc.querySelectorAll(".plegma-progress").length,
      1,
      "exactly one indicator, no duplicates",
    );
    assert.equal(
      doc.querySelector(".plegma-status-slot"),
      slot,
      "the same slot element is reused, so nothing shifts",
    );
    await waitFor(() => !doc.querySelector(".plegma-progress"), "indicator cleared");
    assert.equal(doc.querySelector(".plegma-spinner"), null, "spinner cleared too");
    assert.match(slot.textContent || "", /commits?$/, "the count comes back to the same slot");
  }, 30000);

  it("renders uncommitted changes as a graph node row above HEAD", async () => {
    const doc = dom.window.document;
    // Every row here, node row included.
    const rows = [...doc.querySelectorAll("tr.plegma-row")];
    // The fixture has one dirty file, so the node row leads the table.
    const node = rows[0];
    assert.ok(node.classList.contains("plegma-row-worktree"), "worktree node row rendered");
    assert.ok((node.textContent || "").includes("Uncommitted changes on"), "node row is labelled");
    assert.ok((node.textContent || "").includes("1 file"), "node row counts the dirty files");
    assert.ok(node.querySelector("circle"), "node row draws a graph node");
    const head = rows[1];
    assert.ok(head && (head.getAttribute("data-hash") || "") === "aaa111", "HEAD follows the node");
    // The worktree bar is still there; the node is in addition to it.
    assert.ok(doc.querySelector(".plegma-worktree-bar"), "worktree bar kept");
    // Clicking the node selects the worktree files.
    node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => doc.querySelectorAll(".plegma-filerow").length > 0,
      "worktree files listed",
    );
    const listed = [...doc.querySelectorAll(".plegma-filerow")].map((li) => li.textContent || "");
    assert.ok(
      listed.some((t) => t.includes("dirty.js")),
      "uncommitted file listed",
    );
  });

  it("manages remotes from the settings page", async () => {
    const doc = dom.window.document;
    // No toolbar shortcut: remotes live in settings only, so the button
    // would just be a second door to the same page.
    assert.equal(
      doc.querySelector('button[aria-label="Manage remotes"]'),
      null,
      "toolbar has no remotes button",
    );
    const btn = doc.querySelector('button[aria-label="Settings"]');
    assert.ok(btn, "settings button rendered");
    btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const section = await waitFor(
      () => doc.querySelector("#plegma-settings-remotes"),
      "remotes section",
    );
    assert.ok(rootText().includes("Settings"), "settings page shown");
    assert.ok(!doc.querySelector("tr.plegma-row"), "history hidden while settings open");
    await waitFor(() => seenRequests.includes("remoteDetails"), "details requested");
    await waitFor(
      () => (section.textContent || "").includes("git@x:plegma.git"),
      "remote list with URL",
    );
    assert.ok((section.textContent || "").includes("upstream"), "second remote listed");

    // Per-remote fetch goes through with the prune flag.
    let mark = seenRequests.length;
    const __pruneBox = [...section.querySelectorAll("input[type=checkbox]")].find((i) =>
      (i.parentElement.textContent || "").includes("Prune deleted"),
    );
    const fetchBtn = [...section.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Fetch",
    );
    fetchBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("fetchRemote"), "fetch requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (fetch)");
    assert.ok(!rootText().includes("failed"), "no error shown (fetch)");

    // Adding a remote sends name + URL and reloads the list.
    const nameInput = section.querySelector('input[aria-label="New remote name"]');
    const urlInput = section.querySelector('input[aria-label="New remote URL"]');
    nameInput.value = "mirror";
    nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    urlInput.value = "https://x/mirror.git";
    urlInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    mark = seenRequests.length;
    const addBtn = [...section.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Add",
    );
    assert.ok(addBtn, "Add button rendered");
    await waitFor(() => addBtn.disabled === false, "Add enabled with name and URL");
    addBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("addRemote"), "add requested");
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (add remote)");
    assert.ok(!rootText().includes("failed"), "no error shown (add remote)");

    // Deleting asks first, then removes.
    const delBtn = [...section.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Delete…",
    );
    delBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    const confirm = await waitFor(
      () =>
        [...doc.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Remove"),
      "delete confirm",
    );
    mark = seenRequests.length;
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("removeRemote"), "remove requested");
    await waitFor(
      () => seenRequests.slice(mark).includes("log"),
      "history reloaded (remove remote)",
    );
    assert.ok(!rootText().includes("failed"), "no error shown (remove remote)");

    // Back to history restores the rows.
    const back = [...doc.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Back to history",
    );
    back.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => doc.querySelectorAll("tr.plegma-row").length > 0, "history restored");
  }, 30000);
  it("opens the settings page with every section", async () => {
    const doc = dom.window.document;
    const gear = await waitFor(
      () => doc.querySelector('button[aria-label="Settings"]'),
      "settings button",
    );
    gear.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Settings"), "settings page");
    for (const section of [
      "General",
      "Fetch",
      "Reset",
      "Stash",
      "Columns",
      "Commits",
      "Branches",
      "Remotes",
    ]) {
      assert.ok(rootText().includes(section), `section "${section}" rendered`);
    }
    assert.ok(doc.querySelector("#plegma-settings-remotes"), "remotes section anchored");
    // Escape leaves the page.
    doc.body.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await waitFor(() => doc.querySelectorAll("tr.plegma-row").length > 0, "back to history");
  }, 30000);
  it("toggles avatars and the worktree node from settings", async () => {
    const doc = dom.window.document;
    const openSettings = async () => {
      doc
        .querySelector('button[aria-label="Settings"]')
        .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => rootText().includes("Settings"), "settings page");
    };
    const backToHistory = async () => {
      const back = [...doc.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "Back to history",
      );
      back.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => doc.querySelectorAll("tr.plegma-row").length > 0, "history restored");
    };
    const box = (label) =>
      [...doc.querySelectorAll(".plegma-settings-row")].find((r) =>
        (r.textContent || "").includes(label),
      );
    const toggle = (label) =>
      box(label)
        .querySelector('input[type="checkbox"]')
        .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.ok(doc.querySelector(".plegma-avatar"), "avatar shown by default");
    assert.ok(doc.querySelector("tr.plegma-row-worktree"), "worktree node shown by default");
    await openSettings();
    assert.ok(box("Show author avatars"), "avatar setting rendered");
    toggle("Show author avatars");
    toggle("Show uncommitted changes");
    await waitFor(
      () => dom.window.localStorage.getItem("plegma.showAvatars") === "false",
      "avatar choice persisted",
    );
    await waitFor(
      () => dom.window.localStorage.getItem("plegma.showWorktreeNode") === "false",
      "node choice persisted",
    );
    await backToHistory();
    assert.ok(!doc.querySelector(".plegma-avatar"), "avatars hidden in history");
    assert.ok(!doc.querySelector("tr.plegma-row-worktree"), "node row hidden in history");
    assert.ok(!doc.querySelector(".plegma-worktree-bar"), "worktree bar hidden in history");
    // Restore for the tests that follow.
    await openSettings();
    toggle("Show author avatars");
    toggle("Show uncommitted changes");
    await backToHistory();
    await waitFor(() => doc.querySelector(".plegma-avatar"), "avatars restored");
    await waitFor(() => doc.querySelector("tr.plegma-row-worktree"), "node row restored");
  }, 30000);

  it("changes the default reset mode from settings", async () => {
    const doc = dom.window.document;
    doc
      .querySelector('button[aria-label="Settings"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Default mode preselected"), "reset section");
    // The settings radios and the reset-confirm radios share values; scope
    // to the Reset section so the confirm dialog (not open) can't confuse us.
    const resetSection = [...doc.querySelectorAll(".plegma-settings-section")].find((el) =>
      (el.textContent || "").includes("Default mode preselected"),
    );
    const hard = resetSection.querySelector('input[type="radio"][value="hard"]');
    hard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => dom.window.localStorage.getItem("plegma.resetDefaultMode") === '"hard"',
      "default persisted",
    );
    // Restore mixed + history for the tests that follow.
    const mixed = resetSection.querySelector('input[type="radio"][value="mixed"]');
    mixed.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => dom.window.localStorage.getItem("plegma.resetDefaultMode") === '"mixed"',
      "mixed restored",
    );
    const back3 = [...doc.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Back to history",
    );
    back3.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => doc.querySelectorAll("tr.plegma-row").length > 0, "history restored");
  }, 30000);
  it("keeps a single toolbar row: commit filter plus action buttons, no date/path filters", () => {
    const inputs = [...dom.window.document.querySelectorAll("input")];
    const byPlaceholder = (p) => inputs.find((i) => i.getAttribute("placeholder") === p);
    assert.ok(byPlaceholder("Search commits"), "commit text filter rendered");
    assert.ok(!byPlaceholder("Author"), "no redundant author filter input");
    assert.ok(!byPlaceholder("Path (e.g. src/)"), "path filter input removed");
    const dates = inputs.filter((i) => i.getAttribute("type") === "date");
    assert.equal(dates.length, 0, "date filter inputs removed");
    const buttons = [...dom.window.document.querySelectorAll("button")].map((b) =>
      (b.textContent || "").trim(),
    );
    assert.ok(!buttons.includes("Clear"), "no Clear filters button");
    const toolbarButtons = [
      ...dom.window.document.querySelectorAll(".plegma-toolbar-actions button"),
    ].map((b) => b.getAttribute("aria-label") || b.textContent);
    assert.ok(
      !toolbarButtons.some((b) => b && ["Apply", "Clear"].includes(b)),
      "no Apply/Clear filters buttons in the toolbar",
    );
  });

  it("toggles the files panel between list and tree", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("src/app.js"), "files listed with full paths");
    const byLabel = (label) =>
      [...dom.window.document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
    assert.ok(byLabel("List view"), "list toggle rendered");
    assert.ok(byLabel("Tree view"), "tree toggle rendered");
    byLabel("Tree view").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => rootText().includes("src (2)") && rootText().includes("util.js"),
      "tree groups by directory",
    );
    assert.ok(!rootText().includes("src/app.js"), "tree shows basenames, not full paths");
    assert.ok(!rootText().includes("(root)"), "no pseudo-folder for top-level files");
    assert.ok(rootText().includes("README.md"), "top-level files list directly");
    const srcHeader = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("src (2)"),
    );
    assert.ok(srcHeader, "directory header with file count rendered");
    assert.ok(srcHeader.querySelector("svg"), "directory header uses native folder icons");
    const fileRow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("util.js"),
    );
    assert.ok(fileRow && fileRow.classList.contains("plegma-filerow"), "file rows use tree layout");
    assert.ok(fileRow.querySelector("svg"), "file rows show a file icon");
    assert.ok(
      fileRow.querySelector(".plegma-status"),
      "status letter sits right-aligned, native-style",
    );
    srcHeader.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !rootText().includes("util.js"), "collapsed directory hides its files");
    byLabel("List view").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("src/app.js"), "list mode restored");
  });

  it("closes the files panel and reopens it on another commit click", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("src/app.js"), "files listed");
    const close = [...dom.window.document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Close files panel",
    );
    assert.ok(close, "close button rendered");
    close.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !rootText().includes("src/app.js"), "panel closed");
    assert.ok(
      !dom.window.document.querySelector('[aria-label="Resize files panel"]'),
      "splitter hidden while the panel is closed",
    );
    rows[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        !rootText().includes("Loading files…") &&
        rootText().includes("src/app.js") &&
        dom.window.document.querySelector('[aria-label="Close files panel"]'),
      "panel reopened with new files",
    );
    // Restore the rows[0] selection: later tests assume a settled files list,
    // and switching commits shows a transient Loading state that would race
    // their text-based waits against Vue's async re-render.
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        !rootText().includes("Loading files…") &&
        [...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "selection restored",
    );
  });

  it("marks the active view toggle and themes plain buttons", async () => {
    const byLabel = (label) =>
      [...dom.window.document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
    const listBtn = byLabel("List view");
    const treeBtn = byLabel("Tree view");
    assert.ok(listBtn.classList.contains("plegma-seg"), "list toggle uses themed class");
    assert.ok(
      listBtn.classList.contains("plegma-seg-active"),
      "list toggle starts active (persisted default)",
    );
    treeBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        treeBtn.classList.contains("plegma-seg-active") &&
        !listBtn.classList.contains("plegma-seg-active"),
      "active state follows the selected view",
    );
    listBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        listBtn.classList.contains("plegma-seg-active") &&
        !treeBtn.classList.contains("plegma-seg-active"),
      "active state restored",
    );
    // The injected stylesheet must theme plain buttons (dark-mode readability).
    const css = [...dom.window.document.querySelectorAll("style")]
      .map((s) => s.textContent || "")
      .join("\n");
    assert.ok(
      css.includes("#root button:not(.plegma-icon-btn):not(.plegma-seg)"),
      "plain-button theme rule present",
    );
    assert.ok(css.includes("--vscode-button-secondaryBackground"), "uses theme button vars");
    assert.ok(css.includes(".plegma-seg-active"), "segmented active-state rule present");
  });

  it("previews inline diffs on file click and opens editor diffs via button", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // NOTE: wait for the rendered rows, not just the text — switching commits
    // shows a transient Loading state while the previous list is still in DOM.
    await waitFor(
      () =>
        !rootText().includes("Loading files…") &&
        [...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files listed",
    );
    const fileRow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("src/app.js"),
    );
    assert.ok(fileRow, "file row rendered");
    fileRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => rootText().includes("+new") && rootText().includes("-old"),
      "inline diff preview rendered",
    );
    const openBtn = [...dom.window.document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Open diff in editor",
    );
    assert.ok(openBtn, "visible open-diff button rendered");
    const mark = seenRequests.length;
    openBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("openDiff"), "openDiff requested");
  });

  it("resizes the inline split and truncates long filenames", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("src/app.js"), "files listed");
    const fileRow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("src/app.js"),
    );
    // Hovering a truncated name reveals the full path.
    assert.match(
      fileRow.getAttribute("title") || "",
      /src\/app\.js/,
      "row tooltip shows the full path",
    );
    fileRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("+new"), "inline split open");
    const splitter = dom.window.document.querySelector('[aria-label="Resize file list"]');
    assert.ok(splitter, "split handle rendered");
    const list = splitter.previousElementSibling;
    assert.equal(list.style.height, "200px", "list starts at default height");
    splitter.dispatchEvent(
      new dom.window.MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 100 }),
    );
    dom.window.dispatchEvent(
      new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 160 }),
    );
    dom.window.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    await waitFor(() => list.style.height === "260px", "list deepened by drag");
    // Filenames cannot spill out of the list: scrollable list + ellipsis label.
    assert.equal(list.style.overflow, "auto", "list scrolls instead of spilling");
    assert.equal(list.style.minWidth, "0px", "list may shrink below content");
    const label = fileRow.querySelector(".plegma-file-label");
    assert.ok(label, "filename uses ellipsis label class");
  });

  it("shows uncommitted changes with stash and commit actions", async () => {
    await waitFor(() => rootText().includes("Uncommitted changes on"), "worktree bar");
    assert.ok(rootText().includes("main"), "bar names the checked-out branch");
    assert.ok(rootText().includes("1 file"), "bar counts worktree files");
    const bar = dom.window.document.querySelector(".plegma-worktree-bar");
    assert.ok(bar, "worktree bar rendered");
    bar.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => rootText().includes("Files — Uncommitted changes"),
      "worktree files listed",
    );
    assert.ok(rootText().includes("dirty.js"), "worktree file shown");
    const wrow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("dirty.js"),
    );
    assert.ok(wrow, "worktree file row rendered");
    wrow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => rootText().includes("+wtnew") && rootText().includes("-wtold"),
      "worktree inline diff rendered",
    );
    const byLabel = (label) =>
      [...dom.window.document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
    let mark = seenRequests.length;
    byLabel("Stash changes").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (stash)");
    assert.ok(!rootText().includes("failed"), "no error shown (stash)");
    assert.ok(seenRequests.slice(mark).includes("stashPush"), "stashPush requested");
    mark = seenRequests.length;
    byLabel("Commit in Source Control").dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() => seenRequests.slice(mark).includes("revealScm"), "revealScm requested");
  });

  it("shows stash rows with apply, pop, branch, and drop actions", async () => {
    await waitFor(() => rootText().includes("stash@{0}"), "stash row");
    assert.ok(rootText().includes("WIP on main"), "stash row shows the message");
    const row = [...dom.window.document.querySelectorAll(".plegma-stash-row")].find((r) =>
      (r.textContent || "").includes("stash@{0}"),
    );
    assert.ok(row, "stash row rendered");
    for (const label of [
      "Apply stash@{0}",
      "Pop stash@{0}",
      "Branch from stash@{0}",
      "Drop stash@{0}",
    ]) {
      const btn = [...row.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
      assert.ok(btn, `stash row has "${label}" button`);
    }
    let mark = seenRequests.length;
    [...row.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === "Apply stash@{0}")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (stash apply)");
    assert.ok(!rootText().includes("failed"), "no error shown (stash apply)");
    assert.ok(seenRequests.slice(mark).includes("stashApply"), "stashApply requested");
    const dropBtn = [...row.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Drop stash@{0}",
    );
    dropBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("cannot be undone"), "drop confirm");
    const confirm = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Drop" && b.closest('[role="group"]'),
    );
    assert.ok(confirm, "drop confirm button rendered");
    mark = seenRequests.length;
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (stash drop)");
    assert.ok(!rootText().includes("failed"), "no error shown (stash drop)");
    assert.ok(seenRequests.slice(mark).includes("stashDrop"), "stashDrop requested");
  });

  it("hides stash rows that do not match the search filter", async () => {
    await waitFor(
      () => dom.window.document.querySelectorAll(".plegma-stash-row").length > 0,
      "stash rows rendered",
    );
    const filter = [...dom.window.document.querySelectorAll("input")].find((i) =>
      (i.getAttribute("placeholder") || "").includes("Search commits"),
    );
    assert.ok(filter, "commit filter input rendered");
    filter.value = "zzz-no-such-commit";
    filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(
      () => dom.window.document.querySelectorAll(".plegma-stash-row").length === 0,
      "stash hidden by filter",
    );
    filter.value = "";
    filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(
      () => dom.window.document.querySelectorAll(".plegma-stash-row").length > 0,
      "stash visible again",
    );
  });

  it("opens file revisions and working copies from file rows", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const fileRow = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll("li")].find((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files listed",
    );
    for (const title of ["View file at this revision", "Open working-copy file"]) {
      assert.ok(
        fileRow.querySelector(`button[title="${title}"]`),
        `file row has "${title}" button`,
      );
    }
    let mark = seenRequests.length;
    fileRow
      .querySelector('button[title="View file at this revision"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("openFileAtRevision"),
      "openFileAtRevision requested",
    );
    mark = seenRequests.length;
    fileRow
      .querySelector('button[title="Open working-copy file"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("openWorkingFile"),
      "openWorkingFile requested",
    );
  });

  it("copies relative and absolute file paths from the file menu", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const fileRow = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll("li")].find((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files listed",
    );
    dom.window.__copied.length = 0;
    fileRow.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 40 }),
    );
    const item = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item")].find(
          (d) => (d.textContent || "").trim() === "Copy relative path",
        ),
      "copy relative path item",
    );
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => dom.window.__copied.includes("src/app.js"), "relative path copied");
    fileRow.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 40 }),
    );
    const absItem = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item")].find(
          (d) => (d.textContent || "").trim() === "Copy absolute path",
        ),
      "copy absolute path item",
    );
    absItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => dom.window.__copied.includes("/repo/src/app.js"), "absolute path copied");
  }, 30000);

  it("offers compare-with-local on each non-deleted file", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const btn = await waitFor(
      () => dom.window.document.querySelector('button[title="Compare with local version"]'),
      "compare button",
    );
    assert.ok(btn, "compare-with-local button rendered for the Modified file");
  });

  it("asks for confirmation before reverting a file", async () => {
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const btn = await waitFor(
      () => dom.window.document.querySelector('button[title="Revert to this revision"]'),
      "revert button",
    );
    assert.ok(btn, "revert button rendered for the Modified file");
    btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => bodyText().includes("Local changes will be lost"), "revert confirm box");
  });

  it("shows a merge banner with continue and abort while merging", async () => {
    mergeFixture.inProgress = true;
    mergeFixture.conflictedFiles = ["f.txt"];
    try {
      const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
      const chip = refChip("feature");
      assert.ok(chip, "feature branch chip rendered");
      chip.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
      );
      const item = await waitFor(() => findMenuItem("Merge feature into main"), "merge menu item");
      assert.ok(item, "merge menu item rendered");
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await waitFor(() => {
        const t = bodyText();
        return (
          t.includes("Merge in progress") &&
          t.includes("f.txt") &&
          t.includes("Continue") &&
          t.includes("Abort")
        );
      }, "merge banner with files");
      const body = bodyText();
      assert.ok(body.includes("f.txt"), "banner names the conflicted file");
      assert.ok(body.includes("Continue"), "banner offers Continue");
      assert.ok(body.includes("Abort"), "banner offers Abort");
    } finally {
      mergeFixture.inProgress = false;
      mergeFixture.conflictedFiles = [];
    }
  });

  it("updates a dormant branch in place without switching to it", async () => {
    // feature is not checked out: Update fast-forwards it with a fetch
    // instead of the checkout/stash/pull dance, which is reserved for the
    // checked-out branch.
    const mark = seenRequests.length;
    const argMark = seenRequestArgs.length;
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const item = await waitFor(
      () => findMenuItem("Update feature from origin/feature"),
      "branch menu update",
    );
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (update)");
    assert.ok(!rootText().includes("failed"), "no error shown (update)");
    const tail = seenRequests.slice(mark);
    assert.ok(
      tail.includes("fetchRemoteBranch"),
      `update ran one fetchRemoteBranch call, got ${tail.join(",")}`,
    );
    assert.ok(!tail.includes("updateBranch"), "no checkout dance for a dormant branch");
    assert.deepEqual(
      seenRequestArgs
        .slice(argMark)
        .map((r) => r.method)
        .filter((m) => m === "fetchRemoteBranch"),
      ["fetchRemoteBranch"],
      "in-place fetch requested once",
    );
    const fetchCall = seenRequestArgs.slice(argMark).find((r) => r.method === "fetchRemoteBranch");
    assert.equal(fetchCall.args.remote, "origin");
    assert.equal(fetchCall.args.branch, "feature");
    assert.equal(fetchCall.args.local, "feature", "in-place fetch targets the branch itself");
  });

  it("offers no Update for a branch without an upstream", async () => {
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    const chip = spans.find((s) => (s.textContent || "").trim() === "lonely");
    assert.ok(chip, "lonely branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy branch name"), "lonely branch menu");
    // There is nothing to pull, so the action is not offered at all — not
    // offered and greyed, which was the old shape.
    assert.ok(
      !menuItems().some((t) => t.includes("Update lonely")),
      "no Update item for a branch with no upstream",
    );
    assert.ok(!bodyText().includes("nothing to pull"), "no explanation row either");
    // The actions that do work are still there.
    assert.ok(menuItems().includes("Push lonely to its remote"));
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");
  });

  it("offers no Update for a branch whose upstream is gone", async () => {
    // stale tracks origin/stale, but no such remote ref is loaded (deleted
    // on the remote, pruned locally): there is nothing to pull, so the
    // action is absent rather than failing in the backend.
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    const chip = spans.find((s) => (s.textContent || "").trim() === "stale");
    assert.ok(chip, "stale branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy branch name"), "stale branch menu");
    assert.ok(
      !menuItems().some((t) => t.includes("Update stale") || t.includes("Pull latest")),
      "no Update item for a branch with a gone upstream",
    );
    // The actions that do work are still there.
    assert.ok(menuItems().includes("Push stale to origin/stale"));
    assert.ok(menuItems().includes("Delete stale"));
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");
  });

  it("leads the branch menu with Update", async () => {
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(
      () => menuItems().includes("Update feature from origin/feature"),
      "branch menu update",
    );
    const items = [...dom.window.document.querySelectorAll(".plegma-menu .plegma-menu-item")].map(
      (d) => (d.textContent || "").trim(),
    );
    assert.equal(items[0], "Update feature from origin/feature", "update is the first menu item");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");
    // Same for the checked-out branch, with its own wording.
    const head = [...dom.window.document.querySelectorAll("span.plegma-ref")].find((s) =>
      s.classList.contains("plegma-ref-head"),
    );
    assert.ok(head, "HEAD chip rendered");
    head.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Pull latest into main"), "head branch menu");
    const headItems = [
      ...dom.window.document.querySelectorAll(".plegma-menu .plegma-menu-item"),
    ].map((d) => (d.textContent || "").trim());
    assert.equal(headItems[0], "Pull latest into main", "pull leads the head menu");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");
  });

  it("closes the menu when focus leaves the tab", async () => {
    // Clicks outside the Plegma tab never reach the webview, so the
    // click-closer misses them; the focus move fires blur instead.
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    await waitFor(() => menuItems().includes("Copy branch name"), "branch menu");
    dom.window.dispatchEvent(new dom.window.Event("blur"));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu closed by blur");
    assert.ok(!menuItems().includes("Copy branch name"), "no menu items linger after blur");
  });

  it("discards uncommitted changes after confirming Drop", async () => {
    assert.ok(bodyText().includes("Uncommitted changes"), "uncommitted bar rendered");
    const mark = seenRequests.length;
    const drop = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Drop…",
    );
    assert.ok(drop, "Drop button rendered in the uncommitted bar");
    drop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("cannot be undone"), "discard confirm");
    const confirm = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Discard",
    );
    assert.ok(confirm, "discard confirm button rendered");
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => bodyText().includes("Discarded"), "discard status");
    assert.ok(
      seenRequests.slice(mark).includes("discardWorktree"),
      "discard ran one discardWorktree call",
    );
  });

  it("opens the reset confirm with the default mode and radios", async () => {
    const rows = commitRows();
    assert.ok(rows.length > 0, "commit rows rendered");
    // Not the tip: resetting to where you already are is not offered.
    const base = rows.find((r) => (r.textContent || "").includes("chore: base"));
    base.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 60 }),
    );
    await waitFor(() => bodyText().includes("Copy Commit Hash"), "commit menu");
    const item = findMenuItem("Reset current branch to here…");
    assert.ok(item, "reset menu item rendered");
    item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // No native picker: the confirm opens straight away with the default
    // mode from settings (mixed).
    await waitFor(() => bodyText().includes("(mixed)?"), "reset confirm dialog");
    assert.ok(bodyText().includes("feat: render me"), "commit list still rendered");
    // Switching the radio updates the confirm text.
    const hard = dom.window.document.querySelector('input[type="radio"][value="hard"]');
    assert.ok(hard, "mode radios rendered");
    hard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => bodyText().includes("(hard)?"), "confirm follows the radio");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !bodyText().includes("(hard)?"), "reset dialog closed by Escape");
  });

  it("left-clicking a chip selects its commit without opening a menu", async () => {
    // Menus are a right-click gesture. A left click belongs to the row, so
    // it selects — and nothing pops up, not even after the old 280ms delay.
    const rows = commitRows();
    const other = rows.find((r) => (r.textContent || "").includes("feat: render me"));
    other.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => other.classList.contains("plegma-row-active"), "other row selected");
    const mark = seenRequests.length;
    const chip = refChip("feature");
    const chipRow = chipForRow(chip);
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        chipRow.classList.contains("plegma-row-active") &&
        !other.classList.contains("plegma-row-active"),
      "the chip click selected its own commit",
    );
    await waitFor(() => seenRequests.slice(mark).includes("files"), "the panel loaded that commit");
    await new Promise((r) => setTimeout(r, 450));
    assert.ok(!dom.window.document.querySelector(".plegma-menu"), "no menu opens on a left click");
  });

  it("double-clicking a branch chip checks it out, with no menu in the way", async () => {
    const mark = seenRequests.length;
    const chip = refChip("feature");
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    chip.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
    await waitFor(
      () => seenRequests.slice(mark).includes("checkout"),
      "checkout requested by double-click",
    );
    assert.ok(
      !dom.window.document.querySelector(".plegma-menu"),
      "double-click checks out without opening a menu",
    );
  });

  it("gives a ref chip the same menu as its commit, plus the branch's actions", async () => {
    // The complaint this answers: a chip and its own commit title used to
    // open two unrelated menus. Now the chip opens the commit's menu with
    // the branch's actions appended — same items, same order — led by
    // Update when the branch tracks a live remote ref.
    const row = commitRows().find((r) => (r.textContent || "").includes("chore: base"));
    assert.ok(row, "base row rendered");
    row.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => menuItems().includes("Copy Commit Hash"), "commit menu");
    const commitItems = menuItems();
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-menu"), "menu dismissed");

    const chip = row.querySelector("span.plegma-ref");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => menuItems().includes("Copy branch name"), "chip menu");
    const chipItems = menuItems();
    for (const item of commitItems) {
      assert.ok(chipItems.includes(item), `the chip menu keeps "${item}"`);
    }
    // Update leads the chip menu; the commit's actions follow in the same
    // order as the row menu.
    assert.equal(
      chipItems[0],
      "Update feature from origin/feature",
      "update is the first chip menu item",
    );
    assert.deepEqual(
      chipItems.slice(1).filter((i) => commitItems.includes(i)),
      commitItems,
      "the commit's actions follow, in the same order",
    );
    for (const item of [
      "Update feature from origin/feature",
      "Merge feature into main",
      "Push feature to origin/feature",
      "Force Push feature…",
      "Delete feature and its worktree",
      "Rename feature…",
      "Merge origin/feature into main",
      "Delete feature from origin",
      "Copy branch name",
    ]) {
      assert.ok(chipItems.includes(item), `the chip menu adds "${item}"`);
    }
    assert.ok(
      !chipItems.some((i) => i.startsWith("Fetch origin/")),
      "no separate fetch item: Update owns the fast-forward",
    );
    // And nothing is offered twice: what the commit's own items already
    // cover is not repeated under the chip.
    const newItems = chipItems.filter((i) => !commitItems.includes(i));
    for (const item of newItems) {
      assert.equal(
        newItems.filter((i) => i === item).length,
        1,
        `"${item}" appears once in the chip menu`,
      );
    }
    assert.ok(
      !chipItems.includes("Check out"),
      "no bare Check out: the commit's own Checkout list covers it",
    );
    assert.ok(!chipItems.includes("New branch from here…"), "no duplicate of Create Branch…");
    // Both menus name the commit they act on, above the chip they came from.
    const headerText = [...dom.window.document.querySelectorAll(".plegma-menu-header")]
      .map((d) => d.textContent || "")
      .join(" | ");
    assert.match(headerText, /feature/);
    assert.match(headerText, /origin\/feature/);
    assert.match(headerText, /bbb222/);
  });

  it("selects a commit when its subject text is clicked", async () => {
    // The subject used to stop click propagation, so the biggest target in
    // the row silently did nothing.
    const rows = commitRows();
    const row = rows.find((r) => (r.textContent || "").includes("chore: base"));
    const other = rows.find((r) => (r.textContent || "").includes("feat: render me"));
    other.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => other.classList.contains("plegma-row-active"), "other row selected");
    const mark = seenRequests.length;
    const subject = row.querySelector(".plegma-subject");
    assert.ok(subject, "subject rendered");
    subject.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => row.classList.contains("plegma-row-active"),
      "the subject click selected the commit",
    );
    await waitFor(() => seenRequests.slice(mark).includes("files"), "the side panels loaded it");
  });

  it("keeps the selected row's cells in their columns", async () => {
    // The selection bar used to be a ::before with content on the <tr>
    // itself, which Chrome lays out as an anonymous table cell — shifting
    // the selected row's cells one column right, so the graph nodes landed
    // where the ref chips are. The bar now hangs off the first cell
    // instead. jsdom has no layout, so guard the anchor in the injected
    // stylesheet and the row's cell structure in the DOM.
    const css = [...dom.window.document.querySelectorAll("style")]
      .map((s) => s.textContent || "")
      .join("\n");
    assert.ok(!css.includes(".plegma-row-active::before"), "no row-level selection bar");
    assert.ok(!css.includes(".plegma-row-checked::before"), "no row-level ticked bar");
    assert.ok(css.includes("td:first-child::before"), "the bar hangs off the first cell");
    const rows = commitRows();
    const row = rows.find((r) => (r.textContent || "").includes("chore: base"));
    row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => row.classList.contains("plegma-row-active"), "row selected");
    const sibling = rows.find((r) => r !== row);
    assert.deepEqual(
      [...row.children].map((td) => td.className),
      [...sibling.children].map((td) => td.className),
      "selected row keeps the same cells as its siblings",
    );
  });

  it("closes the branch menu with Escape", async () => {
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const branchItems = () =>
      [...dom.window.document.querySelectorAll(".plegma-menu-item")].filter((d) =>
        (d.textContent || "").includes("Copy branch name"),
      );
    await waitFor(() => branchItems().length > 0, "branch menu");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => branchItems().length === 0, "branch menu closed by Escape");
  });

  it("offers force-delete when safe delete refuses an unmerged branch", async () => {
    // NOTE: assert against #root text, not body text — the inlined bundle
    // <script> contains these static labels, so body text matches vacuously.
    const spans = [...dom.window.document.querySelectorAll("span.plegma-ref")];
    const chip = refChip("feature");
    assert.ok(chip, "feature branch chip rendered");
    chip.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }),
    );
    const deleteItem = await waitFor(
      () =>
        [...dom.window.document.querySelectorAll(".plegma-menu-item")].find((d) =>
          (d.textContent || "").trim().startsWith("Delete"),
        ),
      "branch menu",
    );
    assert.ok(deleteItem, "delete menu item rendered");
    failNext = {
      method: "deleteBranch",
      error: "Branch 'feature' is not fully merged.",
      extra: { notMerged: true },
    };
    deleteItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("is not fully merged"), "force-delete confirm");
    const forceBtn = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Force delete",
    );
    assert.ok(forceBtn, "force-delete button rendered");
    forceBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => rootText().includes("Deleted branch feature (forced)."),
      "forced delete confirmed",
    );
  });

  it("renders resizable history columns that respond to drag", async () => {
    const handles = [...dom.window.document.querySelectorAll(".plegma-resizer")];
    assert.equal(handles.length, 2, "Author/Date columns have resize handles");
    const cols = [...dom.window.document.querySelectorAll("colgroup col")];
    assert.equal(cols.length, 4, "colgroup sizes all four columns");
    assert.equal(cols[2].style.width, "140px", "Author starts at 140px");
    handles[0].dispatchEvent(
      new dom.window.MouseEvent("mousedown", { bubbles: true, clientX: 100 }),
    );
    dom.window.dispatchEvent(
      new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 150 }),
    );
    dom.window.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    await waitFor(
      () => [...dom.window.document.querySelectorAll("colgroup col")][2].style.width === "190px",
      "Author column widened by drag",
    );
  });

  it("resizes the files panel with the splitter", async () => {
    const splitter = dom.window.document.querySelector('[aria-label="Resize files panel"]');
    assert.ok(splitter, "panel splitter rendered");
    assert.equal(splitter.nextElementSibling.style.width, "380px", "panel width starts automatic");
    splitter.dispatchEvent(
      new dom.window.MouseEvent("mousedown", { bubbles: true, clientX: 500, clientY: 10 }),
    );
    dom.window.dispatchEvent(
      new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 400, clientY: 10 }),
    );
    dom.window.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    await waitFor(
      () => splitter.nextElementSibling.style.width === "240px",
      "panel resized and clamped",
    );
    splitter.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
    await waitFor(
      () => splitter.nextElementSibling.style.width === "380px",
      "double-click restores automatic width",
    );
  });

  it("docks the files panel to the right of the graph", () => {
    const graphPane = dom.window.document.querySelector('[aria-label="Commit graph"]');
    const splitter = dom.window.document.querySelector('[aria-label="Resize files panel"]');
    assert.ok(graphPane && splitter, "graph and splitter rendered");
    const row = graphPane.parentElement;
    assert.ok(row, "graph sits in a content row");
    assert.equal(row.style.display, "flex", "content row is flex");
    assert.equal(row.style.flexDirection, "row", "graph and files split left/right");
    assert.equal(
      graphPane.nextElementSibling,
      splitter,
      "splitter sits between graph and files panel",
    );
  });

  it("keeps graph edges connected when searching", async () => {
    const filter = [...dom.window.document.querySelectorAll("input")].find((i) =>
      (i.getAttribute("placeholder") || "").includes("Search commits"),
    );
    assert.ok(filter, "commit filter input rendered");
    filter.value = "filler 1";
    filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => {
      const rows = commitRows();
      return rows.length > 0 && rows.every((r) => (r.textContent || "").includes("filler 1"));
    }, "search narrows to matches");
    for (const row of commitRows()) {
      assert.ok(row.querySelectorAll("circle").length > 0, "match draws its graph node");
    }
    assert.ok(
      [...dom.window.document.querySelectorAll("tr.plegma-row path")].length > 0,
      "filtered view still draws edges between visible commits",
    );
    filter.value = "";
    filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => commitRows().length >= 200, "filter cleared", 30000);
  }, 60000);

  it("shows one hover card with every ref named and no hand-holding", async () => {
    // Native tooltips on the row's children used to stack a second popup
    // over the hover card; chips carry accessible names instead, and the
    // card states the facts.
    const row = commitRows().find((r) => (r.textContent || "").includes("chore: base"));
    assert.ok(row, "base row rendered");
    for (const el of row.querySelectorAll("[title]")) {
      assert.equal(
        el.getAttribute("title"),
        null,
        `no native tooltip inside a hovered row, found on ${el.className}`,
      );
    }
    const chip = row.querySelector("span.plegma-ref");
    assert.ok(chip, "ref chip rendered");
    assert.ok(chip.getAttribute("aria-label"), "chip keeps an accessible name");
    // mouseenter does not bubble; the graph cell (the whole lane column)
    // starts both lineage and the card — hover the cell, not the 4px node
    // circle inside it.
    const cell = row.querySelector("td.plegma-graph-cell");
    assert.ok(cell, "graph cell rendered");
    cell.dispatchEvent(
      new dom.window.MouseEvent("mouseenter", { bubbles: false, clientX: 30, clientY: 30 }),
    );
    const card = await waitFor(
      () => dom.window.document.querySelector(".plegma-hover-card"),
      "hover card",
    );
    assert.equal(dom.window.document.querySelectorAll(".plegma-hover-card").length, 1, "one popup");
    const text = card.textContent || "";
    for (const bit of ["Branches:", "Tags:", "feature", "origin/feature", "lonely", "v0.1"]) {
      assert.ok(text.includes(bit), `hover card mentions "${bit}"`);
    }
    // One chip per ref, each with its own full name: the graph folds a
    // local branch and its same-named remote into one cloud chip, and the
    // popup undoes that fold.
    const cardChips = [...card.querySelectorAll("span.plegma-ref")];
    assert.deepEqual(
      Array.from(cardChips).map((c) => (c.textContent || "").trim()),
      ["feature", "origin/feature", "lonely", "v0.1", "v0.0"],
      "local and remote branches are separate chips",
    );
    const remote = cardChips.find((c) => (c.textContent || "").trim() === "origin/feature");
    assert.ok(
      remote.classList.contains("plegma-ref-remote"),
      "the remote ref is marked as remote, not folded into the local chip",
    );
    for (const c of cardChips) {
      const rowChip = refChip((c.textContent || "").trim());
      assert.equal(
        c.getAttribute("style"),
        rowChip && rowChip.getAttribute("style"),
        `chip "${c.textContent}" is colored like the row's`,
      );
    }
    // No helper prose: the popup states facts, it does not explain itself.
    for (const prose of [
      "is published as",
      "is checked out in worktree",
      "Right-click a branch",
      "double-click to check out",
    ]) {
      assert.ok(!text.includes(prose), `no "${prose}" in the popup`);
    }
    // The worktree is still discoverable, on the chip itself.
    assert.match(refChip("feature").getAttribute("aria-label") || "", /\/wt\/feature/);
    // Chips in the popup may use the card's full width and wrap; the graph
    // row keeps its ellipsis, so a long name is only ever clipped there.
    const cardChipStyle = dom.window.document.querySelector("style");
    const css = cardChipStyle ? cardChipStyle.textContent || "" : "";
    assert.match(
      css,
      /\.plegma-hover-card \.plegma-ref\{max-width:100%\}/,
      "popup chips are not width-capped",
    );
    assert.match(
      css,
      /\.plegma-hover-card \.plegma-ref-label\{[^}]*white-space:normal/,
      "popup chip labels wrap instead of ellipsizing",
    );
    // The full hash and every parent, no longer behind a tooltip.
    assert.ok(text.includes("bbb222"), "hover card shows the full hash");
    card.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-hover-card"), "card closed");
  }, 30000);

  it("summarizes the change in the hover card, like the native popup", async () => {
    // The native graph hover ends with "N files changed +A -D"; the same
    // numbers ride along on every commit of the log.
    const row = commitRows().find((r) => (r.textContent || "").includes("feat: render me"));
    const cell = row.querySelector("td.plegma-graph-cell");
    assert.ok(cell, "graph cell rendered");
    cell.dispatchEvent(
      new dom.window.MouseEvent("mouseenter", { bubbles: false, clientX: 30, clientY: 30 }),
    );
    const card = await waitFor(
      () => dom.window.document.querySelector(".plegma-hover-card"),
      "hover card",
    );
    const stats = card.querySelector(".plegma-hover-stats");
    assert.ok(stats, "the card summarizes what the commit changed");
    assert.match(stats.textContent || "", /3 files changed/);
    assert.match(stats.textContent || "", /\+12/);
    assert.match(stats.textContent || "", /-4/);
    card.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-hover-card"), "card closed");
    // A commit with no diff (a merge) says nothing rather than "0 files".
    const base = commitRows().find((r) => (r.textContent || "").includes("chore: base"));
    const baseCell = base.querySelector("td.plegma-graph-cell");
    assert.ok(baseCell, "base graph cell rendered");
    baseCell.dispatchEvent(
      new dom.window.MouseEvent("mouseenter", { bubbles: false, clientX: 30, clientY: 30 }),
    );
    const second = await waitFor(
      () => dom.window.document.querySelector(".plegma-hover-card"),
      "second hover card",
    );
    assert.ok(
      !second.querySelector(".plegma-hover-stats"),
      "no change summary for a commit with no diff",
    );
    second.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-hover-card"), "card closed");
  }, 30000);

  it("opens the hover card from the whole row, lineage from the graph cell only", async () => {
    const sideRow = commitRows().find((r) => (r.textContent || "").includes("side: experiment"));
    assert.ok(sideRow, "side-branch row rendered");
    const cell = sideRow.querySelector("td.plegma-graph-cell");
    assert.ok(cell, "graph cell rendered");
    const title = sideRow.querySelector(".plegma-subject");
    assert.ok(title, "subject title rendered");
    // Anywhere on the row (title, chips, meta) opens the card after the
    // hover delay, but the lineage stays flat: dimming belongs to the graph.
    sideRow.dispatchEvent(
      new dom.window.MouseEvent("mouseenter", { bubbles: false, clientX: 300, clientY: 30 }),
    );
    assert.ok(
      !dom.window.document.querySelector(".plegma-hover-card"),
      "no card before the hover delay",
    );
    const rowCard = await waitFor(
      () => dom.window.document.querySelector(".plegma-hover-card"),
      "hover card from the row",
    );
    assert.ok((rowCard.textContent || "").includes("side: experiment"), "card for the hovered row");
    assert.ok(
      commitRows().every((r) => !r.style.opacity),
      "no lineage from the row outside the graph cell",
    );
    sideRow.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-hover-card"), "card closed");
    // The graph cell lights up its lineage immediately.
    sideRow.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
    cell.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
    await waitFor(() => {
      const rows = commitRows();
      return rows.filter((r) => r.style.opacity === "0.35").length > 50;
    }, "lineage dims unrelated rows");
    assert.equal(sideRow.style.opacity, "", "hovered lineage stays undimmed");
    // Pointer jitter inside the cell (node to lane line and back) must not
    // cancel the pending popup: the inner shapes carry no hover handlers
    // of their own, so moving across them fires no leave on the cell.
    const innerNode = cell.querySelector("circle");
    assert.ok(innerNode, "commit node rendered");
    const lane = cell.querySelector("path");
    assert.ok(lane, "lane line rendered");
    innerNode.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
    lane.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
    const card = await waitFor(
      () => dom.window.document.querySelector(".plegma-hover-card"),
      "hover card survives jitter inside the cell",
    );
    assert.ok(card, "hover card opens from the graph cell");
    // Moving from the graph on to the title clears the lineage but keeps
    // the card: it belongs to the row.
    cell.dispatchEvent(
      new dom.window.MouseEvent("mouseleave", { bubbles: false, relatedTarget: title }),
    );
    await waitFor(() => commitRows().every((r) => !r.style.opacity), "highlight cleared");
    assert.ok(dom.window.document.querySelector(".plegma-hover-card"), "card stays on the row");
    sideRow.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !dom.window.document.querySelector(".plegma-hover-card"), "card closed");
  }, 60000);

  it("loads more commits on demand and on scroll", async () => {
    await waitFor(() => rootText().includes("Showing 200 of 200 commits"), "full page");
    const moreBtn = [...dom.window.document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Load more",
    );
    assert.ok(moreBtn, "load-more button rendered");
    moreBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Showing 400 of 400 commits"), "limit raised");
    const graphPane = dom.window.document.querySelector('[aria-label="Commit graph"]');
    assert.ok(graphPane, "graph scroll container rendered");
    graphPane.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
    await waitFor(() => rootText().includes("Showing 600 of 600 commits"), "scroll auto-loads");
  }, 60000);

  it("renders the toolbar and selection hint", () => {
    const buttons = [...dom.window.document.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") || b.textContent,
    );
    for (const label of ["Refresh", "Fetch from remote"]) {
      assert.ok(
        buttons.some((b) => b && b.includes(label)),
        `toolbar has ${label}`,
      );
    }
    assert.ok(
      !buttons.some((b) => b && (b.includes("Push") || b === "Prune" || b === "Sync")),
      "toolbar has no sync/push/force-push/prune buttons",
    );
  });

  it("opens a fetch options dialog with remembered options", async () => {
    const fetchBtn = [...dom.window.document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Fetch from remote",
    );
    assert.ok(fetchBtn, "fetch toolbar button rendered");
    fetchBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    const boxes = await waitFor(() => {
      const found = [...dom.window.document.querySelectorAll("#root input[type=checkbox]")];
      return found.length === 3 && found;
    }, "fetch dialog with options");
    assert.equal(boxes[0].checked, true, "prune branches starts checked (previous behavior)");
    assert.equal(boxes[1].checked, false, "prune tags starts unchecked");
    assert.equal(boxes[2].checked, false, "ask-again starts unchecked");
    boxes[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => boxes[1].checked === true, "prune tags toggled");
    const run = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Fetch",
    );
    assert.ok(run, "fetch confirm button rendered");
    const mark = seenRequests.length;
    run.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark).includes("log"), "history reloaded (fetch)");
    assert.ok(!rootText().includes("failed"), "no error shown (fetch)");
    fetchBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => {
      const found = [...dom.window.document.querySelectorAll("#root input[type=checkbox]")];
      return found.length === 3 && found[1].checked === true;
    }, "prune tags choice remembered");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(
      () => dom.window.document.querySelectorAll("#root input[type=checkbox]").length === 0,
      "fetch dialog closed by Escape",
    );
    // "Don't ask again": the next toolbar fetch runs straight through.
    fetchBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    const remember = await waitFor(() => {
      const found = [...dom.window.document.querySelectorAll("#root input[type=checkbox]")];
      return found.length === 3 && found[2];
    }, "dialog reopened");
    remember.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => remember.checked === true, "don't-ask ticked");
    const run2 = [...dom.window.document.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Fetch",
    );
    const mark2 = seenRequests.length;
    run2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => seenRequests.slice(mark2).includes("fetch"), "fetch ran");
    await waitFor(() => seenRequests.slice(mark2).includes("log"), "history reloaded");
    fetchBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      dom.window.document.querySelectorAll("#root input[type=checkbox]").length,
      0,
      "no dialog when asking is off",
    );
    assert.ok(
      seenRequests.slice(mark2).filter((m) => m === "fetch").length >= 2,
      "toolbar fetch ran straight through",
    );
    // The settings page brings the dialog back.
    const doc = dom.window.document;
    doc
      .querySelector('button[aria-label="Settings"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("Ask for options before fetching"), "ask setting");
    const askRow = [...doc.querySelectorAll(".plegma-settings-row")].find((r) =>
      (r.textContent || "").includes("Ask for options before fetching"),
    );
    askRow
      .querySelector('input[type="checkbox"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () => dom.window.localStorage.getItem("plegma.fetchOptions").includes('"ask":true'),
      "asking re-enabled",
    );
    // Let the fetch above finish loading before asserting on the restored view.
    // load() resolves six requests in parallel and only then sets `commits`, so
    // a still-pending load leaves the row count at zero and "history restored"
    // fails for a reason that has nothing to do with the Back button.
    const back = [...doc.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "Back to history",
    );
    back.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // Generous timeout. Vue renders asynchronously after the click, and the
    // fetch above left a load() in flight whose six parallel requests have to
    // settle before `commits` is populated — all of that on a loaded machine.
    // The default 5s was not always enough, and a timeout here reads as "Back
    // to history is broken" when nothing about that button is at fault.
    await waitFor(
      () => doc.querySelectorAll("tr.plegma-row").length > 0,
      "history restored",
      20000,
    );
    fetchBtn.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 }),
    );
    await waitFor(() => {
      const found = [...dom.window.document.querySelectorAll("#root input[type=checkbox]")];
      return found.length === 3 && found;
    }, "dialog back after re-enabling");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(
      () => dom.window.document.querySelectorAll("#root input[type=checkbox]").length === 0,
      "dialog closed again",
    );
  }, 30000);

  it("collapses commit-details panes via chevrons with independent scroll", async () => {
    const findFileRow = () =>
      [...dom.window.document.querySelectorAll("li")].find((li) =>
        (li.textContent || "").includes("src/app.js"),
      );
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // The click can trigger an async files reload while the stale list of
    // the previously selected commit is still rendered (the harness serves
    // identical files for every commit). One macrotask round-trip lets the
    // selection watcher fire, so the settled check below never observes
    // the stale list.
    await new Promise((r) => setTimeout(r, 100));
    const fileRow = await waitFor(() => {
      if (rootText().includes("Loading files…")) {
        return false;
      }
      return findFileRow() || false;
    }, "files settled after reload");
    fileRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("+new"), "diff pane open");
    const header = (label) => dom.window.document.querySelector(`[aria-label="${label}"]`);
    const filesHeader = header("Toggle Files section");
    const diffHeader = header("Toggle Diff section");
    const detailsHeader = header("Toggle Details section");
    assert.ok(filesHeader, "Files pane header rendered");
    assert.ok(diffHeader, "Diff pane header rendered");
    assert.ok(detailsHeader, "Details pane header rendered");
    for (const h of [filesHeader, diffHeader, detailsHeader]) {
      assert.ok(h.querySelector("svg"), "pane header carries a chevron");
      assert.equal(h.getAttribute("aria-expanded"), "true", "panes start expanded");
    }
    // Each pane body scrolls on its own; the outer panel never scrolls as one block.
    const list = dom.window.document.querySelector(
      '[aria-label="Resize file list"]',
    ).previousElementSibling;
    const diffBody = diffHeader.nextElementSibling;
    const detailsBody = detailsHeader.nextElementSibling;
    assert.equal(list.style.overflow, "auto", "file list scrolls independently");
    assert.equal(diffBody.style.overflow, "auto", "diff preview scrolls independently");
    assert.equal(detailsBody.style.overflow, "auto", "details scroll independently");
    assert.equal(detailsBody.style.flex, "1 1 0%", "details fills the remaining space");
    // Collapse Files: list hidden, diff + details stay.
    filesHeader.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        ![...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files collapsed",
    );
    assert.ok(rootText().includes("+new"), "diff stays visible while files collapsed");
    assert.ok(rootText().includes("longer description here"), "details stay while files collapsed");
    filesHeader.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        [...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files re-expanded",
    );
    // Collapse Details: commit body hidden, files + diff stay.
    detailsHeader.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !rootText().includes("longer description here"), "details collapsed");
    assert.ok(rootText().includes("src/app.js"), "files stay while details collapsed");
    detailsHeader.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("longer description here"), "details re-expanded");
  }, 30000);

  it("treats the diff preview as a resizable conditional pane", async () => {
    const header = (label) => dom.window.document.querySelector(`[aria-label="${label}"]`);
    // No file selected → no diff pane at all. Allow one round-trip for
    // the selection watcher (see the pane-collapse test above).
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    await waitFor(
      () =>
        !rootText().includes("Loading files…") &&
        [...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files settled after reload",
    );
    const closeDiff = dom.window.document.querySelector('[aria-label="Close inline diff"]');
    if (closeDiff) {
      closeDiff.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }
    await waitFor(
      () => !dom.window.document.querySelector('[aria-label="Toggle Diff section"]'),
      "diff pane hidden without a selected file",
    );
    assert.ok(
      !dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "no diff sash without the diff pane",
    );
    // Select a file → diff pane appears with its own sash.
    const fileRow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("src/app.js"),
    );
    fileRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => rootText().includes("+new"), "diff pane reopened");
    const sash = await waitFor(
      () => dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "diff sash rendered",
    );
    const diffBody = header("Toggle Diff section").nextElementSibling;
    const startH = diffBody.style.height;
    assert.match(startH, /^\d+px$/, "diff body starts at a fixed height");
    sash.dispatchEvent(
      new dom.window.MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 100 }),
    );
    dom.window.dispatchEvent(
      new dom.window.MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 160 }),
    );
    dom.window.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    const expectH = parseInt(startH, 10) + 60 + "px";
    await waitFor(() => diffBody.style.height === expectH, "diff deepened by drag");
    // Collapse via chevron: header stays, body and sash hide.
    header("Toggle Diff section").dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() => !rootText().includes("+new"), "diff collapsed");
    assert.ok(header("Toggle Diff section"), "collapsed diff keeps its header");
    assert.ok(
      !dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "diff sash hidden while collapsed",
    );
    header("Toggle Diff section").dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() => rootText().includes("+new"), "diff re-expanded");
  }, 30000);

  it("fills the panel height with the last expanded pane", async () => {
    const header = (label) => dom.window.document.querySelector(`[aria-label="${label}"]`);
    const click = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // Normalize: commit selected, files listed, Files + Details expanded,
    // no file selected (Files + Details open).
    const rows = commitRows();
    rows[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await waitFor(
      () =>
        [...dom.window.document.querySelectorAll("li")].some((li) =>
          (li.textContent || "").includes("src/app.js"),
        ),
      "files listed",
    );
    const closeDiff = dom.window.document.querySelector('[aria-label="Close inline diff"]');
    if (closeDiff) {
      click(closeDiff);
      await waitFor(
        () => !dom.window.document.querySelector('[aria-label="Toggle Diff section"]'),
        "diff closed",
      );
    }
    for (const label of ["Toggle Files section", "Toggle Details section"]) {
      if (header(label).getAttribute("aria-expanded") === "false") {
        click(header(label));
      }
    }
    await waitFor(
      () =>
        header("Toggle Files section").getAttribute("aria-expanded") === "true" &&
        header("Toggle Details section").getAttribute("aria-expanded") === "true",
      "files and details expanded",
    );
    // Files + Details: fixed list height, sash present.
    const sash = await waitFor(
      () => dom.window.document.querySelector('[aria-label="Resize file list"]'),
      "files sash with details open",
    );
    const list = sash.previousElementSibling;
    assert.match(list.style.height, /^\d+px$/, "file list fixed while details open");
    assert.equal(list.style.flexGrow, "0", "file list does not flex while details open");
    // Collapse Details: the file list is the last expanded pane and fills.
    click(header("Toggle Details section"));
    await waitFor(
      () => !dom.window.document.querySelector('[aria-label="Resize file list"]'),
      "no files sash when files is last",
    );
    assert.equal(list.style.flexGrow, "1", "file list fills the panel when last");
    assert.equal(list.style.height, "", "no fixed height when filling");
    // Re-expand: stored size restored.
    click(header("Toggle Details section"));
    await waitFor(
      () => dom.window.document.querySelector('[aria-label="Resize file list"]'),
      "files sash restored",
    );
    assert.match(list.style.height, /^\d+px$/, "stored file-list height restored");
  }, 30000);

  it("lets the diff preview fill the panel when details is collapsed", async () => {
    const header = (label) => dom.window.document.querySelector(`[aria-label="${label}"]`);
    const click = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    if (header("Toggle Details section").getAttribute("aria-expanded") === "false") {
      click(header("Toggle Details section"));
      await waitFor(
        () => header("Toggle Details section").getAttribute("aria-expanded") === "true",
        "details expanded",
      );
    }
    // Select a file → Diff opens (Files fixed, Diff fixed, Details flex).
    const fileRow = [...dom.window.document.querySelectorAll("li")].find((li) =>
      (li.textContent || "").includes("src/app.js"),
    );
    assert.ok(fileRow, "file row rendered");
    click(fileRow);
    await waitFor(() => rootText().includes("+new"), "diff pane opened");
    await waitFor(
      () => dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "diff sash with details open",
    );
    const diffBody = header("Toggle Diff section").nextElementSibling;
    assert.match(diffBody.style.height, /^\d+px$/, "diff fixed while details open");
    // Collapse Details → diff is last → fills; files keeps its stored height.
    click(header("Toggle Details section"));
    await waitFor(
      () => !dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "no diff sash when diff is last",
    );
    assert.equal(diffBody.style.flexGrow, "1", "diff fills the panel when last");
    assert.ok(
      dom.window.document.querySelector('[aria-label="Resize file list"]'),
      "files sash stays above the filling diff",
    );
    // Restore: details back, diff back to its stored height.
    click(header("Toggle Details section"));
    await waitFor(
      () => dom.window.document.querySelector('[aria-label="Resize diff preview"]'),
      "diff sash restored",
    );
    assert.match(diffBody.style.height, /^\d+px$/, "stored diff height restored");
  }, 30000);
});
