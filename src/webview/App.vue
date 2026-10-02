<script setup>
import { ref, computed, watch, onUnmounted, nextTick, h } from "vue";
import {
  toGraphViewModels,
  rowGraph,
  visibleParentIds,
  SWIMLANE_WIDTH,
  SWIMLANE_HEIGHT,
} from "./graph.js";
import { toggleCheck, rangeSelect } from "./select.js";
import { renderRichText } from "./richtext.js";
import { signatureLabel, signatureColor, signatureText } from "./signature.js";
import { loadStored, storeValue, asBoolean, asOneOf } from "./settings.js";

const ICON_BRANCH =
  "M14 5.5C14 4.121 12.879 3 11.5 3C10.121 3 9 4.121 9 5.5C9 6.682 9.826 7.669 10.93 7.928C10.744 8.546 10.177 9 9.5 9H6.5C5.935 9 5.419 9.195 5 9.512V4.949C6.14 4.717 7 3.707 7 2.5C7 1.121 5.879 0 4.5 0C3.121 0 2 1.121 2 2.5C2 3.708 2.86 4.717 4 4.949V11.05C2.86 11.282 2 12.292 2 13.499C2 14.878 3.121 15.999 4.5 15.999C5.879 15.999 7 14.878 7 13.499C7 12.317 6.174 11.33 5.07 11.071C5.256 10.453 5.823 9.999 6.5 9.999H9.5C10.723 9.999 11.74 9.115 11.954 7.953C13.116 7.738 14 6.723 14 5.5ZM3 2.5C3 1.673 3.673 1 4.5 1C5.327 1 6 1.673 6 2.5C6 3.327 5.327 4 4.5 4C3.673 4 3 3.327 3 2.5ZM6 13.5C6 14.327 5.327 15 4.5 15C3.673 15 3 14.327 3 13.5C3 12.673 3.673 12 4.5 12C5.327 12 6 12.673 6 13.5ZM11.5 7C10.673 7 10 6.327 10 5.5C10 4.673 10.673 4 11.5 4C12.327 4 13 4.673 13 5.5C13 6.327 12.327 7 11.5 7Z";
const ICON_CLOUD =
  "M8 4C6.34315 4 5 5.34315 5 7C5 7.27614 4.77614 7.5 4.5 7.5H4.25C3.00736 7.5 2 8.50736 2 9.75C2 10.9926 3.00736 12 4.25 12H11.75C12.9926 12 14 10.9926 14 9.75C14 8.50736 12.9926 7.5 11.75 7.5H11.5C11.2239 7.5 11 7.27614 11 7C11 5.34315 9.65685 4 8 4ZM4.03004 6.50733C4.27283 4.53062 5.95767 3 8 3C10.0423 3 11.7272 4.53063 11.97 6.50733C13.6623 6.62043 15 8.029 15 9.75C15 11.5449 13.5449 13 11.75 13H4.25C2.45507 13 1 11.5449 1 9.75C1 8.029 2.33769 6.62043 4.03004 6.50733Z";
const ICON_TAG =
  "M11 6C10.4477 6 10 5.55228 10 5C10 4.44772 10.4477 4 11 4C11.5523 4 12 4.44772 12 5C12 5.55228 11.5523 6 11 6ZM2.58722 10.1357C1.80426 9.3566 1.80426 8.0934 2.58722 7.31428L7.32688 2.59785C7.70082 2.22574 8.20735 2.01572 8.73617 2.01353L11.9867 2.00002C13.1029 1.99538 14.008 2.89877 13.9999 4.00947L13.9755 7.3725C13.9717 7.89662 13.7608 8.3982 13.3884 8.76882L8.71865 13.4157C7.93569 14.1948 6.66627 14.1948 5.88331 13.4157L2.58722 10.1357ZM3.29605 8.01964C2.90458 8.4092 2.90458 9.0408 3.29606 9.43036L6.59214 12.7103C6.98362 13.0999 7.61834 13.0999 8.00982 12.7103L12.6795 8.06346C12.8658 7.87815 12.9712 7.62736 12.9731 7.3653L12.9975 4.00227C13.0016 3.44692 12.549 2.99522 11.9909 2.99754L8.74036 3.01105C8.47595 3.01215 8.22268 3.11716 8.03571 3.30321L3.29605 8.01964Z";
const ICON_TARGET =
  "M9 8C9 8.552 8.552 9 8 9C7.448 9 7 8.552 7 8C7 7.448 7.448 7 8 7C8.552 7 9 7.448 9 8ZM12 8C12 10.209 10.209 12 8 12C5.791 12 4 10.209 4 8C4 5.791 5.791 4 8 4C10.209 4 12 5.791 12 8ZM11 8C11 6.343 9.657 5 8 5C6.343 5 5 6.343 5 8C5 9.657 6.343 11 8 11C9.657 11 11 9.657 11 8ZM15 8C15 11.866 11.866 15 8 15C4.134 15 1 11.866 1 8C1 4.134 4.134 1 8 1C11.866 1 15 4.134 15 8ZM14 8C14 4.686 11.314 2 8 2C4.686 2 2 4.686 2 8C2 11.314 4.686 14 8 14C11.314 14 14 11.314 14 8Z";
const ICON_FOLDER =
  "M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V11.5C15 12.8807 13.8807 14 12.5 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM2 7V11.5C2 12.3284 2.67157 13 3.5 13H12.5C13.3284 13 14 12.3284 14 11.5V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2Z";
const ICON_FOLDER_OPEN =
  "M2 4.5V9.10022L2.92389 7.5C3.45979 6.5718 4.45017 6 5.52196 6L11.9146 6C11.7087 5.4174 11.1531 5 10.5 5H7C6.86739 5 6.74021 4.94732 6.64645 4.85355L4.93934 3.14645C4.84557 3.05268 4.71839 3 4.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM7.06895 13.9953C7.04641 13.9984 7.02339 14 7 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5C1 3.11929 2.11929 2 3.5 2H4.58579C4.98361 2 5.36514 2.15804 5.64645 2.43934L7.20711 4H10.5C11.724 4 12.7426 4.87965 12.958 6.04127C14.605 6.34148 15.5443 8.22106 14.6616 9.75L13.0766 12.4953C12.5407 13.4235 11.5503 13.9953 10.4785 13.9953H7.06895ZM5.52196 7C4.80743 7 4.14718 7.3812 3.78991 8L2.20492 10.7453C1.62757 11.7453 2.34926 12.9953 3.50396 12.9953L10.4785 12.9953C11.193 12.9953 11.8533 12.6141 12.2105 11.9953L13.7955 9.25C14.3729 8.25 13.6512 7 12.4965 7L5.52196 7Z";
const ICON_FILE =
  "M5 1C3.89543 1 3 1.89543 3 3V13C3 14.1046 3.89543 15 5 15H11C12.1046 15 13 14.1046 13 13V5.41421C13 5.01639 12.842 4.63486 12.5607 4.35355L9.64645 1.43934C9.36514 1.15804 8.98361 1 8.58579 1H5ZM4 3C4 2.44772 4.44772 2 5 2H8V4.5C8 5.32843 8.67157 6 9.5 6H12V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V3ZM11.7929 5H9.5C9.22386 5 9 4.77614 9 4.5V2.20711L11.7929 5Z";
const ICON_CHEVRON_RIGHT =
  "M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z";
const ICON_CHEVRON_DOWN =
  "M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z";
const ICON_REFRESH =
  "M13.5 3.5V7h-3.5l1.36-1.36A4.5 4.5 0 1 0 12.5 9h1.05A5.5 5.5 0 1 1 12.1 4.9L13.5 3.5Z";
const ICON_FETCH =
  "M8 1.5a.5.5 0 0 1 .5.5v7.79l2.15-2.14.7.7L8 11.71 4.65 8.35l.7-.7L7.5 9.79V2a.5.5 0 0 1 .5-.5ZM2.5 11v2.5h11V11h1v2.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V11h1Z";
// A real gear (the old glyph was a dotted ring, which read as a sun).
// Material Design "settings" shape, drawn on its own 24-unit grid.
const ICON_SETTINGS =
  "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.44.17-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.87c-.12.21-.08.47.12.64l2.03 1.58c-.05.3-.08.62-.08.94s.03.64.08.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z";

// One ref badge, drawn once for the graph rows and the commit hover card, so
// a hovered commit lists its refs exactly as the row draws them (same icons,
// same lane color — the native graph convention). Interaction (role, tabindex,
// click handlers) is left to the caller: a functional component gets no
// attribute fallthrough for free, so the incoming attrs are spread on here.
function RefBadge({ chip: b, color }, { attrs }) {
  const icon = (d) =>
    h(
      "svg",
      { viewBox: "0 0 16 16", width: 12, height: 12, fill: "currentColor", "aria-hidden": "true" },
      [h("path", { d })],
    );
  const kind = b.type === "tag" ? "tag" : b.kind;
  const children = [];
  if (kind === "tag") {
    children.push(icon(ICON_TAG));
  } else {
    // Local first (target when it is the branch you are on), then the cloud
    // for the published half, then the worktree folder.
    if (kind === "local") {
      children.push(icon(b.isHead ? ICON_TARGET : ICON_BRANCH));
    }
    if (b.paired || kind !== "local") {
      children.push(icon(ICON_CLOUD));
    }
    if (kind === "local" && b.worktree) {
      children.push(icon(ICON_FOLDER));
    }
  }
  children.push(h("span", { class: "plegma-ref-label" }, b.name));
  return h(
    "span",
    {
      ...attrs,
      class: [
        "plegma-ref",
        kind === "tag"
          ? "plegma-ref-tag"
          : kind === "local"
            ? "plegma-ref-local"
            : "plegma-ref-remote",
        b.isHead && kind === "local" ? "plegma-ref-head" : "",
        b.worktree && kind === "local" ? "plegma-ref-worktree" : "",
        attrs.class,
      ],
      style: [{ background: color }, attrs.style],
    },
    children,
  );
}
RefBadge.props = {
  chip: { type: Object, required: true },
  color: { type: String, default: "" },
};

const props = defineProps({ location: { type: String, default: "panel" } });

// Commit messages are shown as rich text: links, a small Markdown subset,
// and gitmoji. Text is escaped in the renderer, so v-html is safe here.
function rich(text, opts) {
  return renderRichText(text, opts);
}

// Gravatar images are fetched from the network and often fail (offline,
// blocked hosts, unknown address). Remember the failures per commit hash
// and fall back to the initials the backend computed.
const avatarFailed = ref(new Set());
function onAvatarError(c) {
  if (!c || !c.hash || avatarFailed.value.has(c.hash)) {
    return;
  }
  const next = new Set(avatarFailed.value);
  next.add(c.hash);
  avatarFailed.value = next;
}

function getVsCodeApi() {
  if (typeof window !== "undefined" && window.acquireVsCodeApi) {
    try {
      return window.acquireVsCodeApi();
    } catch {
      return null;
    }
  }
  return null;
}

let requestId = 0;
const pending = new Map();

if (typeof window !== "undefined" && !window.__plegmaListener) {
  window.__plegmaListener = true;
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "git/response" && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) {
        resolve(msg.data);
      } else {
        const err = new Error(msg.error || "git request failed");
        err.conflict = !!msg.conflict;
        err.conflictedFiles = msg.conflictedFiles || [];
        err.notMerged = !!msg.notMerged;
        err.noUpstream = !!msg.noUpstream;
        reject(err);
      }
    }
  });
}

const api = getVsCodeApi();

// --- Busy indicator ---------------------------------------------------------
// One counter for the whole view, fed by every host request, so the spinner
// and the top progress bar can never miss a background action (loads, polls,
// fetches, rebase, stash...). The indicator only appears after BUSY_DELAY_MS:
// a fingerprint poll or a cached refresh finishes long before that, so the
// animation never flickers for work the user did not ask for.
const busyDepth = ref(0);
const busyVisible = ref(false);
const busyLabel = ref("");
const BUSY_DELAY_MS = 120;
let busyTimer = null;
function pushBusy() {
  busyDepth.value += 1;
  if (busyTimer === null) {
    busyTimer = setTimeout(() => {
      busyTimer = null;
      if (busyDepth.value > 0) {
        busyVisible.value = true;
      }
    }, BUSY_DELAY_MS);
  }
}
function popBusy() {
  busyDepth.value = Math.max(0, busyDepth.value - 1);
  if (busyDepth.value === 0) {
    if (busyTimer !== null) {
      clearTimeout(busyTimer);
      busyTimer = null;
    }
    busyVisible.value = false;
  }
}

function requestVia(method, args) {
  return new Promise((resolve, reject) => {
    if (!api) {
      reject(new Error("Webview API unavailable (running outside VS Code?)."));
      return;
    }
    const id = String(++requestId);
    let settled = false;
    const done = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      pending.delete(id);
      popBusy();
      fn(value);
    };
    pending.set(id, { resolve: (v) => done(resolve, v), reject: (e) => done(reject, e) });
    pushBusy();
    api.postMessage({ type: "git/request", id, method, args });
    setTimeout(() => {
      if (pending.has(id)) {
        done(
          reject,
          new Error(
            `Timed out waiting for ${method} (30s). If this keeps happening, close the Plegma tab and run "Plegma: Open Window" again.`,
          ),
        );
      }
    }, 30000);
  });
}

function shortHash(h) {
  return (h || "").slice(0, 7);
}

function formatDateTime(ts) {
  if (!ts) {
    return "";
  }
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const commits = ref([]);
const branches = ref([]);
const tags = ref([]);
const worktrees = ref([]);
const loading = ref(true);
const error = ref("");
const selected = ref(null);
const checked = ref([]);
const anchor = ref(null);
// One context menu for a commit, whether the right-click landed on the row
// or on one of its ref chips. `menu.chip` is set only in the second case,
// and adds the branch's own actions to the commit's. `submenu` is the one
// nested list that may be open inside it.
const menu = ref(null);
const submenu = ref(null);
const tagMenu = ref(null);
const revertTarget = ref(null);
const resetTarget = ref(null);
const deleteTarget = ref(null);
const deleteTagTarget = ref(null);
const deleteRemoteTarget = ref(null);
const pushForceTarget = ref(null);
const fileMenu = ref(null);
const colMenuOpen = ref(false);
const branchFilterOpen = ref(false);
const discardTarget = ref(null);
const rewordPos = ref({ x: 200, y: 200 });
const rewordFor = ref(null);
const rewordText = ref("");
const files = ref([]);
const filesLoading = ref(false);
const filesError = ref("");
const diffError = ref("");
// Working-tree (uncommitted changes) listing and pseudo-selection. When
// worktreeSelected is on, the Files panel shows statusFiles instead of
// the selected commit's files.
const worktree = ref([]);
const worktreeSelected = ref(false);
// Stash entries for the graph rows (populated by load(), rendered by 1.5).
const stashes = ref([]);
const activeFiles = computed(() => (worktreeSelected.value ? worktree.value : files.value));
// Inline diff preview: single click selects a file and shows its unified
// diff below the file list.
const selectedFileKey = ref(null);
const inlineDiffText = ref("");
const inlineDiffLoading = ref(false);
const inlineDiffError = ref("");
const inlineDiffTruncated = ref(false);
const inlineDiffBinary = ref(false);
const inlineDiffTooLarge = ref(false);
let inlineReq = 0;
function fileKey(f) {
  return (f.oldPath || "") + "→" + f.path;
}
function clearInlineDiff() {
  inlineDiffText.value = "";
  inlineDiffError.value = "";
  inlineDiffTruncated.value = false;
  inlineDiffBinary.value = false;
  inlineDiffTooLarge.value = false;
}
function selectFile(f) {
  selectedFileKey.value = fileKey(f);
  if (!commitPanes.value.diff) {
    commitPanes.value.diff = true;
    persistCommitPanes();
  }
  loadInlineDiff(f);
}
function selectWorktree() {
  setFilesPanelOpen(true);
  if (!commitPanes.value.files) {
    commitPanes.value.files = true;
    persistCommitPanes();
  }
  setSelected(null);
  worktreeSelected.value = true;
  selectedFileKey.value = null;
  inlineReq++;
  clearInlineDiff();
}

// Files side panel visibility. Closed via its ✕ button, reopened by
// clicking another commit (or the worktree row). Persisted like colWidths.
const filesPanelOpen = ref(true);
try {
  const savedFilesPanel =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.filesPanelOpen") : null;
  if (savedFilesPanel === "0" || savedFilesPanel === "1") {
    filesPanelOpen.value = savedFilesPanel === "1";
  }
} catch {
  // Corrupt storage must never break the view.
}
function setFilesPanelOpen(open) {
  filesPanelOpen.value = open;
  try {
    localStorage.setItem("plegma.filesPanelOpen", open ? "1" : "0");
  } catch {
    // Persistence is best-effort.
  }
}

async function doStash() {
  opBusy.value = true;
  opStatus.value = null;
  try {
    const n = worktree.value.length;
    const branch = headBranch.value ? headBranch.value.name : "detached HEAD";
    await requestVia("stashPush", {
      message: `plegma: WIP on ${branch}`,
      includeUntracked: stashIncludeUntracked.value,
    });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Stash failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function revealScm() {
  try {
    await requestVia("revealScm");
  } catch (e) {
    opStatus.value = {
      text: `Could not open Source Control: ${(e && e.message) || e}`,
      isError: true,
    };
  }
}

// Stash rows (native Apply/Pop/Drop/Create-branch). Apply keeps the stash,
// Pop removes it on success and reports conflicts as plain errors (there
// is no continue/skip flow for stash like there is for rebase).
const stashDropTarget = ref(null);
const visibleStashes = computed(() => {
  const q = findMode.value ? "" : commitFilter.value.trim().toLowerCase();
  if (!q) {
    return stashes.value;
  }
  return stashes.value.filter((s) => `${s.name} ${s.message}`.toLowerCase().includes(q));
});

async function doStashApply(name) {
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("stashApply", { name });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Apply stash failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function doStashPop(name) {
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("stashPop", { name });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Pop stash failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function doStashDrop() {
  const t = stashDropTarget.value;
  if (!t) {
    return;
  }
  stashDropTarget.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("stashDrop", { name: t.name });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Drop stash failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function doStashBranch(name) {
  let branchName = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `New branch from ${name}`,
      placeHolder: "feature/my-branch",
    });
    branchName = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Branch name prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!branchName || !branchName.trim()) {
    return; // dismissed
  }
  await runOp(`Create branch from ${name}`, "stashBranch", {
    branchName: branchName.trim(),
    stashName: name,
  });
}

// discardTarget: { paths: string[] | null } — null discards every
// uncommitted change, otherwise just the listed files. Set from the
// uncommitted bar (all) or a per-file button; the inline confirm in the
// Files panel runs doDiscardWorktree. Destructive with no undo, hence
// the explicit confirm step.
function askDiscardFile(e, f) {
  const at = clampXY((e && e.clientX) || 200, (e && e.clientY) || 200, 340, 150);
  discardTarget.value = { paths: [f.path], ...at };
}

async function doDiscardWorktree() {
  const t = discardTarget.value;
  if (!t) {
    return;
  }
  discardTarget.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("discardWorktree", t.paths ? { paths: t.paths } : {});
    const n = t.paths ? t.paths.length : worktree.value.length;
    opStatus.value = {
      text:
        t.paths && t.paths.length === 1
          ? `Discarded uncommitted changes to ${t.paths[0]}.`
          : `Discarded ${n} uncommitted file${n === 1 ? "" : "s"}.`,
      isError: false,
    };
    selectedFileKey.value = null;
    inlineReq++;
    clearInlineDiff();
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Discard failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function loadInlineDiff(f) {
  if (!f || (!worktreeSelected.value && !selectedCommit.value)) {
    return;
  }
  const my = ++inlineReq;
  const key = fileKey(f);
  inlineDiffLoading.value = true;
  inlineDiffError.value = "";
  clearInlineDiff();
  try {
    const res = worktreeSelected.value
      ? await requestVia("worktreeFileDiff", { path: f.path })
      : await requestVia("fileDiff", {
          sha: selectedCommit.value.hash,
          parentSha: (selectedCommit.value.parents && selectedCommit.value.parents[0]) || null,
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
        });
    if (my !== inlineReq || selectedFileKey.value !== key) {
      return; // stale: user moved on
    }
    if (!res) {
      return;
    }
    if (res.binary) {
      inlineDiffBinary.value = true;
    } else if (res.tooLarge) {
      inlineDiffTooLarge.value = true;
    } else {
      inlineDiffText.value = res.text || "";
      inlineDiffTruncated.value = !!res.truncated;
    }
  } catch (e) {
    if (my !== inlineReq || selectedFileKey.value !== key) {
      return;
    }
    inlineDiffError.value = (e && e.message) || String(e);
  } finally {
    if (my === inlineReq) {
      inlineDiffLoading.value = false;
    }
  }
}
const diffLines = computed(() => inlineDiffText.value.split("\n"));
function diffLineStyle(line) {
  if (line.startsWith("@@")) {
    return { color: "var(--vscode-textLink-foreground)", fontWeight: "700" };
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { color: "var(--vscode-gitDecoration-addedResourceForeground)" };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return { color: "var(--vscode-gitDecoration-deletedResourceForeground)" };
  }
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return { opacity: "0.7", fontWeight: "700" };
  }
  return {};
}
// Flat list vs directory tree in the Files panel. Persisted like colWidths.
const filesViewMode = ref("list");
try {
  const savedMode =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.filesView") : null;
  if (savedMode === "list" || savedMode === "tree") {
    filesViewMode.value = savedMode;
  }
} catch {
  // Corrupt storage must never break the view.
}
function setFilesViewMode(mode) {
  filesViewMode.value = mode;
  try {
    localStorage.setItem("plegma.filesView", mode);
  } catch {
    // Persistence is best-effort.
  }
}
// dir path -> true when collapsed in tree mode.
const collapsedDirs = ref({});
function baseName(p) {
  const s = String(p || "");
  const i = s.lastIndexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}
// Rows for the Files panel: plain file rows in list mode; directory
// headers with nested file rows in tree mode. Like VS Code's native changes
// tree, top-level files list directly with no "(root)" pseudo-folder.
const fileRows = computed(() => {
  if (filesViewMode.value !== "tree") {
    return activeFiles.value.map((f) => ({ kind: "file", file: f }));
  }
  const groups = new Map();
  for (const f of activeFiles.value) {
    const p = f.path || "";
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "(root)" : p.slice(0, slash);
    if (!groups.has(dir)) {
      groups.set(dir, []);
    }
    groups.get(dir).push(f);
  }
  const rows = [];
  for (const dir of [...groups.keys()].sort()) {
    const list = groups.get(dir);
    const isRoot = dir === "(root)";
    if (!isRoot) {
      rows.push({ kind: "dir", dir, count: list.length });
    }
    if (!collapsedDirs.value[dir]) {
      for (const f of list) {
        rows.push({ kind: "file", file: f, dir: isRoot ? null : dir });
      }
    }
  }
  return rows;
});
function fileLabel(f, inTree) {
  const show = (p) => (inTree ? baseName(p) : p);
  return f.oldPath && f.oldPath !== f.path ? `${show(f.oldPath)} → ${show(f.path)}` : show(f.path);
}
// Sash visibility for the VS Code-style stacked panes. The Files sash
// shows when the file list is visible and an expanded pane sits below it
// (Diff preview and/or Details); the Diff sash shows when an expanded
// Diff preview sits above expanded Details.
const hasFileList = computed(
  () => activeFiles.value.length > 0 && !filesLoading.value && !filesError.value,
);
// Expanded-state helpers shared by the sash visibility and the fill
// behavior below: exactly one pane is "last", and it flexes.
const isDiffExpanded = computed(() => !!selectedFileKey.value && commitPanes.value.diff);
const isDetailsExpanded = computed(() => !!selectedCommit.value && commitPanes.value.details);
const showFilesSash = computed(
  () =>
    commitPanes.value.files &&
    hasFileList.value &&
    (isDiffExpanded.value || isDetailsExpanded.value),
);
const showDiffSash = computed(() => isDiffExpanded.value && isDetailsExpanded.value);
// VS Code sidebar behavior: expanded panes always add up to 100% of the
// panel height. Non-last panes keep their stored fixed heights; the last
// expanded pane flexes to absorb the remainder, so collapsing a pane hands
// its space to the panes above instead of leaving dead space. Stored sizes
// are preserved across collapse/expand.
const isFilesLast = computed(
  () => commitPanes.value.files && !isDiffExpanded.value && !isDetailsExpanded.value,
);
const isDiffLast = computed(() => isDiffExpanded.value && !isDetailsExpanded.value);
const filesListStyle = computed(() => ({
  margin: "0",
  padding: "0 12px 4px",
  paddingLeft: "12px",
  listStyle: "none",
  fontSize: "12px",
  overflow: "auto",
  minWidth: "0",
  ...(isFilesLast.value
    ? { flex: "1 1 auto", minHeight: "0" }
    : { flex: "none", height: `${inlineListHeight.value}px` }),
}));
const diffBodyStyle = computed(() => ({
  minWidth: "0",
  overflow: "auto",
  padding: "4px 12px 8px",
  ...(isDiffLast.value
    ? { flex: "1 1 auto", minHeight: "0" }
    : { flex: "none", height: `${diffPaneHeight.value}px` }),
}));
const commitFilter = ref("");
// Branch filter: pick specific refs, only the checked-out branch, or a
// glob pattern. Persisted per webview like the column widths; the backend
// does the filtering (see normalizeRefs / normalizeGlobs in cliGit.js).
const branchFilter = ref({ onlyHead: false, refs: [], globs: "" });
try {
  const savedBranchFilter =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.branchFilter") : null;
  if (savedBranchFilter) {
    const parsed = JSON.parse(savedBranchFilter);
    branchFilter.value = {
      onlyHead: !!parsed.onlyHead,
      refs: Array.isArray(parsed.refs) ? parsed.refs.filter((r) => typeof r === "string") : [],
      globs: typeof parsed.globs === "string" ? parsed.globs : "",
    };
  }
} catch {
  // A corrupt value just means "no filter".
}
watch(
  branchFilter,
  (v) => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("plegma.branchFilter", JSON.stringify(v));
      }
    } catch {
      // Persistence is best-effort.
    }
  },
  { deep: true },
);
// Log ordering. Date is the default; topological is the strict alternative
// and author-date follows the author's clock. `--date-order` still shows no
// parent before its children, so the swimlane graph keeps working.
// Persisted like the other view choices.
const ORDER_OPTIONS = [
  { value: "topo", label: "Topological" },
  { value: "date", label: "Date" },
  { value: "author-date", label: "Author date" },
];
const commitOrder = ref("date");
try {
  const savedOrder =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.commitOrder") : null;
  if (savedOrder === "topo" || savedOrder === "date" || savedOrder === "author-date") {
    commitOrder.value = savedOrder;
  }
} catch {
  // Corrupt storage means the default order.
}
function setCommitOrder(value) {
  const v = ORDER_OPTIONS.some((o) => o.value === value) ? value : "date";
  commitOrder.value = v;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("plegma.commitOrder", v);
    }
  } catch {
    // Persistence is best-effort.
  }
  // A different order means a different log, so paging starts over.
  limit.value = PAGE_SIZE;
  load();
}

// Bare patterns are shorthand for both namespaces, so "feature/*" means
// "feature/* locally and on the remote".
function expandGlob(pattern) {
  if (pattern.startsWith("refs/")) {
    return [pattern];
  }
  return [`refs/heads/${pattern}`, `refs/remotes/${pattern}`];
}
// What actually goes to `git log`: a glob pattern wins over the picked
// refs (the panel says so), and an empty filter means "everything".
const branchFilterArgs = computed(() => {
  const f = branchFilter.value || {};
  const globs = String(f.globs || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (globs.length > 0) {
    return { globs: globs.flatMap(expandGlob), refs: [] };
  }
  if (f.onlyHead) {
    const head = headBranch.value;
    return { globs: [], refs: head ? [head.name] : [] };
  }
  return { globs: [], refs: Array.isArray(f.refs) ? f.refs.slice() : [] };
});
const branchFilterActive = computed(
  () => branchFilterArgs.value.globs.length > 0 || branchFilterArgs.value.refs.length > 0,
);
const opStatus = ref(null);
const opBusy = ref(false);
// Status banners auto-dismiss so they never permanently steal a row:
// success after 6s, errors after 10s. Clicking dismisses immediately.
let opStatusTimer = null;
watch(opStatus, (v) => {
  if (opStatusTimer) {
    clearTimeout(opStatusTimer);
    opStatusTimer = null;
  }
  if (!v) {
    return;
  }
  const delay = v.isError ? 10000 : 6000;
  opStatusTimer = setTimeout(() => {
    opStatus.value = null;
    opStatusTimer = null;
  }, delay);
});
const rebaseState = ref({ inProgress: false, conflictedFiles: [] });
const mergeState = ref({ inProgress: false, conflictedFiles: [] });
const repoRoots = ref([]);
const activeRoot = ref(null);
const noRepo = ref(false);
let fingerprint = null;
let pollTimer = null;

// Resizable history-table columns (Author/Date in px; Commit flexes,
// Graph stays content-sized). Persisted across reloads.
const colWidths = ref({ author: 140, date: 130 });
try {
  const saved =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.colWidths") : null;
  if (saved) {
    const parsed = JSON.parse(saved);
    for (const k of ["author", "date"]) {
      if (parsed && Number.isFinite(Number(parsed[k]))) {
        colWidths.value[k] = Math.max(50, Math.min(600, Number(parsed[k])));
      }
    }
  }
} catch {
  // Corrupt storage must never break the view.
}

// Column visibility for the history table. Only the resizable meta
// columns (Author, Date) can be hidden; Graph and Commit always stay.
// Persisted next to the widths, since they are the same kind of choice.
const hiddenCols = ref([]);
try {
  const savedHidden =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.hiddenCols") : null;
  if (savedHidden) {
    const parsed = JSON.parse(savedHidden);
    if (Array.isArray(parsed)) {
      hiddenCols.value = parsed.filter((c) => c === "author" || c === "date");
    }
  }
} catch {
  // Corrupt storage means "show everything".
}
const OPTIONAL_COLS = [
  { key: "author", label: "Author" },
  { key: "date", label: "Date" },
];
function colVisible(key) {
  return !hiddenCols.value.includes(key);
}
function toggleCol(key) {
  const next = colVisible(key)
    ? hiddenCols.value.concat(key)
    : hiddenCols.value.filter((c) => c !== key);
  hiddenCols.value = next;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("plegma.hiddenCols", JSON.stringify(next));
    }
  } catch {
    // Persistence is best-effort.
  }
}

function startResize(e, col) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = colWidths.value[col] || 100;
  const onMove = (ev) => {
    colWidths.value[col] = Math.max(50, Math.min(600, startW + ev.clientX - startX));
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    try {
      localStorage.setItem("plegma.colWidths", JSON.stringify(colWidths.value));
    } catch {
      // Persistence is best-effort.
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// Side-panel width in px (null = automatic). Drag the splitter between
// the graph and the Files panel; double-click it to go back to automatic.
const panelWidth = ref(null);
try {
  const savedPanel =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("plegma.panelWidth") || localStorage.getItem("plegma.panelHeight")
      : null;
  const n = Number(savedPanel);
  if (Number.isFinite(n) && n > 0) {
    panelWidth.value = Math.max(240, Math.min(1200, n));
  }
} catch {
  // Corrupt storage must never break the view.
}
const mainCol = ref(null);
const contentRow = ref(null);
function persistPanelWidth() {
  try {
    if (panelWidth.value == null) {
      localStorage.removeItem("plegma.panelWidth");
    } else {
      localStorage.setItem("plegma.panelWidth", String(panelWidth.value));
    }
  } catch {
    // Persistence is best-effort.
  }
}
// Commit-details panes (VS Code sidebar style): Files, Diff preview
// (conditional on a selected file), Details. Each pane has a chevron
// header to expand/collapse, a sash to resize, and its own scrollable
// body. Open state persists as one JSON object; heights persist per pane.
const commitPanes = ref({ files: true, diff: true, details: true });
try {
  const saved =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.commitPanes") : null;
  if (saved) {
    const parsed = JSON.parse(saved);
    for (const k of ["files", "diff", "details"]) {
      if (parsed && typeof parsed[k] === "boolean") {
        commitPanes.value[k] = parsed[k];
      }
    }
  }
} catch {
  // Corrupt storage must never break the view.
}
function persistCommitPanes() {
  try {
    localStorage.setItem("plegma.commitPanes", JSON.stringify(commitPanes.value));
  } catch {
    // Persistence is best-effort.
  }
}
function toggleCommitPane(name) {
  commitPanes.value[name] = !commitPanes.value[name];
  persistCommitPanes();
}
// Height of the file list. Drag the handle below the list (or between
// the Files and Diff/Details panes); persisted like colWidths. Always
// applied now so the list scrolls independently of Details.
const inlineListHeight = ref(200);
try {
  const savedSplit =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.inlineListHeight") : null;
  const n = Number(savedSplit);
  if (Number.isFinite(n) && n > 0) {
    inlineListHeight.value = Math.max(80, Math.min(600, n));
  }
} catch {
  // Corrupt storage must never break the view.
}
// Height of the diff preview body. Drag the handle between the Diff and
// Details panes; persisted like the file-list height.
const diffPaneHeight = ref(200);
try {
  const savedDiff =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.diffPaneHeight") : null;
  const n = Number(savedDiff);
  if (Number.isFinite(n) && n > 0) {
    diffPaneHeight.value = Math.max(80, Math.min(600, n));
  }
} catch {
  // Corrupt storage must never break the view.
}
function startInlineResize(e) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const startH = inlineListHeight.value;
  const onMove = (ev) => {
    inlineListHeight.value = Math.max(80, Math.min(600, startH + ev.clientY - startY));
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    try {
      localStorage.setItem("plegma.inlineListHeight", String(inlineListHeight.value));
    } catch {
      // Persistence is best-effort.
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
function startDiffResize(e) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const startH = diffPaneHeight.value;
  const onMove = (ev) => {
    diffPaneHeight.value = Math.max(80, Math.min(600, startH + ev.clientY - startY));
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    try {
      localStorage.setItem("plegma.diffPaneHeight", String(diffPaneHeight.value));
    } catch {
      // Persistence is best-effort.
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function startPanelResize(e) {
  e.preventDefault();
  e.stopPropagation();
  const row = contentRow.value || mainCol.value;
  const rowW =
    row && row.getBoundingClientRect ? row.getBoundingClientRect().width : window.innerWidth;
  const panel = e.currentTarget && e.currentTarget.nextElementSibling;
  const startW = panel && panel.getBoundingClientRect ? panel.getBoundingClientRect().width : 380;
  const startX = e.clientX;
  const maxW = Math.max(280, rowW - 300);
  const onMove = (ev) => {
    panelWidth.value = Math.max(240, Math.min(maxW, startW + (startX - ev.clientX)));
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    persistPanelWidth();
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

async function loadRoots() {
  try {
    const data = await requestVia("roots");
    const entries = (data && data.roots) || [];
    repoRoots.value = entries.filter((r) => r.root);
    activeRoot.value = (data && data.activeRoot) || null;
    noRepo.value = repoRoots.value.length === 0;
  } catch {
    repoRoots.value = [];
    activeRoot.value = null;
  }
}

async function switchRoot(root) {
  activeRoot.value = root;
  fingerprint = null;
  setOpStatusSilent();
  try {
    await requestVia("useRoot", { root });
  } catch (e) {
    opStatus.value = { text: `Switch repository failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  setChecked([]);
  setSelected(null);
  await load();
  await syncFingerprint();
}

function setOpStatusSilent() {
  opStatus.value = null;
}
function setChecked(v) {
  checked.value = v;
}
function setSelected(v) {
  selected.value = v;
}

const globDraft = ref(branchFilter.value.globs || "");
function toggleBranchFilter() {
  branchFilterOpen.value = !branchFilterOpen.value;
  if (branchFilterOpen.value) {
    globDraft.value = branchFilter.value.globs || "";
  }
}

// Branch filter panel state and actions. Opening it re-reads nothing: the
// branch list is already loaded, so the panel just toggles entries and
// asks load() to re-query with the new refs/globs.
function toggleBranchRef(name) {
  const f = branchFilter.value;
  const refs = Array.isArray(f.refs) ? f.refs.slice() : [];
  const i = refs.indexOf(name);
  if (i === -1) {
    refs.push(name);
  } else {
    refs.splice(i, 1);
  }
  // Picking refs by hand and "only the checked-out branch" are two ways of
  // saying the same thing; keep the checkboxes and the toggle consistent.
  branchFilter.value = { ...f, refs, onlyHead: false };
  refreshAfterBranchFilter();
}
function setOnlyHead(on) {
  branchFilter.value = { ...branchFilter.value, onlyHead: !!on, refs: [] };
  refreshAfterBranchFilter();
}
function setBranchGlobs(text) {
  globDraft.value = String(text || "");
  branchFilter.value = { ...branchFilter.value, globs: globDraft.value };
  refreshAfterBranchFilter();
}
function clearBranchFilter() {
  globDraft.value = "";
  branchFilter.value = { onlyHead: false, refs: [], globs: "" };
  refreshAfterBranchFilter();
}
async function refreshAfterBranchFilter() {
  // A narrower log can be shorter than the current page, so paging starts
  // over instead of leaving a mostly-empty "load more" behind.
  limit.value = PAGE_SIZE;
  await load();
  await syncFingerprint();
}
function branchRefSelected(name) {
  return (branchFilter.value.refs || []).includes(name);
}

// Commit list paging: the backend takes any limit; the footer button and
// scroll-near-bottom auto-load raise it in steps. Filters keep the limit.
// Pages stay modest so first paint (hundreds of SVG rows) stays fast.
const PAGE_SIZE = 200;
const limit = ref(PAGE_SIZE);
const hasMore = computed(
  () => !loading.value && commits.value.length > 0 && commits.value.length >= limit.value,
);
// Idle text for the toolbar status slot (which the busy indicator takes over
// without changing its width).
const commitCountLabel = computed(() => {
  const n = commits.value.length;
  if (!n) {
    return "";
  }
  return `${n}${hasMore.value ? "+" : ""} commit${n === 1 ? "" : "s"}`;
});
async function loadMore() {
  if (loading.value || !hasMore.value) {
    return;
  }
  limit.value += PAGE_SIZE;
  await load();
  await syncFingerprint();
}
function onGraphScroll(e) {
  cancelHover();
  const el = e.currentTarget;
  if (!el) {
    return;
  }
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    loadMore();
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  // Label the load only when nothing else named an action (runOp sets its
  // own, e.g. "Fetch…"), and clear only what this call set.
  const ownLabel = !busyLabel.value;
  if (ownLabel) {
    busyLabel.value = "Loading…";
  }
  try {
    const logArgs = { limit: limit.value, order: commitOrder.value, ...branchFilterArgs.value };
    const [log, br, tg, wt, st, sh] = await Promise.all([
      requestVia("log", logArgs),
      requestVia("branches"),
      requestVia("tags"),
      requestVia("worktrees"),
      requestVia("statusFiles"),
      requestVia("stashList"),
    ]);
    commits.value = Array.isArray(log) ? log : [];
    branches.value = Array.isArray(br) ? br : [];
    tags.value = Array.isArray(tg) ? tg : [];
    worktrees.value = Array.isArray(wt) ? wt : [];
    worktree.value = Array.isArray(st) ? st : [];
    stashes.value = Array.isArray(sh) ? sh : [];
    if (!branchFilterOnLoadApplied) {
      branchFilterOnLoadApplied = true;
      // A saved filter wins over the on-load default; without one, "head"
      // starts the view on the checked-out branch.
      if (
        !savedBranchFilterExists &&
        branchFilterOnLoad.value === "head" &&
        headBranch.value &&
        !branchFilterActive.value
      ) {
        branchFilter.value = { onlyHead: true, refs: [], globs: "" };
        limit.value = PAGE_SIZE;
        await load();
        return;
      }
    }
  } catch (e) {
    error.value = (e && e.message) || String(e);
  } finally {
    loading.value = false;
    if (ownLabel) {
      busyLabel.value = "";
    }
  }
}

async function syncFingerprint() {
  try {
    fingerprint = await requestVia("fingerprint");
  } catch {
    // Best-effort; the next poll retries.
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (opBusy.value) {
      return;
    }
    try {
      const fp = await requestVia("fingerprint");
      if (fingerprint === null) {
        fingerprint = fp;
        return;
      }
      if (fp !== fingerprint) {
        fingerprint = fp;
        await load();
      }
    } catch {
      // Offline moments are fine; load() surfaces real errors.
    }
  }, 5000);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onUnmounted(stopPoll);

const selectedCommit = computed(() => commits.value.find((c) => c.hash === selected.value) || null);

watch(selectedCommit, (commit) => {
  selectedFileKey.value = null;
  inlineReq++;
  clearInlineDiff();
  if (!commit) {
    files.value = [];
    filesError.value = "";
    return;
  }
  filesLoading.value = true;
  filesError.value = "";
  requestVia("files", { sha: commit.hash })
    .then((list) => {
      files.value = Array.isArray(list) ? list : [];
    })
    .catch((e) => {
      files.value = [];
      filesError.value = (e && e.message) || String(e);
    })
    .finally(() => {
      filesLoading.value = false;
    });
});

// Drop file selections that no longer exist after reloads.
watch(files, (list) => {
  if (worktreeSelected.value) {
    return; // worktree staleness is handled by the worktree watcher
  }
  if (selectedFileKey.value && !list.some((f) => fileKey(f) === selectedFileKey.value)) {
    selectedFileKey.value = null;
    inlineReq++;
    clearInlineDiff();
  }
});

// Deselect the worktree pseudo-row once it goes clean, and drop stale
// worktree file selections after refreshes.
watch(worktree, (list) => {
  if (!worktreeSelected.value) {
    return;
  }
  if (
    list.length === 0 ||
    (selectedFileKey.value && !list.some((f) => fileKey(f) === selectedFileKey.value))
  ) {
    selectedFileKey.value = null;
    inlineReq++;
    clearInlineDiff();
    if (list.length === 0) {
      worktreeSelected.value = false;
    }
  }
});

// Drop selections that no longer exist after reloads.
watch(commits, (list) => {
  if (hoverCard.value && !list.some((c) => c.hash === hoverCard.value.hash)) {
    cancelHover();
  }
  if (list.length === 0) {
    return;
  }
  const known = new Set(list.map((c) => c.hash));
  if (!checked.value.every((h) => known.has(h))) {
    checked.value = checked.value.filter((h) => known.has(h));
  }
  if (selected.value && !known.has(selected.value)) {
    selected.value = null;
  }
});

function openDiff(commit, file) {
  if (!commit || !file) {
    return;
  }
  diffError.value = "";
  requestVia("openDiff", {
    sha: commit.hash,
    parentSha: (commit.parents && commit.parents[0]) || null,
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
  }).catch((e) => {
    diffError.value = (e && e.message) || String(e);
  });
}

function compareWithLocal(commit, file) {
  if (!commit || !file) {
    return;
  }
  diffError.value = "";
  requestVia("openLocalDiff", {
    sha: commit.hash,
    path: file.path,
    status: file.status,
  }).catch((e) => {
    diffError.value = (e && e.message) || String(e);
  });
}

function openRevision(file) {
  if (worktreeSelected.value || !selectedCommit.value || !file) {
    return;
  }
  diffError.value = "";
  requestVia("openFileAtRevision", {
    sha: selectedCommit.value.hash,
    path: file.path,
  }).catch((e) => {
    diffError.value = (e && e.message) || String(e);
  });
}

function openWorkingCopy(file) {
  if (!file) {
    return;
  }
  diffError.value = "";
  requestVia("openWorkingFile", { path: file.path }).catch((e) => {
    diffError.value = (e && e.message) || String(e);
  });
}

async function doRevertFile() {
  const t = revertTarget.value;
  if (!t) {
    return;
  }
  revertTarget.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("revertFile", { sha: t.sha, path: t.path, status: t.status });
    if (selectedCommit.value) {
      filesLoading.value = true;
      try {
        const list = await requestVia("files", { sha: selectedCommit.value.hash });
        files.value = Array.isArray(list) ? list : [];
      } finally {
        filesLoading.value = false;
      }
    }
  } catch (e) {
    opStatus.value = { text: `Revert failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

// Successes stay silent by design (no notification bar): the graph reload
// below is the confirmation. Errors still surface via opStatus. The label
// feeds error text only.
async function runOp(label, method, args) {
  opBusy.value = true;
  opStatus.value = null;
  // Names the action next to the spinner ("Fetching…", "Rebase onto…").
  busyLabel.value = `${label}…`;
  try {
    await requestVia(method, args);
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `${label} failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
    busyLabel.value = "";
  }
}

const headBranch = computed(
  () => branches.value.find((b) => b.kind === "local" && b.isHead) || null,
);

function doCheckout(name) {
  menu.value = null;
  return runOp(`Checkout ${name}`, "checkout", { ref: name });
}
// Fetch options popover: a dialog with remembered options.
// Persisted as one JSON object; corrupt storage falls back to defaults
// (prune on, preserving the previous always-prune behavior; always ask).
const fetchOptions = ref({ prune: true, pruneTags: false, ask: true });
try {
  const saved =
    typeof localStorage !== "undefined" ? localStorage.getItem("plegma.fetchOptions") : null;
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.prune === "boolean") {
        fetchOptions.value.prune = parsed.prune;
      }
      if (typeof parsed.pruneTags === "boolean") {
        fetchOptions.value.pruneTags = parsed.pruneTags;
      }
      if (typeof parsed.ask === "boolean") {
        fetchOptions.value.ask = parsed.ask;
      }
    }
  }
} catch {
  // Corrupt storage must never break the view.
}
// Settings page state. Every setting persists in localStorage under its own
// key (same pattern as the column widths); the page is just a UI over them.
// These live in webview storage rather than VS Code configuration —
// deliberately not mirrored: per-machine UI choices don't belong in
// synced settings.
const RESET_MODES = ["soft", "mixed", "hard"];
const resetDefaultMode = ref(loadStored("plegma.resetDefaultMode", "mixed", asOneOf(RESET_MODES)));
const stashIncludeUntracked = ref(loadStored("plegma.stashIncludeUntracked", true, asBoolean));
const showAvatars = ref(loadStored("plegma.showAvatars", true, asBoolean));
const showWorktreeNode = ref(loadStored("plegma.showWorktreeNode", true, asBoolean));
const branchFilterOnLoad = ref(
  loadStored("plegma.branchFilterOnLoad", "all", asOneOf(["all", "head"])),
);
const savedBranchFilterExists = (() => {
  try {
    return (
      typeof localStorage !== "undefined" && localStorage.getItem("plegma.branchFilter") !== null
    );
  } catch {
    return false;
  }
})();
function persistSetting(key, r) {
  watch(r, (v) => storeValue(key, v), { deep: true });
}
persistSetting("plegma.resetDefaultMode", resetDefaultMode);
persistSetting("plegma.fetchOptions", fetchOptions);
persistSetting("plegma.stashIncludeUntracked", stashIncludeUntracked);
persistSetting("plegma.showAvatars", showAvatars);
persistSetting("plegma.showWorktreeNode", showWorktreeNode);
persistSetting("plegma.branchFilterOnLoad", branchFilterOnLoad);
let branchFilterOnLoadApplied = false;

// Settings view. The gear button swaps the history for the page; the cloud
// button deep-links to the Remotes section — the in-page replacement for
// the old remotes popup.
const settingsOpen = ref(false);
async function openSettings(section) {
  closeOverlays();
  settingsOpen.value = true;
  // Remotes is a section of the settings page, so its list loads whenever the
  // page opens — the toolbar has no separate remotes button to deep-link.
  loadRemotes();
  if (section) {
    await nextTick();
    const el = document.getElementById(`plegma-settings-${section}`);
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "start" });
      } catch {
        // Showing the page is enough.
      }
    }
  }
}
function closeSettings() {
  settingsOpen.value = false;
  remoteDeleteTarget.value = null;
}

const fetchDialog = ref(null);
function askFetch(e) {
  // Stop the click here: a closer left pending by the previous overlay
  // would otherwise fire during this click's bubble phase and instantly
  // dismiss the dialog being opened.
  if (e && typeof e.stopPropagation === "function") {
    e.stopPropagation();
  }
  menu.value = null;
  tagMenu.value = null;
  if (!fetchOptions.value.ask) {
    // "Don't ask again" is on: fetch straight through with the remembered
    // options. Re-enable the dialog from the settings page.
    runFetchFromDialog();
    return;
  }
  fetchRememberChoice.value = false;
  const at = clampXY((e && e.clientX) || 200, (e && e.clientY) || 200, 300, 190);
  fetchDialog.value = { ...at };
}
// Ticked in the dialog to skip it next time ("don't ask again").
const fetchRememberChoice = ref(false);
async function runFetchFromDialog() {
  const opts = {
    prune: !!fetchOptions.value.prune,
    pruneTags: !!fetchOptions.value.pruneTags,
    ask: !fetchRememberChoice.value && fetchOptions.value.ask,
  };
  fetchOptions.value.ask = opts.ask;
  fetchDialog.value = null;
  try {
    localStorage.setItem("plegma.fetchOptions", JSON.stringify(opts));
  } catch {
    // Persistence is best-effort.
  }
  await runOp("Fetch", "fetch", opts);
}

// Remotes management dialog: list with URLs, add, rename, change URL,
// remove (with an inline confirm), and per-remote fetch with prune.
const remotesList = ref([]);
const remotesLoading = ref(false);
const remotesError = ref("");
const newRemoteName = ref("");
const newRemoteUrl = ref("");
const remoteDeleteTarget = ref(null);
async function loadRemotes() {
  remotesLoading.value = true;
  remotesError.value = "";
  try {
    const data = await requestVia("remoteDetails");
    remotesList.value = Array.isArray(data) ? data : [];
  } catch (e) {
    remotesError.value = (e && e.message) || String(e);
  } finally {
    remotesLoading.value = false;
  }
}
async function doAddRemote() {
  const name = newRemoteName.value.trim();
  const url = newRemoteUrl.value.trim();
  if (!name || !url) {
    return;
  }
  await runOp(`Add remote ${name}`, "addRemote", { name, url });
  newRemoteName.value = "";
  newRemoteUrl.value = "";
  await loadRemotes();
}
async function doFetchRemote(name) {
  await runOp(`Fetch ${name}`, "fetchRemote", { name, prune: fetchOptions.value.prune });
}
async function doRenameRemote(name) {
  let newName = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `Rename remote ${name}`,
      value: name,
    });
    newName = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Rename prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!newName || !newName.trim() || newName.trim() === name) {
    return; // dismissed or unchanged
  }
  await runOp(`Rename remote ${name}`, "renameRemote", { oldName: name, newName: newName.trim() });
  await loadRemotes();
}
async function doSetRemoteUrl(name, current) {
  let url = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `URL for remote ${name}`,
      value: current || "",
    });
    url = data && data.value;
  } catch (e) {
    opStatus.value = { text: `URL prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!url || !url.trim() || url.trim() === (current || "")) {
    return; // dismissed or unchanged
  }
  await runOp(`Set URL for ${name}`, "setRemoteUrl", { name, url: url.trim() });
  await loadRemotes();
}
function askDeleteRemote(e, name) {
  if (e && typeof e.stopPropagation === "function") {
    e.stopPropagation();
  }
  const at = clampXY((e && e.clientX) || 200, (e && e.clientY) || 200, 340, 150);
  remoteDeleteTarget.value = { name, ...at };
}
async function doDeleteRemote() {
  const t = remoteDeleteTarget.value;
  if (!t) {
    return;
  }
  remoteDeleteTarget.value = null;
  await runOp(`Remove remote ${t.name}`, "removeRemote", { name: t.name });
  await loadRemotes();
}

const orderedChecked = computed(() => {
  const pos = new Map(commits.value.map((c, i) => [c.hash, i]));
  return [...checked.value].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
});

async function refreshConflictState() {
  try {
    const st = await requestVia("rebaseStatus");
    rebaseState.value = {
      inProgress: !!(st && st.inProgress),
      conflictedFiles: (st && st.conflictedFiles) || [],
    };
  } catch {
    // Status is best-effort; ignore.
  }
  try {
    const mst = await requestVia("mergeStatus");
    mergeState.value = {
      inProgress: !!(mst && mst.inProgress),
      conflictedFiles: (mst && mst.conflictedFiles) || [],
    };
  } catch {
    // Status is best-effort; ignore.
  }
}

async function doRewrite(kind, explicitList, explicitMessage) {
  const list = explicitList || orderedChecked.value;
  const message = explicitMessage !== undefined ? explicitMessage : "";
  let args = {};
  if (kind === "squash") {
    if (list.length < 2) {
      opStatus.value = { text: "Squash needs at least 2 selected commits.", isError: true };
      return;
    }
    args = { squash: list };
    if (message.trim()) {
      args.reword = { hash: list[0], message: message.trim() };
    }
  } else if (kind === "drop") {
    if (list.length === 0) {
      return;
    }
    args = { drop: list };
  } else if (kind === "reword") {
    if (list.length !== 1 || !message.trim()) {
      opStatus.value = { text: "Reword needs 1 commit and a new message.", isError: true };
      return;
    }
    args = { reword: { hash: list[0], message: message.trim() } };
  }
  opBusy.value = true;
  opStatus.value = null;
  menu.value = null;
  rewordFor.value = null;
  try {
    await requestVia("rewrite", args);
    checked.value = [];
    rewordText.value = "";
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Rewrite failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

async function doRebaseOnto(upstream) {
  if (!upstream || !upstream.trim() || !headBranch.value) {
    return;
  }
  upstream = upstream.trim();
  menu.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("rebase", { upstream });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Rebase failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

async function doRebaseCmd(cmd, label) {
  opBusy.value = true;
  try {
    await requestVia(cmd);
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `${label} failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

const tagsByTarget = computed(() => {
  const map = new Map();
  for (const t of tags.value) {
    if (!map.has(t.target)) {
      map.set(t.target, []);
    }
    map.get(t.target).push(t.name);
  }
  return map;
});

const branchesByTarget = computed(() => {
  const map = new Map();
  for (const b of branches.value) {
    if (!map.has(b.target)) {
      map.set(b.target, []);
    }
    map.get(b.target).push(b);
  }
  return map;
});

// Chip-level view of the same refs. A local branch and a remote-tracking ref
// of the same name sitting on the same commit are one fact ("main, and it is
// published as origin/main"), so they share a single chip: the local name
// with a cloud icon appended, never a cloud-only chip — the name is what you
// read at a glance, so it always stays. Two remotes on one local (say
// origin/x and upstream/x) stay split, so no name is ever hidden; the remote
// ref is carried along for the chip's menu.
const chipsByTarget = computed(() => {
  const map = new Map();
  const listFor = (target) => {
    let list = map.get(target);
    if (!list) {
      map.set(target, (list = []));
    }
    return list;
  };
  const shortOf = (name) => {
    const slash = (name || "").indexOf("/");
    return slash > 0 ? name.slice(slash + 1) : null;
  };
  const remotesByShort = new Map();
  for (const b of branches.value) {
    const short = b.kind === "local" ? null : shortOf(b.name);
    if (short === null) {
      continue;
    }
    const key = `${b.target}\u0000${short}`;
    const list = remotesByShort.get(key) || [];
    list.push(b);
    remotesByShort.set(key, list);
  }
  const pairedWith = new Map();
  for (const b of branches.value) {
    if (b.kind !== "local") {
      continue;
    }
    const found = remotesByShort.get(`${b.target}\u0000${b.name}`) || [];
    if (found.length === 1) {
      pairedWith.set(b, found[0]);
    }
  }
  const folded = new Set(pairedWith.values());
  for (const b of branches.value) {
    if (folded.has(b)) {
      continue;
    }
    const remote = pairedWith.get(b) || null;
    const local = b.kind === "local";
    listFor(b.target).push({
      kind: b.kind,
      name: b.name,
      target: b.target,
      branch: b,
      remote,
      paired: !!remote,
      // Filled in here (not at render time) so the graph rows and the hover
      // card can both draw the badge from the same fields.
      isHead: local && !!b.isHead,
      worktree: local ? worktreeByBranch.value.get(b.name) || null : null,
    });
  }
  return map;
});

// Native graph convention (verified in VS Code's scmHistory.ts): ref
// badges take the color of the graph lane at the commit they point to —
// the row's circle color, rotating blue-first through the theme sequence —
// not a fixed color per ref type.
const laneColorByHash = computed(() => {
  const map = new Map();
  for (const c of filteredCommits.value) {
    if (c && c.hash && c.graph && c.graph.circleColor) {
      map.set(c.hash, c.graph.circleColor);
    }
  }
  return map;
});

// Local branch name -> linked worktree path, for branches checked out
// in a worktree other than this view's repository. The active root itself
// is excluded: being checked out where you are is not a linked worktree.
const worktreeByBranch = computed(() => {
  const here = String(activeRoot.value || "").replace(/\/+$/, "");
  const map = new Map();
  for (const w of worktrees.value) {
    if (w && w.branch && w.path && String(w.path).replace(/\/+$/, "") !== here) {
      map.set(w.branch, w.path);
    }
  }
  return map;
});

function branchTitle(b) {
  const wt = b.kind === "local" ? worktreeByBranch.value.get(b.name) : undefined;
  if (b.paired) {
    // One chip for both refs: the chip shows only the local name plus a
    // cloud icon, so name both here for the accessible label.
    const both = `${b.name} and ${b.remote.name}`;
    return wt
      ? `Branch ${both} — checked out in worktree at ${wt}. Right-click for actions, double-click to check out.`
      : `Branch ${both} — right-click for actions, double-click to check out`;
  }
  if (wt) {
    return `Branch ${b.name} — checked out in worktree at ${wt}. Right-click for actions, double-click to check out.`;
  }
  return b.kind === "local"
    ? `Branch ${b.name} — right-click for actions, double-click to check out`
    : `Remote branch ${b.name} — right-click for actions`;
}

// A chip is part of its row, not a control of its own: a left click is left
// to reach the row (which selects the commit) and every action lives in the
// context menu, so a left click no longer opens anything. Double-click stays
// as the quick check out — with no menu to race, it needs no disambiguation.
function onBranchChipDblClick(b) {
  menu.value = null;
  if (b.kind === "local") {
    doCheckout(b.name);
  }
}

async function copyTagName(name) {
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
}

// Path of the linked worktree holding the menu's chip, if any.
const menuChipWorktree = computed(() =>
  menuChip.value && menuChip.value.kind === "local"
    ? worktreeByBranch.value.get(menuChip.value.name) || null
    : null,
);

// Full branch record for the chip the menu was opened on, so the menu can
// avoid offering actions known to fail — e.g. Update on a branch with no
// upstream (typical for a freshly created local branch). Null when the menu
// was opened on a row (no chip) or the branch is unknown (unknown keeps
// Update offered; the backend then reports the clear preflight error).
const menuChipBranch = computed(() =>
  menuChip.value
    ? branches.value.find(
        (b) => b.kind === menuChip.value.kind && b.name === menuChip.value.name,
      ) || null
    : null,
);

// Find mode: unlike the search box (which filters the list), find keeps
// every row and jumps between matches. The match set reuses the same
// haystack as the filter, so both agree on what a query matches.
const findMode = ref(false);
const findQuery = ref("");
const findIndex = ref(-1);
const findMatches = computed(() => {
  const q = findQuery.value.trim().toLowerCase();
  if (!findMode.value || !q) {
    return [];
  }
  return commits.value.filter((c) => commitHaystack(c).includes(q)).map((c) => c.hash);
});
const findMatchSet = computed(() => new Set(findMatches.value));
const findCurrentHash = computed(() =>
  findIndex.value >= 0 && findIndex.value < findMatches.value.length
    ? findMatches.value[findIndex.value]
    : "",
);
// The active match follows the query: keep the current row selected when
// it still matches, otherwise fall back to the first hit.
watch([findMode, findQuery, findMatches], () => {
  const matches = findMatches.value;
  if (matches.length === 0) {
    findIndex.value = -1;
    return;
  }
  const at = matches.indexOf(findCurrentHash.value);
  findIndex.value = at === -1 ? 0 : at;
});
function commitHaystack(c) {
  const refs = branchesByTarget.value.get(c.hash) || [];
  return [
    c.hash,
    c.subject,
    c.authorName,
    ...(c.refs || []),
    ...refs.map((b) => b.name),
    ...(tagsByTarget.value.get(c.hash) || []),
  ]
    .join(" ")
    .toLowerCase();
}
function startFind() {
  findMode.value = true;
  findQuery.value = commitFilter.value;
  if (findQuery.value) {
    commitFilter.value = "";
  }
}
function stopFind() {
  findMode.value = false;
  findQuery.value = "";
  findIndex.value = -1;
}
function isFindMatch(hash) {
  return findMode.value && findMatchSet.value.has(hash);
}
function isFindCurrent(hash) {
  return findMode.value && !!findCurrentHash.value && findCurrentHash.value === hash;
}
async function stepFindMatch(step) {
  const matches = findMatches.value;
  if (matches.length === 0) {
    return;
  }
  const next = (findIndex.value + step + matches.length * 2) % matches.length;
  findIndex.value = next;
  const hash = matches[next];
  const commit = commits.value.find((c) => c.hash === hash);
  if (!commit) {
    return;
  }
  setSelected(commit);
  await nextTick();
  scrollCommitIntoView(hash);
}
function scrollCommitIntoView(hash) {
  const el = document.querySelector(`tr.plegma-row[data-hash="${cssEscape(hash)}"]`);
  if (el && typeof el.scrollIntoView === "function") {
    try {
      el.scrollIntoView({ block: "center" });
    } catch {
      // Older/limited DOM implementations: selection alone is enough.
    }
  }
}
function cssEscape(value) {
  // A replacer function, not a replacement string: "$&" would be expanded.
  return String(value).replace(/["\\]/g, (m) => "\\" + m);
}

const filteredCommits = computed(() => {
  const q = findMode.value ? "" : commitFilter.value.trim().toLowerCase();
  const headHash = headBranch.value ? headBranch.value.target : null;
  const layOut = (list) =>
    toGraphViewModels(list, { headHash }).map((vm) => ({
      ...vm,
      graph: rowGraph(vm),
    }));
  if (!q) {
    return layOut(commits.value);
  }
  const matched = commits.value.filter((c) => {
    const refs = branchesByTarget.value.get(c.hash) || [];
    const hay = [
      c.hash,
      c.subject,
      c.authorName,
      ...(c.refs || []),
      ...refs.map((b) => b.name),
      ...(tagsByTarget.value.get(c.hash) || []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  // Lay out the visible subset with edges rewired to the nearest visible
  // ancestors, so lanes stay correct instead of dangling at hidden rows.
  const visibleSet = new Set(matched.map((c) => c.hash));
  const rewritten = visibleParentIds(commits.value, visibleSet);
  return layOut(matched.map((c) => ({ ...c, parents: rewritten.get(c.hash) || [] })));
});

// The worktree node: the uncommitted changes sit above HEAD in the graph,
// in HEAD's own lane, so the swimlane reads as one continuous history.
// Lane geometry mirrors graph.js (node at lane centre, row height 22).
const worktreeNode = computed(() => {
  const headHash = headBranch.value ? headBranch.value.target : "";
  const headRow = filteredCommits.value.find((c) => c.hash === headHash);
  const first = headRow && headRow.graph && headRow.graph.circles && headRow.graph.circles[0];
  const cx = first ? first.cx : SWIMLANE_WIDTH;
  const stroke = first ? first.stroke : "var(--vscode-editor-background, #1e1e1e)";
  return {
    cx,
    cy: SWIMLANE_WIDTH,
    r: 5,
    fill:
      laneColorByHash.value.get(headHash) ||
      "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
    stroke,
  };
});
// The connector only makes sense when HEAD is the very next row; with a
// search or a branch filter the worktree node stands alone.
const headBelowWorktree = computed(() => {
  const headHash = headBranch.value ? headBranch.value.target : "";
  return (
    !!headHash && filteredCommits.value.length > 0 && filteredCommits.value[0].hash === headHash
  );
});

const maxGraphWidth = computed(() => {
  let max = SWIMLANE_WIDTH * 2;
  for (const c of filteredCommits.value) {
    const w = (c.graph && c.graph.width) || max;
    max = Math.max(max, w);
  }
  return max;
});

// Lineage highlight: hovering a commit node dims every row outside the
// hovered commit's ancestor + descendant sets, so branches can be traced
// visually. Walks the full (unfiltered) parent map, capped. The same
// hover also drives the commit hover card (native-style popup with
// author, date, full message and hash).
const hoveredHash = ref(null);
const hoverCard = ref(null); // { hash, x, y } once the hover delay elapses
let hoverTimer = null;
let hoverPending = null; // { hash, x, y } while the delay is pending

function formatRelative(ts) {
  if (!ts) {
    return "";
  }
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) {
    return "just now";
  }
  const m = Math.floor(diff / 60);
  if (m < 60) {
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(h / 24);
  if (d < 30) {
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  const mo = Math.floor(d / 30);
  if (mo < 12) {
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(mo / 12);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

function formatHoverDate(ts) {
  if (!ts) {
    return "";
  }
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
}

function clearHoverTimer() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function cancelHover() {
  clearHoverTimer();
  hoverPending = null;
  hoverCard.value = null;
  hoveredHash.value = null;
}

// How long the pointer must rest on a row before the card opens. The native
// graph's hover comes up in a quarter of a second; 500ms read as lag there.
const HOVER_DELAY_MS = 250;
// Generous defaults so a typical card never needs its own scrollbar. The
// height is deliberately roomy: a commit message plus refs plus the file
// summary is a tall block, and at 420px it scrolled for most commits. The
// CSS caps both dimensions, and clampXY keeps the card inside the window.
const HOVER_CARD_W = 520;
const HOVER_CARD_H = 640;

// Hovering anywhere on a row schedules the hover card after a short delay
// (like the native graph hover), so the popup does not flash while
// scrolling through history. Only the graph cell (the whole lane column,
// not the 4px node circle) lights up the lineage: dimming the list while
// the pointer crosses titles read as noise, tracing belongs to the graph.
function onRowHoverEnter(e, c) {
  if (menu.value) {
    return;
  }
  if (hoverCard.value && hoverCard.value.hash === c.hash) {
    return;
  }
  if (hoverTimer && hoverPending && hoverPending.hash === c.hash) {
    return;
  }
  hoverPending = { hash: c.hash, x: (e && e.clientX) || 0, y: (e && e.clientY) || 0 };
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (!hoverPending || hoverPending.hash !== c.hash) {
      return;
    }
    if (menu.value) {
      return;
    }
    const at = clampXY(hoverPending.x + 12, hoverPending.y + 12, HOVER_CARD_W, HOVER_CARD_H);
    hoverCard.value = { hash: hoverPending.hash, ...at };
  }, HOVER_DELAY_MS);
}

function onRowHoverMove(e) {
  if (hoverPending && !hoverCard.value) {
    hoverPending.x = (e && e.clientX) || 0;
    hoverPending.y = (e && e.clientY) || 0;
  }
}

function onRowHoverLeave(e) {
  const to = e && e.relatedTarget;
  if (to && to.closest && typeof to.closest === "function" && to.closest(".plegma-hover-card")) {
    return; // moving onto the card keeps it (and the lineage) alive
  }
  cancelHover();
}

function onNodeHoverEnter(e, c) {
  hoveredHash.value = c.hash;
  onRowHoverEnter(e, c);
}

// Leaving the graph cell clears the lineage, except when the pointer moves
// onto the hover card. The card itself belongs to the row, so moving on to
// the title keeps it; leaving the row (onRowHoverLeave) ends it.
function onNodeHoverLeave(e) {
  const to = e && e.relatedTarget;
  if (to && to.closest && typeof to.closest === "function" && to.closest(".plegma-hover-card")) {
    return;
  }
  hoveredHash.value = null;
}

const hoverCardCommit = computed(
  () => (hoverCard.value && commits.value.find((c) => c.hash === hoverCard.value.hash)) || null,
);
// Refs listed in the hover card. A local branch and its same-named remote
// are one chip in the graph — a 22px row has room for the name, not for
// two — but the popup is the place to read them, so the fold is undone
// there: one chip per ref, each with its full name (`main` and
// `origin/main` side by side), in the commit's lane color.
const hoverCardChips = computed(() =>
  hoverCard.value ? chipsByTarget.value.get(hoverCard.value.hash) || [] : [],
);
const hoverCardRefs = computed(() => {
  const out = [];
  for (const c of hoverCardChips.value) {
    out.push(c);
    if (c.paired) {
      out.push({
        ...c,
        kind: "remote",
        name: c.remote.name,
        isHead: false,
        worktree: null,
        paired: false,
        branch: c.remote,
      });
    }
  }
  return out;
});
const hoverCardTags = computed(() =>
  hoverCard.value ? tagsByTarget.value.get(hoverCard.value.hash) || [] : [],
);
const hoverCardColor = computed(() =>
  hoverCard.value ? laneColorByHash.value.get(hoverCard.value.hash) : undefined,
);

// How much this commit changed, as the native graph hover reports it. Absent
// for a commit with no textual diff (a merge), where git's numstat is empty.
const hoverCardStats = computed(() => {
  const c = hoverCardCommit.value;
  if (!c || !c.filesChanged) {
    return null;
  }
  return {
    files: c.filesChanged,
    additions: c.additions || 0,
    deletions: c.deletions || 0,
  };
});

async function copyHoverHash(hash) {
  try {
    await navigator.clipboard.writeText(hash);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
}
// Lineage dimming, minus the rows you picked. Hovering dims everything
// outside the hovered commit's lineage; dimming the selected (or ticked)
// rows too made the one row you care about the hardest to see, so neither
// is ever dimmed.
function isDimmedByLineage(c) {
  if (!lineage.value || lineage.value.has(c.hash)) {
    return false;
  }
  return c.hash !== selected.value && !checked.value.includes(c.hash);
}

const childrenByHash = computed(() => {
  const map = new Map();
  for (const c of commits.value) {
    for (const p of c.parents || []) {
      if (!map.has(p)) {
        map.set(p, []);
      }
      map.get(p).push(c.hash);
    }
  }
  return map;
});
const lineage = computed(() => {
  const start = hoveredHash.value;
  if (!start) {
    return null;
  }
  const byHash = new Map(commits.value.map((c) => [c.hash, c]));
  if (!byHash.has(start)) {
    return null;
  }
  const set = new Set([start]);
  const up = [start];
  let guard = 0;
  while (up.length > 0 && guard++ < 4000) {
    const id = up.pop();
    const node = byHash.get(id);
    for (const p of (node && node.parents) || []) {
      if (!set.has(p) && byHash.has(p)) {
        set.add(p);
        up.push(p);
      }
    }
  }
  const down = [start];
  guard = 0;
  while (down.length > 0 && guard++ < 4000) {
    const id = down.pop();
    for (const ch of childrenByHash.value.get(id) || []) {
      if (!set.has(ch)) {
        set.add(ch);
        down.push(ch);
      }
    }
  }
  return set;
});

function onRowClick(e, c) {
  cancelHover();
  setFilesPanelOpen(true);
  if (!commitPanes.value.files) {
    commitPanes.value.files = true;
    persistCommitPanes();
  }
  worktreeSelected.value = false;
  const ids = filteredCommits.value.map((x) => x.hash);
  if (e.shiftKey && anchor.value) {
    checked.value = rangeSelect(checked.value, ids, anchor.value, c.hash);
    selected.value = c.hash;
  } else if (e.ctrlKey || e.metaKey) {
    checked.value = toggleCheck(checked.value, c.hash);
    anchor.value = c.hash;
    selected.value = c.hash;
  } else {
    checked.value = [c.hash];
    anchor.value = c.hash;
    selected.value = c.hash;
  }
}

function focusAdjacentCommit(e, direction) {
  const rows = [...e.currentTarget.parentElement.querySelectorAll("tr.plegma-row")];
  const next = rows[rows.indexOf(e.currentTarget) + direction];
  if (next) {
    next.focus();
    next.click();
  }
}

// Right-click opens the one menu a commit has. `chip` is set when the
// right-click landed on a ref badge, which appends that branch's own
// actions to the commit's — the same commit, the same menu, either way.
// The reserved height matches the menu's CSS max-height, so a long menu
// scrolls instead of running off the bottom of the window.
const MENU_MAX_H = 600;
function onRowContext(e, c, chip) {
  cancelHover();
  worktreeSelected.value = false;
  selected.value = c.hash;
  tagMenu.value = null;
  submenu.value = null;
  const at = clampXY(e.clientX, e.clientY, 260, MENU_MAX_H);
  menu.value = { ...at, hash: c.hash, chip: chip || null };
}

// One nested menu at a time, opened by hovering (or clicking) a parent
// item — the way the native graph nests its checkout list. It sits a few
// pixels to the right of its parent, overlapping it so the pointer never
// crosses a gap, and closes when either half is left, when any other item
// is entered, when the parent menu scrolls, or when the menu itself goes
// away. The scroll case matters: the nested list is viewport-positioned,
// so left open it would drift away from its parent row as the menu moves.
function openSubmenu(e, key) {
  const rect = e.currentTarget && e.currentTarget.getBoundingClientRect();
  if (!rect) {
    return;
  }
  const at = clampXY(rect.right - 6, rect.top - 6, 280, MENU_MAX_H);
  submenu.value = { key, ...at };
}
function toggleSubmenu(e, key) {
  if (submenu.value && submenu.value.key === key) {
    submenu.value = null;
    return;
  }
  openSubmenu(e, key);
}
function closeSubmenu() {
  submenu.value = null;
}
// Any menu item that is not a submenu parent dismisses the nested one.
function onPlainItem() {
  closeSubmenu();
}
watch(menu, (m) => {
  if (!m) {
    submenu.value = null;
  }
});

function onTagContext(e, name) {
  menu.value = null;
  const at = clampXY(e.clientX, e.clientY, 250, 200);
  tagMenu.value = { ...at, name };
}

// Viewport-clamped popup position. Lives in script (where `window` is the
// real global) because template expressions cannot see `window`: Vue
// resolves bare `window` on the component proxy, so `window.innerWidth`
// in a template throws "Cannot read properties of undefined" and blanks
// the whole webview.
function clampXY(x, y, w, h) {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 768;
  return { x: Math.max(0, Math.min(x, vw - w)), y: Math.max(0, Math.min(y, vh - h)) };
}

watch(
  [
    menu,
    tagMenu,
    fetchDialog,
    rewordFor,
    resetTarget,
    deleteTarget,
    deleteTagTarget,
    deleteRemoteTarget,
    pushForceTarget,
    fileMenu,
    branchFilterOpen,
    colMenuOpen,
    remoteDeleteTarget,
    stashDropTarget,
    discardTarget,
  ],
  ([m, tm, fd, r, rt, dt, dtt, drt, pft, fm, bfo, cmo, rdt, sdt, dd]) => {
    if (
      !m &&
      !tm &&
      !fd &&
      !r &&
      !rt &&
      !dt &&
      !dtt &&
      !drt &&
      !pft &&
      !fm &&
      !bfo &&
      !cmo &&
      !rdt &&
      !sdt &&
      !dd
    ) {
      return;
    }
    const close = () => {
      closeOverlays();
    };
    window.addEventListener("click", close, { once: true });
  },
);

function closeOverlays() {
  cancelHover();
  menu.value = null;
  submenu.value = null;
  tagMenu.value = null;
  fetchDialog.value = null;
  rewordFor.value = null;
  resetTarget.value = null;
  revertTarget.value = null;
  deleteTarget.value = null;
  deleteTagTarget.value = null;
  deleteRemoteTarget.value = null;
  pushForceTarget.value = null;
  fileMenu.value = null;
  branchFilterOpen.value = false;
  colMenuOpen.value = false;
  remoteDeleteTarget.value = null;
  stashDropTarget.value = null;
  discardTarget.value = null;
}

// Keyboard shortcuts. Ctrl+H jumps to HEAD, Ctrl+R reloads the log.
// VS Code keeps these for the workbench, so the webview sees them only
// while it has focus; either way the handler stays cheap.
function scrollToHead() {
  const target = headBranch.value ? headBranch.value.target : "";
  if (!target) {
    return;
  }
  const el = document.querySelector(`tr.plegma-row[data-hash="${cssEscape(target)}"]`);
  const scroller = document.querySelector(".plegma-history-scroll");
  if (el && scroller) {
    // Centering keeps HEAD visible without jumping to the very top, which
    // is where the newest commit usually already is.
    const offset = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
    scroller.scrollTop = Math.max(0, offset);
    setSelected(target);
  } else if (scroller) {
    scroller.scrollTop = 0;
  }
}
async function refreshNow() {
  if (loading.value) {
    return;
  }
  await load();
  await syncFingerprint();
}
function inTextField(e) {
  const el = e && e.target;
  if (!el || !el.tagName) {
    return false;
  }
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!el.isContentEditable;
}
function onGlobalKeydown(e) {
  if (e && e.key === "Escape") {
    closeOverlays();
    if (settingsOpen.value) {
      closeSettings();
    }
    if (findMode.value) {
      stopFind();
    }
    return;
  }
  if (!e || !e.ctrlKey || e.altKey || e.metaKey) {
    return;
  }
  const key = String(e.key || "").toLowerCase();
  if (key === "h" && !inTextField(e)) {
    e.preventDefault();
    scrollToHead();
  } else if (key === "r" && !inTextField(e)) {
    e.preventDefault();
    refreshNow();
  }
}

// Clicks outside the tab never reach the webview, so the click-closer
// misses them; the focus move they cause fires blur instead, which closes
// every overlay like Escape does.
function onWindowBlur() {
  closeOverlays();
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("blur", onWindowBlur);
}

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onGlobalKeydown);
    window.removeEventListener("blur", onWindowBlur);
  }
  clearHoverTimer();
  if (opStatusTimer) {
    clearTimeout(opStatusTimer);
    opStatusTimer = null;
  }
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
  menu.value = null;
  submenu.value = null;
}

async function copyHash(hash) {
  await copyText(hash);
}

// Copy a whole selection: one hash per line, or the messages in history
// order with a blank line between them. The selection menu only offers
// what works on every commit in it — copying all of them is one of those.
function copyHashes(hashes) {
  copyText(hashes.join("\n"));
}
function copyMessages(hashes) {
  const list = hashes.map((h) => commits.value.find((c) => c.hash === h)).filter(Boolean);
  copyText(
    list
      .map((c) => c.subject + (c.body && c.body.trim() ? `\n\n${c.body.trim()}` : ""))
      .join("\n\n"),
  );
}

// Absolute path for a repo-relative file path. The separator comes from
// the repository root's shape, since the webview has no `path` module.
function repoAbsPath(rel) {
  const root = String(activeRoot.value || "").replace(/[\\/]+$/, "");
  const clean = String(rel || "");
  if (!root) {
    return clean;
  }
  if (!clean) {
    return root;
  }
  const sep = /^[A-Za-z]:[\\/]/.test(root) || root.includes("\\") ? "\\" : "/";
  return root + sep + clean.split("/").join(sep);
}

// Right-click a file row for path actions. The menu lives in the webview
// (no backend call) and dismisses on the next click anywhere.
function openFileMenu(e, file) {
  if (!file || !file.path) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  closeOverlays();
  const at = clampXY(e.clientX, e.clientY, 260, 110);
  fileMenu.value = { ...at, path: file.path, status: file.status };
}

// Clipboard-only file-row actions: the repo-relative path as git reports
// it, or the full path on disk. No backend involved.
async function copyFilePath(absolute) {
  const t = fileMenu.value;
  fileMenu.value = null;
  if (!t || !t.path) {
    return;
  }
  const text = absolute ? repoAbsPath(t.path) : t.path;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
}

async function copyBranchName(name) {
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
  menu.value = null;
}

async function doDeleteBranch(name, force = false) {
  const raw = menu.value ? { x: menu.value.x, y: menu.value.y } : { x: 200, y: 200 };
  menu.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("deleteBranch", { name, force });
    opStatus.value = {
      text: `Deleted branch ${name}${force ? " (forced)" : ""}.`,
      isError: false,
    };
    await load();
    await syncFingerprint();
  } catch (e) {
    if (e && e.notMerged && !force) {
      // Safe delete refused (e.g. squash-merged PR branch): offer a
      // force-delete confirmation instead of a dead-end error.
      const at = clampXY(raw.x, raw.y, 340, 150);
      deleteTarget.value = { name, ...at };
    } else {
      opStatus.value = {
        text: `Delete branch ${name} failed: ${(e && e.message) || e}`,
        isError: true,
      };
    }
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

async function doForceDeleteBranch() {
  const t = deleteTarget.value;
  if (!t) {
    return;
  }
  deleteTarget.value = null;
  await doDeleteBranch(t.name, true);
}

// `prefill` is the name the user almost certainly wants: creating a branch
// from a remote ref is "the same branch, but local", so origin/feature opens
// the box with `feature` in it (git's own --track checkout does the same).
async function doCreateBranch(startPoint, startLabel, prefill = "") {
  menu.value = null;
  submenu.value = null;
  let name = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `New branch starting at ${startLabel}`,
      placeHolder: "feature/my-branch",
      value: prefill || "",
    });
    name = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Branch name prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!name || !name.trim()) {
    return; // dismissed
  }
  await runOp(`Create branch ${name.trim()}`, "createBranch", { name: name.trim(), startPoint });
}

async function doCreateTag(target, targetLabel) {
  menu.value = null;
  let name = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `New tag on ${targetLabel}`,
      placeHolder: "v1.0.0",
    });
    name = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Tag name prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!name || !name.trim()) {
    return; // dismissed
  }
  await runOp(`Create tag ${name.trim()}`, "createTag", { name: name.trim(), target });
}

async function doRenameBranch(oldName) {
  const current = menuChip.value && menuChip.value.name;
  menu.value = null;
  let newName = null;
  try {
    const data = await requestVia("promptInput", {
      prompt: `Rename branch ${oldName}`,
      value: current || oldName,
    });
    newName = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Rename prompt failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!newName || !newName.trim() || newName.trim() === oldName) {
    return; // dismissed or unchanged
  }
  await runOp(`Rename branch ${oldName}`, "renameBranch", { oldName, newName: newName.trim() });
}

function checkoutFromBranchMenu() {
  const name = menuChip.value && menuChip.value.name;
  menu.value = null;
  if (name) {
    doCheckout(name);
  }
}

function cherryPickFromMenu() {
  const hash = menu.value && menu.value.hash;
  menu.value = null;
  if (hash) {
    runOp(`Cherry-pick ${shortHash(hash)}`, "cherryPick", { sha: hash });
  }
}

function revertFromMenu() {
  const hash = menu.value && menu.value.hash;
  menu.value = null;
  if (hash) {
    runOp(`Revert ${shortHash(hash)}`, "revertCommit", { sha: hash });
  }
}

async function doResetAsk() {
  const hash = menu.value && menu.value.hash;
  const raw = menu.value ? { x: menu.value.x, y: menu.value.y } : { x: 200, y: 200 };
  menu.value = null;
  if (!hash) {
    return;
  }
  // Position is pre-clamped via clampXY: templates must not touch `window`.
  const at = clampXY(raw.x, raw.y, 340, 150);
  resetTarget.value = { sha: hash, mode: resetDefaultMode.value, ...at };
}

async function doResetTo() {
  const t = resetTarget.value;
  if (!t) {
    return;
  }
  resetTarget.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("resetTo", { sha: t.sha, mode: t.mode });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Reset failed: ${(e && e.message) || e}`, isError: true };
    await load();
    await syncFingerprint();
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

function rebaseFromBranchMenu() {
  const name = menuChip.value && menuChip.value.name;
  menu.value = null;
  if (name) {
    doRebaseOnto(name);
  }
}

function mergeFromBranchMenu() {
  const name = menuChip.value && menuChip.value.name;
  menu.value = null;
  if (name) {
    doMergeBranch(name);
  }
}

function mergeCommitFromMenu() {
  const hash = menu.value && menu.value.hash;
  menu.value = null;
  if (hash) {
    doMergeCommit(hash);
  }
}

async function doMergeCommit(sha) {
  if (!sha) {
    return;
  }
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("mergeCommit", { sha });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Merge failed: ${(e && e.message) || e}`, isError: true };
    await load();
    await syncFingerprint();
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

async function doMergeBranch(name) {
  if (!name) {
    return;
  }
  opBusy.value = true;
  opStatus.value = null;
  try {
    await requestVia("mergeBranch", { name });
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `Merge failed: ${(e && e.message) || e}`, isError: true };
    await load();
    await syncFingerprint();
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

async function doMergeCmd(cmd, label) {
  opBusy.value = true;
  try {
    await requestVia(cmd);
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: `${label} failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

// Update a branch in place via one backend call, which fails fast when
// the branch has no upstream (or the repo no remotes) and reports the
// actual current branch on failure. The checked-out branch pulls --ff-only
// through updateBranch; any other branch fast-forwards in place with
// `fetch <remote> <branch>:<local>` instead of switching branches around
// it — same outcome, working tree untouched.
async function doUpdateBranch(name) {
  const upstream = menuChipUpstream.value;
  const wasCurrent = !!headBranch.value && headBranch.value.name === name;
  menu.value = null;
  const slash = (upstream || "").indexOf("/");
  const fetchArgs =
    !wasCurrent && slash > 0
      ? { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1), local: name }
      : null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    if (fetchArgs) {
      await requestVia("fetchRemoteBranch", fetchArgs);
    } else {
      await requestVia("updateBranch", { name });
    }
    await load();
    await syncFingerprint();
  } catch (e) {
    opStatus.value = { text: (e && e.message) || String(e), isError: true };
    await load();
    await syncFingerprint();
  } finally {
    opBusy.value = false;
    refreshConflictState();
  }
}

const menuCommit = computed(
  () => commits.value.find((c) => c.hash === (menu.value && menu.value.hash)) || null,
);
// The ref badge the menu was opened on, or null when it was opened on the
// row itself. Only ever a branch chip: a tag chip has its own, smaller menu.
const menuChip = computed(() => (menu.value && menu.value.chip) || null);
// Right-clicking inside a selection of two or more commits: the menu then
// offers only what works on the whole selection, and says so.
const menuMulti = computed(() =>
  menu.value && checked.value.length > 1 && checked.value.includes(menu.value.hash)
    ? orderedChecked.value
    : null,
);
const menuTargets = computed(() =>
  menu.value
    ? checked.value.includes(menu.value.hash)
      ? orderedChecked.value
      : [menu.value.hash]
    : [],
);
// The commit is the tip of the checked-out branch: nothing to check out
// detached, nothing to reset to, nothing to rebase onto, nothing to merge.
const menuAtHead = computed(
  () => !!(headBranch.value && headBranch.value.target === (menu.value && menu.value.hash)),
);
// What "Checkout" can offer: the local branches and tags pointing at this
// commit, minus the ones git would refuse — the branch already checked out
// here, and any branch a linked worktree holds.
const menuCheckoutTargets = computed(() => {
  if (!menu.value) {
    return [];
  }
  const head = headBranch.value;
  const out = [];
  for (const b of branchesByTarget.value.get(menu.value.hash) || []) {
    if (b.kind !== "local") {
      continue;
    }
    if (head && head.target === menu.value.hash && head.name === b.name) {
      continue; // already checked out
    }
    if (worktreeByBranch.value.has(b.name)) {
      continue; // held by a linked worktree; git refuses
    }
    out.push({ kind: "branch", name: b.name });
  }
  for (const t of tagsByTarget.value.get(menu.value.hash) || []) {
    out.push({ kind: "tag", name: t });
  }
  return out;
});
// "Rebase onto" nests the branches at this commit plus the commit itself.
const menuRebaseTargets = computed(() => {
  if (!menu.value) {
    return [];
  }
  const head = headBranch.value ? headBranch.value.name : null;
  return (branchesByTarget.value.get(menu.value.hash) || []).filter((b) => b.name !== head);
});

// Upstream remote branch of the current branch, for the native compare
// actions ("Compare with Remote", "Compare with Merge Base"). Null when
// the current branch tracks nothing — or when the remote sits on this very
// commit, which leaves nothing to compare.
const menuCompareRemote = computed(() => {
  if (!menu.value || !headBranch.value || !headBranch.value.upstream) {
    return null;
  }
  const up = headBranch.value.upstream;
  const rb = branches.value.find((b) => b.kind !== "local" && b.name === up);
  if (!rb || !rb.target || rb.target === menu.value.hash) {
    return null;
  }
  return { name: rb.name, target: rb.target };
});

// Remote + short name split ("origin/foo" -> remote "origin", branch "foo").
function splitRemoteName(name) {
  const slash = (name || "").indexOf("/");
  if (slash <= 0) {
    return null;
  }
  return { remote: name.slice(0, slash), short: name.slice(slash + 1) };
}
// The remote-tracking ref a chip speaks about: the remote folded into a
// paired chip, or a remote-only chip's own name. "Fetch <this> into <local>"
// needs the two apart — a paired chip's own name is the local one.
const menuChipRemoteName = computed(() => {
  const chip = menuChip.value;
  if (!chip) {
    return "";
  }
  return chip.paired ? chip.remote.name : chip.name;
});
// The local branch a remote action lands in.
const menuChipLocalName = computed(() => {
  const chip = menuChip.value;
  if (!chip) {
    return "";
  }
  return chip.kind === "local"
    ? chip.name
    : (menuChipRemote.value && menuChipRemote.value.short) || chip.name;
});
// The branch this local chip tracks, when it tracks one. The menu names it
// in every label that touches the network ("Update x from origin/x"), so a
// reader never has to look up what an action will push to or pull from.
const menuChipUpstream = computed(() =>
  menuChip.value && menuChip.value.kind === "local" && menuChipBranch.value
    ? menuChipBranch.value.upstream || ""
    : "",
);
// The tracked remote ref, resolved against the loaded branches. Null when
// the branch tracks nothing — or when the tracked ref is gone (deleted on
// the remote and pruned locally): then there is nothing to pull, so Update
// is not offered at all instead of failing in the backend.
const menuChipUpstreamBranch = computed(() => {
  const up = menuChipUpstream.value;
  if (!up) {
    return null;
  }
  return branches.value.find((b) => b.kind !== "local" && b.name === up) || null;
});
// Update is offered for a local branch tracking a live remote ref. Where
// it is offered, the separate fetch item would duplicate it, so the fetch
// item only remains where Update cannot go.
const menuChipUpdateOffered = computed(
  () => !!(menuChip.value && menuChip.value.kind === "local" && menuChipUpstreamBranch.value),
);
// The menu chip's remote half, if it has one: either the remote folded into
// a paired chip, or a remote-only chip's own name.
const menuChipRemote = computed(() => {
  const chip = menuChip.value;
  if (!chip) {
    return null;
  }
  if (chip.paired) {
    return splitRemoteName(chip.remote.name);
  }
  if (chip.kind === "local") {
    return null;
  }
  return splitRemoteName(chip.name);
});
// Whether "Fetch <remote> into <local>" may be offered: the same-named
// local branch must exist (otherwise the fetch would silently create it)
// and must not be checked out (git refuses that fetch).
const menuChipFetchAllowed = computed(() => {
  if (!menuChipRemote.value) {
    return false;
  }
  const local =
    branches.value.find((b) => b.kind === "local" && b.name === menuChipLocalName.value) || null;
  if (!local) {
    return false;
  }
  return !(headBranch.value && headBranch.value.name === local.name);
});
// Is the menu chip the branch this repository has checked out? Rebase/merge
// onto it, deleting it and checking it out are all no-ops or refusals then.
const menuChipIsHead = computed(() => {
  const chip = menuChip.value;
  return !!(
    chip &&
    chip.kind === "local" &&
    headBranch.value &&
    headBranch.value.name === chip.name
  );
});

function openChangesFromMenu() {
  const hash = menu.value && menu.value.hash;
  menu.value = null;
  if (!hash) {
    return;
  }
  requestVia("openCommit", { sha: hash }).catch((e) => {
    opStatus.value = { text: `Open Changes failed: ${(e && e.message) || e}`, isError: true };
  });
}

function checkoutDetachedFromMenu() {
  const hash = menu.value && menu.value.hash;
  menu.value = null;
  if (hash) {
    runOp(`Checkout ${shortHash(hash)}`, "checkoutDetached", { sha: hash });
  }
}

async function copyCommitMessage() {
  const c = menuCommit.value;
  menu.value = null;
  if (!c) {
    return;
  }
  const text = c.subject + (c.body && c.body.trim() ? `\n\n${c.body.trim()}` : "");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    opStatus.value = { text: "Copy failed: clipboard unavailable.", isError: true };
  }
}

async function doCompare(oldRev, newRev, oldLabel, newLabel) {
  menu.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    const data = await requestVia("openCompare", { oldRev, newRev, oldLabel, newLabel });
    if (data && data.empty) {
      opStatus.value = {
        text: data.message || `There are no changes between "${oldLabel}" and "${newLabel}".`,
        isError: false,
      };
    }
  } catch (e) {
    opStatus.value = { text: `Compare failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

async function compareWorktreeFromMenu() {
  const hash = menu.value && menu.value.hash;
  if (!hash) {
    return;
  }
  menu.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    const data = await requestVia("openCompareWorktree", { rev: hash, label: shortHash(hash) });
    if (data && data.empty) {
      opStatus.value = {
        text: data.message || "The working tree matches this commit.",
        isError: false,
      };
    }
  } catch (e) {
    opStatus.value = { text: `Compare failed: ${(e && e.message) || e}`, isError: true };
  } finally {
    opBusy.value = false;
  }
}

function compareWithRemoteFromMenu() {
  const t = menuCompareRemote.value;
  const hash = menu.value && menu.value.hash;
  if (!t || !hash) {
    return;
  }
  doCompare(t.target, hash, t.name, shortHash(hash));
}

async function compareWithMergeBaseFromMenu() {
  const t = menuCompareRemote.value;
  const hash = menu.value && menu.value.hash;
  const head = headBranch.value;
  if (!t || !hash || !head) {
    return;
  }
  menu.value = null;
  opBusy.value = true;
  opStatus.value = null;
  try {
    const data = await requestVia("mergeBase", { a: head.target, b: t.target });
    const base = data && data.sha;
    if (!base) {
      throw new Error("Could not resolve the merge base.");
    }
    opBusy.value = false;
    await doCompare(base, hash, t.name, shortHash(hash));
  } catch (e) {
    opBusy.value = false;
    opStatus.value = { text: `Compare failed: ${(e && e.message) || e}`, isError: true };
  }
}

async function compareRefFromMenu() {
  const hash = menu.value && menu.value.hash;
  if (!hash) {
    return;
  }
  menu.value = null;
  const items = [
    ...branches.value
      .filter((b) => b.kind === "local")
      .map((b) => ({
        label: b.name,
        description: `branch · ${shortHash(b.target)}`,
        value: { sha: b.target, label: b.name },
      })),
    ...branches.value
      .filter((b) => b.kind !== "local")
      .map((b) => ({
        label: b.name,
        description: `remote branch · ${shortHash(b.target)}`,
        value: { sha: b.target, label: b.name },
      })),
    ...tags.value.map((t) => ({
      label: t.name,
      description: `tag · ${shortHash(t.target)}`,
      value: { sha: t.target, label: t.name },
    })),
  ];
  let picked = null;
  try {
    const data = await requestVia("promptPick", {
      placeHolder: "Select a reference to compare with",
      items,
    });
    picked = data && data.value;
  } catch (e) {
    opStatus.value = { text: `Compare picker failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!picked || !picked.sha) {
    return; // dismissed
  }
  doCompare(picked.sha, hash, picked.label, shortHash(hash));
}

// The tag menu shows the annotation of an annotated tag: who tagged it,
// when, and the message. Lightweight tags have no annotation, so the
// header says so instead of showing an empty block.
const tagMenuTag = computed(() =>
  tagMenu.value ? tags.value.find((t) => t.name === tagMenu.value.name) || null : null,
);

function checkoutTagFromMenu() {
  const name = tagMenu.value && tagMenu.value.name;
  tagMenu.value = null;
  if (name) {
    doCheckout(name);
  }
}

async function pushTagFromMenu() {
  const name = tagMenu.value && tagMenu.value.name;
  if (!name) {
    return;
  }
  tagMenu.value = null;
  let remotes = [];
  try {
    remotes = await requestVia("listRemotes");
  } catch (e) {
    opStatus.value = { text: `Push tag failed: ${(e && e.message) || e}`, isError: true };
    return;
  }
  if (!Array.isArray(remotes) || remotes.length === 0) {
    opStatus.value = {
      text: `Cannot push tag '${name}': no git remotes are configured.`,
      isError: true,
    };
    return;
  }
  let remote = remotes[0];
  if (remotes.length > 1) {
    let picked = null;
    try {
      const data = await requestVia("promptPick", {
        placeHolder: `Push tag ${name} to…`,
        items: remotes.map((r) => ({ label: r, value: r })),
      });
      picked = data && data.value;
    } catch (e) {
      opStatus.value = {
        text: `Remote picker failed: ${(e && e.message) || e}`,
        isError: true,
      };
      return;
    }
    if (!picked) {
      return; // dismissed
    }
    remote = picked;
  }
  await runOp(`Push tag ${name}`, "pushTag", { remote, name });
}

async function doPullRemoteBranch() {
  const t = menuChipRemote.value;
  const head = headBranch.value;
  menu.value = null;
  if (!t || !head) {
    return;
  }
  await runOp(`Pull ${t.remote}/${t.short}`, "pullRemoteBranch", {
    remote: t.remote,
    branch: t.short,
  });
}

// "Delete from remote…" for both a remote-only chip and the remote section
// of a paired chip's menu.
function askDeleteRemoteFromBranchMenu() {
  const t = menuChipRemote.value;
  const chip = menuChip.value;
  const m = menu.value;
  if (!t || !chip || !m) {
    return;
  }
  deleteRemoteTarget.value = {
    remote: t.remote,
    short: t.short,
    name: (chip.paired && chip.remote.name) || chip.name,
    ...clampXY(m.x, m.y, 340, 150),
  };
  menu.value = null;
}

async function doFetchRemoteBranch() {
  const t = menuChipRemote.value;
  menu.value = null;
  if (!t) {
    return;
  }
  await runOp(`Fetch ${t.remote}/${t.short}`, "fetchRemoteBranch", {
    remote: t.remote,
    branch: t.short,
  });
}

function checkoutTrackingFromBranchMenu() {
  const name = menuChip.value && menuChip.value.name;
  menu.value = null;
  if (name) {
    runOp(`Check out ${name}`, "checkoutTracking", { ref: name });
  }
}

async function doDeleteTag() {
  const t = deleteTagTarget.value;
  if (!t) {
    return;
  }
  deleteTagTarget.value = null;
  await runOp(`Delete tag ${t.name}`, "deleteTag", { name: t.name });
}

async function doDeleteRemoteBranch() {
  const t = deleteRemoteTarget.value;
  if (!t) {
    return;
  }
  deleteRemoteTarget.value = null;
  await runOp(
    `Delete remote branch ${t.name}`,
    "deleteRemoteBranch",
    { remote: t.remote, name: t.short },
    `Deleted remote branch ${t.name}.`,
  );
}

// Push a branch from its menu (context-menu only, never toolbar).
// Plain pushes run without a confirm; force pushes go through an
// inline confirm and the backup-ref mechanism. Branches without an
// upstream resolve the remote first: single remote is used directly,
// multiple remotes show a picker.
async function pushFromBranchMenu(force = false) {
  const rec = menuChipBranch.value;
  const raw =
    menu.value && menuChip.value
      ? { name: menuChip.value.name, x: menu.value.x, y: menu.value.y }
      : null;
  if (!raw) {
    return;
  }
  const upstream = rec && rec.upstream;
  let remote = null;
  let setUpstream = false;
  if (upstream && upstream.includes("/")) {
    remote = upstream.slice(0, upstream.indexOf("/"));
  } else {
    let remotes = [];
    try {
      remotes = await requestVia("listRemotes");
    } catch (e) {
      menu.value = null;
      opStatus.value = { text: `Push failed: ${(e && e.message) || e}`, isError: true };
      return;
    }
    if (!Array.isArray(remotes) || remotes.length === 0) {
      menu.value = null;
      opStatus.value = {
        text: `Cannot push '${raw.name}': no git remotes are configured.`,
        isError: true,
      };
      return;
    }
    if (remotes.length === 1) {
      remote = remotes[0];
    } else {
      let picked = null;
      try {
        const data = await requestVia("promptPick", {
          placeHolder: `Push ${raw.name} to…`,
          items: remotes.map((r) => ({ label: r, value: r })),
        });
        picked = data && data.value;
      } catch (e) {
        menu.value = null;
        opStatus.value = {
          text: `Remote picker failed: ${(e && e.message) || e}`,
          isError: true,
        };
        return;
      }
      if (!picked) {
        menu.value = null;
        return; // dismissed
      }
      remote = picked;
    }
    setUpstream = true;
  }
  const at = clampXY(raw.x, raw.y, 340, 150);
  menu.value = null;
  if (force) {
    pushForceTarget.value = { name: raw.name, remote, setUpstream, ...at };
    return;
  }
  await runOp(`Push ${raw.name}`, "pushBranch", { name: raw.name, remote, setUpstream });
}

async function doForcePush() {
  const t = pushForceTarget.value;
  if (!t) {
    return;
  }
  pushForceTarget.value = null;
  await runOp(`Force push ${t.name}`, "pushBranch", {
    name: t.name,
    remote: t.remote,
    setUpstream: t.setUpstream,
    force: true,
  });
}

function statusColor(s) {
  return s === "Added" || s === "Untracked"
    ? "var(--vscode-gitDecoration-addedResourceForeground)"
    : s === "Deleted"
      ? "var(--vscode-gitDecoration-deletedResourceForeground)"
      : "var(--vscode-gitDecoration-modifiedResourceForeground)";
}
function statusLetter(s) {
  return s === "Added"
    ? "A"
    : s === "Deleted"
      ? "D"
      : s === "Renamed"
        ? "R"
        : s === "Untracked"
          ? "U"
          : "M";
}

loadRoots()
  .then(() => load())
  .then(() => syncFingerprint());
refreshConflictState();
startPoll();
</script>

<template>
  <div style="display: flex; height: 100vh">
    <div ref="mainCol" style="flex: 1; display: flex; flex-direction: column; min-width: 0">
      <div class="plegma-toolbar">
        <span class="plegma-toolbar-title">History</span>
        <select
          v-if="repoRoots.length > 1"
          :value="activeRoot"
          title="Repository"
          class="plegma-input plegma-repo-select"
          @change="(e) => switchRoot(e.target.value)"
        >
          <option v-for="r in repoRoots" :key="r.root" :value="r.root">{{ r.name }}</option>
        </select>
        <input
          v-if="findMode"
          v-model="findQuery"
          placeholder="Find in commits"
          aria-label="Find in commits: Enter jumps to the next match"
          class="plegma-input plegma-search plegma-find-input"
          @keydown.enter.prevent="stepFindMatch($event.shiftKey ? -1 : 1)"
          @keydown.esc.prevent="stopFind()"
        />
        <input
          v-else
          v-model="commitFilter"
          placeholder="Search commits"
          aria-label="Search commits by hash, message, author, or ref"
          class="plegma-input plegma-search"
        />
        <button
          class="plegma-icon-btn"
          :class="{ 'plegma-find-btn-active': findMode }"
          :title="findMode ? 'Leave find mode' : 'Find in commits (jump between matches)'"
          :aria-label="findMode ? 'Leave find mode' : 'Find in commits'"
          @click.stop="findMode ? stopFind() : startFind()"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" style="fill: none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6" />
            <line
              x1="10.6"
              y1="10.6"
              x2="14"
              y2="14"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <span v-if="findMode" class="plegma-find-count">{{
          findMatches.length === 0 ? "no matches" : findIndex + 1 + " of " + findMatches.length
        }}</span>
        <select
          :value="commitOrder"
          title="Commit order"
          aria-label="Commit order"
          class="plegma-input plegma-order-select"
          @change="(e) => setCommitOrder(e.target.value)"
        >
          <option v-for="o in ORDER_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div class="plegma-branchfilter">
          <button
            class="plegma-icon-btn"
            title="Show or hide columns"
            aria-label="Show or hide columns"
            :aria-expanded="colMenuOpen"
            @click.stop="colMenuOpen = !colMenuOpen"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" style="fill: none" aria-hidden="true">
              <rect x="2" y="3" width="3" height="10" fill="currentColor" />
              <rect x="6.5" y="3" width="3" height="10" fill="currentColor" />
              <rect x="11" y="3" width="3" height="10" fill="currentColor" />
            </svg>
          </button>
          <div
            v-if="colMenuOpen"
            class="plegma-menu plegma-colmenu-panel"
            @click.stop
            @keydown.esc="colMenuOpen = false"
          >
            <div class="plegma-menu-header">Columns</div>
            <div
              v-for="c in OPTIONAL_COLS"
              :key="'col-' + c.key"
              class="plegma-menu-item plegma-branchfilter-item"
              role="checkbox"
              :aria-checked="colVisible(c.key)"
              tabindex="0"
              @click="toggleCol(c.key)"
              @keydown.enter.prevent="toggleCol(c.key)"
            >
              <span class="plegma-branchfilter-box">{{ colVisible(c.key) ? "✓" : "" }}</span>
              {{ c.label }}
            </div>
          </div>
        </div>
        <div class="plegma-branchfilter">
          <button
            class="plegma-icon-btn plegma-branchfilter-btn"
            :class="{ 'plegma-branchfilter-btn-active': branchFilterActive }"
            title="Filter the log by branch"
            aria-label="Filter the log by branch"
            :aria-expanded="branchFilterOpen"
            @click.stop="toggleBranchFilter()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="ICON_BRANCH" /></svg>
          </button>
          <div
            v-if="branchFilterOpen"
            class="plegma-menu plegma-branchfilter-panel"
            @click.stop
            @keydown.esc="branchFilterOpen = false"
          >
            <div class="plegma-menu-header">Branches</div>
            <div
              class="plegma-menu-item plegma-branchfilter-item"
              role="checkbox"
              :aria-checked="branchFilter.onlyHead"
              tabindex="0"
              @click="setOnlyHead(!branchFilter.onlyHead)"
              @keydown.enter.prevent="setOnlyHead(!branchFilter.onlyHead)"
            >
              <span class="plegma-branchfilter-box">{{ branchFilter.onlyHead ? "✓" : "" }}</span>
              Only {{ headBranch ? headBranch.name : "the current branch" }}
            </div>
            <div class="plegma-menu-sep"></div>
            <div class="plegma-branchfilter-list">
              <div
                v-for="b in branches"
                :key="'bf-' + b.name"
                class="plegma-menu-item plegma-branchfilter-item"
                role="checkbox"
                :aria-checked="branchRefSelected(b.name)"
                tabindex="0"
                @click="toggleBranchRef(b.name)"
                @keydown.enter.prevent="toggleBranchRef(b.name)"
              >
                <span class="plegma-branchfilter-box">{{
                  branchRefSelected(b.name) ? "✓" : ""
                }}</span>
                {{ b.name }}
              </div>
            </div>
            <div class="plegma-menu-sep"></div>
            <input
              v-model="globDraft"
              class="plegma-input plegma-branchfilter-glob"
              placeholder="Pattern, e.g. feature/*"
              aria-label="Branch glob pattern"
              @click.stop
              @keydown.enter.prevent="setBranchGlobs(globDraft)"
              @keydown.esc="branchFilterOpen = false"
            />
            <div class="plegma-menu-item" @click="setBranchGlobs(globDraft)">Apply pattern</div>
            <div v-if="branchFilterActive" class="plegma-menu-item" @click="clearBranchFilter()">
              Clear filter
            </div>
            <div v-if="branchFilter.globs.trim()" class="plegma-branchfilter-hint">
              The pattern replaces the picked branches.
            </div>
          </div>
        </div>
        <div class="plegma-toolbar-actions">
          <!-- Fixed-width status slot: the spinner and its label swap in here
               and the loaded-commit count sits there when idle, so nothing in
               the toolbar moves when an action starts or finishes. -->
          <span class="plegma-status-slot">
            <template v-if="busyVisible">
              <svg class="plegma-spinner" viewBox="0 0 16 16" aria-hidden="true">
                <circle class="plegma-spinner-track" cx="8" cy="8" r="6.2" />
                <circle class="plegma-spinner-arc" cx="8" cy="8" r="6.2" />
              </svg>
              <span v-if="busyLabel" class="plegma-busy-label">{{ busyLabel }}</span>
            </template>
            <span v-else class="plegma-status-idle">{{ commitCountLabel }}</span>
          </span>
          <button
            class="plegma-icon-btn"
            title="Settings"
            aria-label="Settings"
            @click="settingsOpen ? closeSettings() : openSettings()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICON_SETTINGS" /></svg>
          </button>
          <button
            class="plegma-icon-btn"
            title="Refresh (Ctrl+R)"
            aria-label="Refresh"
            :class="{ 'plegma-icon-btn-busy': loading }"
            :disabled="loading"
            @click="load"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="ICON_REFRESH" /></svg>
          </button>
          <button
            class="plegma-icon-btn"
            title="Fetch from remote (git fetch --all)"
            aria-label="Fetch from remote"
            :disabled="opBusy"
            @click="askFetch($event)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="ICON_FETCH" /></svg>
          </button>
        </div>
        <!-- Indeterminate progress along the toolbar's bottom edge. It is
             absolutely positioned (like the busy pill) so nothing in the
             toolbar or the rows below shifts a pixel when it appears. -->
        <div v-if="busyVisible" class="plegma-progress" aria-hidden="true">
          <div class="plegma-progress-bar"></div>
        </div>
      </div>

      <div
        v-if="error"
        style="margin: 0 12px 8px; font-size: 12px; color: var(--vscode-errorForeground)"
      >
        {{ error }}
        <button style="margin-left: 6px" @click="load()">Retry</button>
      </div>

      <div
        v-if="opStatus"
        title="Dismiss"
        style="
          margin: 0 12px 8px;
          font-size: 12px;
          cursor: pointer;
          word-break: break-word;
          white-space: pre-wrap;
          line-height: 1.4;
        "
        :style="{
          color: opStatus.isError ? 'var(--vscode-errorForeground)' : undefined,
          opacity: opStatus.isError ? 1 : 0.8,
        }"
        @click="opStatus = null"
      >
        {{ opStatus.isError ? "" : "✓ " }}{{ opStatus.text }}
      </div>

      <div v-if="settingsOpen" class="plegma-settings" @click.stop>
        <div class="plegma-settings-inner">
          <div class="plegma-settings-header">
            <span class="plegma-settings-title">Settings</span>
            <span class="plegma-settings-subtitle">Stored on this machine only, never synced.</span>
            <span style="flex: 1"></span>
            <button @click="closeSettings()">Back to history</button>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">General</div>
            <label class="plegma-settings-row">
              <input v-model="showAvatars" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Show author avatars</span>
                <span class="plegma-settings-desc"
                  >Gravatar images next to author names, with initials when offline.</span
                >
              </span>
            </label>
            <label class="plegma-settings-row">
              <input v-model="showWorktreeNode" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Show uncommitted changes</span>
                <span class="plegma-settings-desc"
                  >The worktree node row above HEAD and the uncommitted-changes bar.</span
                >
              </span>
            </label>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Fetch</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              Defaults for the Fetch popover and per-remote fetching. The popover edits these same
              values.
            </div>
            <label class="plegma-settings-row">
              <input v-model="fetchOptions.prune" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Prune deleted branches</span>
                <span class="plegma-settings-desc"
                  >Remove remote-tracking references that no longer exist on the remote.</span
                >
              </span>
            </label>
            <label class="plegma-settings-row">
              <input v-model="fetchOptions.pruneTags" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Prune tags</span>
                <span class="plegma-settings-desc"
                  >Remove local tags that no longer exist on the remote. Needs prune enabled.</span
                >
              </span>
            </label>
            <label class="plegma-settings-row">
              <input v-model="fetchOptions.ask" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Ask for options before fetching</span>
                <span class="plegma-settings-desc"
                  >Uncheck to fetch straight through with the options above — the same as "Don't ask
                  again" in the dialog. Check it to bring the dialog back.</span
                >
              </span>
            </label>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Reset</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              Default mode preselected in the reset confirm dialog.
            </div>
            <div style="display: flex; gap: 10px">
              <label
                v-for="m in RESET_MODES"
                :key="'settings-reset-' + m"
                style="display: flex; gap: 4px; align-items: center; cursor: pointer"
              >
                <input v-model="resetDefaultMode" type="radio" :value="m" />
                {{ m[0].toUpperCase() + m.slice(1) }}
              </label>
            </div>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Stash</div>
            <label class="plegma-settings-row">
              <input v-model="stashIncludeUntracked" type="checkbox" />
              <span>
                <span class="plegma-settings-label">Include untracked files when stashing</span>
                <span class="plegma-settings-desc"
                  >New files are stashed too, not just tracked changes.</span
                >
              </span>
            </label>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Columns</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              Same toggles as the columns menu in the toolbar.
            </div>
            <label
              v-for="c in OPTIONAL_COLS"
              :key="'settings-col-' + c.key"
              class="plegma-settings-row"
            >
              <input type="checkbox" :checked="colVisible(c.key)" @change="toggleCol(c.key)" />
              <span>
                <span class="plegma-settings-label">Show {{ c.label }} column</span>
              </span>
            </label>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Commits</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              Default log order. Same select as the toolbar.
            </div>
            <select
              :value="commitOrder"
              aria-label="Default commit order"
              class="plegma-input"
              @change="(e) => setCommitOrder(e.target.value)"
            >
              <option v-for="o in ORDER_OPTIONS" :key="'settings-' + o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </div>

          <div class="plegma-settings-section">
            <div class="plegma-settings-section-title">Branches</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              What the view shows on load when no branch filter was saved.
            </div>
            <div style="display: flex; gap: 10px">
              <label style="display: flex; gap: 4px; align-items: center; cursor: pointer">
                <input v-model="branchFilterOnLoad" type="radio" value="all" /> All branches
              </label>
              <label style="display: flex; gap: 4px; align-items: center; cursor: pointer">
                <input v-model="branchFilterOnLoad" type="radio" value="head" /> Checked-out branch
                only
              </label>
            </div>
          </div>

          <div id="plegma-settings-remotes" class="plegma-settings-section">
            <div class="plegma-settings-section-title">Remotes</div>
            <div class="plegma-settings-desc" style="margin-bottom: 6px">
              Manage this repository's remotes.
            </div>
            <div v-if="remotesLoading" style="opacity: 0.7">Loading remotes…</div>
            <div v-else-if="remotesError" style="color: var(--vscode-errorForeground)">
              {{ remotesError }}
              <button style="margin-left: 6px" @click="loadRemotes()">Retry</button>
            </div>
            <div v-else-if="remotesList.length === 0" style="opacity: 0.7; margin-bottom: 8px">
              No remotes configured. Add one below.
            </div>
            <div v-else style="margin-bottom: 8px">
              <div
                v-for="rm in remotesList"
                :key="'settings-' + rm.name"
                class="plegma-settings-remote"
                :title="(rm.fetchUrl || rm.pushUrl || '').trim()"
              >
                <div class="plegma-settings-remote-name">{{ rm.name }}</div>
                <div class="plegma-settings-remote-url">{{ rm.fetchUrl || rm.pushUrl || "—" }}</div>
                <div class="plegma-settings-remote-actions">
                  <button
                    :disabled="opBusy"
                    title="Fetch this remote"
                    @click="doFetchRemote(rm.name)"
                  >
                    Fetch
                  </button>
                  <button
                    :disabled="opBusy"
                    :title="`Rename ${rm.name}`"
                    @click="doRenameRemote(rm.name)"
                  >
                    Rename…
                  </button>
                  <button
                    :disabled="opBusy"
                    :title="`Change the URL of ${rm.name}`"
                    @click="doSetRemoteUrl(rm.name, rm.fetchUrl || rm.pushUrl)"
                  >
                    URL…
                  </button>
                  <button
                    :disabled="opBusy"
                    :title="`Remove ${rm.name} (keeps local branches)`"
                    @click="askDeleteRemote($event, rm.name)"
                  >
                    Delete…
                  </button>
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-bottom: 8px">
              <input
                v-model="newRemoteName"
                class="plegma-input"
                style="flex: 1; min-width: 0"
                placeholder="Name"
                aria-label="New remote name"
                @keydown.enter.prevent="doAddRemote()"
              />
              <input
                v-model="newRemoteUrl"
                class="plegma-input"
                style="flex: 2; min-width: 0"
                placeholder="URL"
                aria-label="New remote URL"
                @keydown.enter.prevent="doAddRemote()"
              />
              <button
                :disabled="opBusy || !newRemoteName.trim() || !newRemoteUrl.trim()"
                @click="doAddRemote()"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="remoteDeleteTarget"
        style="
          position: fixed;
          z-index: 102;
          width: 320px;
          background: var(--vscode-menu-background);
          border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          padding: 10px;
          font-size: 12px;
        "
        :style="{ left: remoteDeleteTarget.x + 'px', top: remoteDeleteTarget.y + 'px' }"
        @click.stop
      >
        <div style="margin-bottom: 6px">
          Remove remote <b style="font-family: monospace">{{ remoteDeleteTarget.name }}</b
          >? Local branches stay; fetching and pushing to it stops working.
        </div>
        <div style="display: flex; gap: 6px; justify-content: flex-end">
          <button @click="remoteDeleteTarget = null">Cancel</button>
          <button :disabled="opBusy" @click="doDeleteRemote()">Remove</button>
        </div>
      </div>
      <div v-if="!settingsOpen" style="display: contents">
        <div
          v-if="rebaseState.inProgress"
          style="
            margin: 0 12px 8px;
            padding: 8px;
            border: 1px solid var(--vscode-inputValidation-warningBorder, orange);
            font-size: 12px;
          "
        >
          <div style="margin-bottom: 4px">
            Rebase in progress<span v-if="rebaseState.conflictedFiles.length > 0">
              — conflicts: {{ rebaseState.conflictedFiles.join(", ") }}</span
            ><span v-else> — resolve conflicts in the editor, stage the files, then Continue.</span>
          </div>
          <div style="display: flex; gap: 6px">
            <button :disabled="opBusy" @click="doRebaseCmd('rebaseContinue', 'Continue')">
              Continue
            </button>
            <button :disabled="opBusy" @click="doRebaseCmd('rebaseSkip', 'Skip')">Skip</button>
            <button :disabled="opBusy" @click="doRebaseCmd('rebaseAbort', 'Abort')">Abort</button>
          </div>
        </div>

        <div
          v-if="mergeState.inProgress"
          style="
            margin: 0 12px 8px;
            padding: 8px;
            border: 1px solid var(--vscode-inputValidation-warningBorder, orange);
            font-size: 12px;
          "
        >
          <div style="margin-bottom: 4px">
            Merge in progress<span v-if="mergeState.conflictedFiles.length > 0">
              — conflicts: {{ mergeState.conflictedFiles.join(", ") }}</span
            ><span v-else> — resolve conflicts in the editor, stage the files, then Continue.</span>
          </div>
          <div style="display: flex; gap: 6px">
            <button :disabled="opBusy" @click="doMergeCmd('mergeContinue', 'Continue')">
              Continue
            </button>
            <button :disabled="opBusy" @click="doMergeCmd('mergeAbort', 'Abort')">Abort</button>
          </div>
        </div>

        <div
          v-if="noRepo"
          style="margin: 0 12px 8px; font-size: 12px; color: var(--vscode-errorForeground)"
        >
          No git repository in this workspace. Open a folder containing a repo.
        </div>

        <div v-if="checked.length > 0" class="plegma-selection-hint">
          {{ checked.length }} selected · Right-click a commit for actions
        </div>

        <div
          v-if="worktree.length > 0 && showWorktreeNode"
          class="plegma-worktree-bar"
          title="Show uncommitted changes in the Files panel"
          :style="{
            background: worktreeSelected
              ? 'var(--vscode-list-activeSelectionBackground)'
              : 'var(--vscode-list-inactiveSelectionBackground)',
          }"
          @click="selectWorktree()"
        >
          <span class="plegma-worktree-mark" aria-hidden="true">●</span>
          Uncommitted changes on
          <b>{{ headBranch ? headBranch.name : "detached HEAD" }}</b>
          <span class="plegma-worktree-count">
            — {{ worktree.length }} file{{ worktree.length === 1 ? "" : "s" }}</span
          >
          <span class="plegma-worktree-actions">
            <button
              class="plegma-icon-btn"
              title="Stash all changes including untracked files"
              aria-label="Stash changes"
              :disabled="opBusy"
              @click.stop="doStash()"
            >
              Stash
            </button>
            <button
              class="plegma-icon-btn"
              title="Open VS Code's Source Control to commit"
              aria-label="Commit in Source Control"
              @click.stop="revealScm()"
            >
              Commit…
            </button>
            <button
              class="plegma-icon-btn"
              title="Discard all uncommitted changes (cannot be undone)"
              aria-label="Discard all uncommitted changes"
              :disabled="opBusy"
              @click.stop="discardTarget = { paths: null }"
            >
              Drop…
            </button>
          </span>
        </div>

        <div v-if="visibleStashes.length > 0" role="group" aria-label="Stashes">
          <div
            v-for="s in visibleStashes"
            :key="s.name"
            class="plegma-stash-row"
            :title="`${s.name}\n${s.message}`"
          >
            <span class="plegma-worktree-mark" aria-hidden="true">◈</span>
            <span style="font-family: monospace; flex: none">{{ s.name }}</span>
            <span class="plegma-worktree-count">
              — {{ s.message
              }}<span v-if="s.timestamp"> · {{ formatRelative(s.timestamp) }}</span></span
            >
            <span class="plegma-worktree-actions">
              <button
                class="plegma-icon-btn"
                title="Apply this stash (keep it in the list)"
                :aria-label="`Apply ${s.name}`"
                :disabled="opBusy"
                @click.stop="doStashApply(s.name)"
              >
                Apply
              </button>
              <button
                class="plegma-icon-btn"
                title="Pop this stash (apply and remove it from the list)"
                :aria-label="`Pop ${s.name}`"
                :disabled="opBusy"
                @click.stop="doStashPop(s.name)"
              >
                Pop
              </button>
              <button
                class="plegma-icon-btn"
                title="Create a branch from this stash"
                :aria-label="`Branch from ${s.name}`"
                :disabled="opBusy"
                @click.stop="doStashBranch(s.name)"
              >
                Branch…
              </button>
              <button
                class="plegma-icon-btn"
                title="Drop this stash (cannot be undone)"
                :aria-label="`Drop ${s.name}`"
                :disabled="opBusy"
                @click.stop="stashDropTarget = { name: s.name }"
              >
                Drop…
              </button>
            </span>
          </div>
          <div
            v-if="stashDropTarget"
            style="
              margin: 4px 12px 4px;
              padding: 8px;
              border: 1px solid var(--vscode-inputValidation-errorBorder, red);
              font-size: 12px;
            "
          >
            <div style="margin-bottom: 6px">
              Drop <b style="font-family: monospace">{{ stashDropTarget.name }}</b
              >? The stashed changes will be lost. This cannot be undone.
            </div>
            <div style="display: flex; gap: 6px">
              <button @click="stashDropTarget = null">Cancel</button>
              <button :disabled="opBusy" @click="doStashDrop()">Drop</button>
            </div>
          </div>
        </div>

        <div
          ref="contentRow"
          style="flex: 1; display: flex; flex-direction: row; min-height: 0; min-width: 0"
        >
          <div aria-label="Commit graph" class="plegma-history-scroll" @scroll="onGraphScroll">
            <div v-if="loading && commits.length === 0" style="opacity: 0.7">Loading commits…</div>
            <div v-else-if="filteredCommits.length === 0" style="opacity: 0.7">
              No commits match. Real git data required — run inside a repo workspace.
            </div>
            <table v-else class="plegma-history-table" aria-label="Commit history">
              <colgroup>
                <col :style="{ width: maxGraphWidth + 12 + 'px' }" />
                <col />
                <col
                  v-if="colVisible('author')"
                  class="plegma-meta-author"
                  :style="{ width: colWidths.author + 'px' }"
                />
                <col
                  v-if="colVisible('date')"
                  class="plegma-meta-date"
                  :style="{ width: colWidths.date + 'px' }"
                />
              </colgroup>
              <thead>
                <tr>
                  <th class="plegma-graph-heading">Graph</th>
                  <th>Commit</th>
                  <th v-if="colVisible('author')" class="plegma-th plegma-meta-author">
                    Author<span
                      class="plegma-resizer"
                      title="Drag to resize"
                      @mousedown="startResize($event, 'author')"
                    ></span>
                  </th>
                  <th v-if="colVisible('date')" class="plegma-th plegma-meta-date">
                    Date<span
                      class="plegma-resizer"
                      title="Drag to resize"
                      @mousedown="startResize($event, 'date')"
                    ></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-if="worktree.length > 0 && showWorktreeNode"
                  class="plegma-row plegma-row-worktree"
                  :class="{ 'plegma-row-active': worktreeSelected }"
                  data-hash="__worktree__"
                  title="Uncommitted changes in the working tree"
                  :aria-selected="worktreeSelected"
                  tabindex="0"
                  @click="selectWorktree()"
                  @keydown.enter.prevent="selectWorktree()"
                  @keydown.space.prevent="selectWorktree()"
                >
                  <td class="plegma-graph-cell">
                    <svg
                      :width="maxGraphWidth"
                      :height="SWIMLANE_HEIGHT"
                      style="display: block; overflow: visible"
                    >
                      <path
                        v-if="headBelowWorktree"
                        :d="`M ${worktreeNode.cx} ${worktreeNode.cy} V ${SWIMLANE_HEIGHT}`"
                        :stroke="worktreeNode.fill"
                        stroke-width="1.4"
                        fill="none"
                      />
                      <circle
                        :cx="worktreeNode.cx"
                        :cy="worktreeNode.cy"
                        :r="worktreeNode.r"
                        :fill="worktreeNode.fill"
                        :stroke="worktreeNode.stroke"
                        stroke-width="1.4"
                      />
                    </svg>
                  </td>
                  <td class="plegma-subject-cell">
                    <div class="plegma-subject-content">
                      <span class="plegma-worktree-mark" aria-hidden="true">●</span>
                      <span class="plegma-subject"
                        >Uncommitted changes on
                        {{ headBranch ? headBranch.name : "detached HEAD" }}</span
                      >
                      <span class="plegma-worktree-count"
                        >— {{ worktree.length }} file{{ worktree.length === 1 ? "" : "s" }}</span
                      >
                    </div>
                  </td>
                  <td v-if="colVisible('author')" class="plegma-meta-cell plegma-meta-author">—</td>
                  <td v-if="colVisible('date')" class="plegma-meta-cell plegma-meta-date">—</td>
                </tr>
                <tr
                  v-for="c in filteredCommits"
                  :key="c.hash"
                  class="plegma-row"
                  :class="{
                    'plegma-row-active': selected === c.hash,
                    'plegma-row-checked': selected !== c.hash && checked.includes(c.hash),
                    'plegma-row-match': isFindMatch(c.hash),
                    'plegma-row-match-current': isFindCurrent(c.hash),
                  }"
                  :data-hash="c.hash"
                  :style="{
                    opacity: isDimmedByLineage(c) ? 0.35 : undefined,
                  }"
                  :tabindex="
                    selected === c.hash || (!selected && filteredCommits[0]?.hash === c.hash)
                      ? 0
                      : -1
                  "
                  :aria-selected="selected === c.hash"
                  @click="(e) => onRowClick(e, c)"
                  @keydown.enter.prevent="(e) => onRowClick(e, c)"
                  @keydown.space.prevent="(e) => onRowClick(e, c)"
                  @keydown.up.prevent="(e) => focusAdjacentCommit(e, -1)"
                  @keydown.down.prevent="(e) => focusAdjacentCommit(e, 1)"
                  @contextmenu.prevent="(e) => onRowContext(e, c)"
                  @mouseenter="(e) => onRowHoverEnter(e, c)"
                  @mousemove="(e) => onRowHoverMove(e)"
                  @mouseleave="(e) => onRowHoverLeave(e)"
                >
                  <td
                    class="plegma-graph-cell"
                    @mouseenter="(e) => onNodeHoverEnter(e, c)"
                    @mouseleave="(e) => onNodeHoverLeave(e)"
                  >
                    <svg
                      :width="c.graph.width"
                      :height="SWIMLANE_HEIGHT"
                      style="display: block; overflow: visible"
                    >
                      <path
                        v-for="(p, pi) in c.graph.paths"
                        :key="'p' + pi"
                        :d="p.d"
                        :stroke="p.stroke"
                        stroke-width="1.4"
                        fill="none"
                        stroke-linecap="round"
                      />
                      <circle
                        v-for="(o, oi) in c.graph.circles"
                        :key="'c' + oi"
                        :cx="o.cx"
                        :cy="o.cy"
                        :r="o.r"
                        :fill="o.fill"
                        :stroke="o.stroke"
                        :stroke-width="o.strokeWidth"
                      />
                    </svg>
                  </td>
                  <td class="plegma-subject-cell">
                    <div class="plegma-subject-content">
                      <span
                        v-if="
                          (branchesByTarget.get(c.hash) || []).length ||
                          (tagsByTarget.get(c.hash) || []).length
                        "
                        class="plegma-refs"
                      >
                        <RefBadge
                          v-for="b in chipsByTarget.get(c.hash) || []"
                          :key="b.kind + b.name"
                          :chip="b"
                          :color="laneColorByHash.get(c.hash)"
                          :aria-label="branchTitle(b)"
                          role="button"
                          tabindex="0"
                          @keydown.enter.stop.prevent="onRowClick($event, c)"
                          @keydown.space.stop.prevent="onRowClick($event, c)"
                          @dblclick.stop="onBranchChipDblClick(b)"
                          @contextmenu.prevent.stop="(e) => onRowContext(e, c, b)"
                        />
                        <RefBadge
                          v-for="t in tagsByTarget.get(c.hash) || []"
                          :key="'tag' + t"
                          :chip="{ type: 'tag', name: t }"
                          :color="laneColorByHash.get(c.hash)"
                          :aria-label="`Tag ${t}`"
                          role="button"
                          tabindex="0"
                          @click.stop="copyTagName(t)"
                          @keydown.enter.stop.prevent="copyTagName(t)"
                          @keydown.space.stop.prevent="copyTagName(t)"
                          @contextmenu.prevent.stop="(e) => onTagContext(e, t)"
                        />
                      </span>
                      <span class="plegma-subject"><span v-html="rich(c.subject)"></span></span>
                    </div>
                  </td>
                  <td v-if="colVisible('author')" class="plegma-meta-cell plegma-meta-author">
                    <span v-if="showAvatars" class="plegma-avatar">
                      <img
                        v-if="c.avatar && c.avatar.url && !avatarFailed.has(c.hash)"
                        class="plegma-avatar-img"
                        :src="c.avatar.url"
                        alt=""
                        @error="onAvatarError(c)"
                      />
                      <span v-else class="plegma-avatar-initials">{{
                        (c.avatar && c.avatar.initials) || "?"
                      }}</span>
                    </span>
                    <span class="plegma-author-name">{{ c.authorName }}</span>
                  </td>
                  <td v-if="colVisible('date')" class="plegma-meta-cell plegma-meta-date">
                    {{ formatDateTime(c.timestamp) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="commits.length > 0 && (hasMore || commitFilter.trim())"
              style="padding: 8px 4px; font-size: 12px; opacity: 0.8; text-align: center"
            >
              Showing {{ filteredCommits.length }} of {{ commits.length }} commits
              <button
                v-if="hasMore"
                :disabled="loading"
                style="margin-left: 8px"
                @click="loadMore()"
              >
                {{ loading ? "Loading…" : "Load more" }}
              </button>
            </div>
          </div>

          <div
            v-if="filesPanelOpen && (selectedCommit || worktreeSelected)"
            class="plegma-panel-resizer"
            title="Drag to resize the Files panel (double-click for automatic width)"
            aria-label="Resize files panel"
            @mousedown="startPanelResize"
            @dblclick="
              panelWidth = null;
              persistPanelWidth();
            "
          ></div>
          <div
            v-if="filesPanelOpen && (selectedCommit || worktreeSelected)"
            :style="{
              display: 'flex',
              flexDirection: 'column',
              flex: 'none',
              width: panelWidth != null ? panelWidth + 'px' : '380px',
              minWidth: '240px',
              minHeight: '0',
              overflow: 'hidden',
              borderLeft: '1px solid var(--vscode-panel-border)',
            }"
          >
            <div
              class="plegma-pane-header"
              role="button"
              tabindex="0"
              :aria-expanded="commitPanes.files"
              aria-label="Toggle Files section"
              @click="toggleCommitPane('files')"
              @keydown.enter.prevent="toggleCommitPane('files')"
              @keydown.space.prevent="toggleCommitPane('files')"
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
                style="flex: none"
              >
                <path :d="commitPanes.files ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT" />
              </svg>
              <span
                style="
                  font-weight: 600;
                  flex: 1 1 auto;
                  min-width: 0;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                "
                >Files<span v-if="selectedCommit"> — {{ selectedCommit.subject }}</span
                ><span v-else-if="worktreeSelected"> — Uncommitted changes</span></span
              >
              <span v-if="activeFiles.length > 0" style="opacity: 0.6; flex: none"
                >({{ activeFiles.length }})</span
              >
              <button
                class="plegma-icon-btn"
                style="font-size: 12px; padding: 1px 5px; flex: none"
                title="Close files panel (reopens when a commit is clicked)"
                aria-label="Close files panel"
                @click.stop="setFilesPanelOpen(false)"
              >
                ✕
              </button>
            </div>
            <div
              v-if="commitPanes.files"
              style="
                flex: none;
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                padding: 4px 12px;
              "
            >
              <span
                style="
                  flex: none;
                  display: inline-flex;
                  border: 1px solid var(--vscode-panel-border);
                  border-radius: 4px;
                  overflow: hidden;
                "
              >
                <button
                  class="plegma-seg"
                  :class="{ 'plegma-seg-active': filesViewMode === 'list' }"
                  title="Show files as a flat list"
                  aria-label="List view"
                  @click="setFilesViewMode('list')"
                >
                  List
                </button>
                <button
                  class="plegma-seg"
                  :class="{ 'plegma-seg-active': filesViewMode === 'tree' }"
                  title="Show files grouped by directory"
                  aria-label="Tree view"
                  @click="setFilesViewMode('tree')"
                >
                  Tree
                </button>
              </span>
            </div>
            <div
              v-if="commitPanes.files && diffError"
              style="
                flex: none;
                font-size: 12px;
                color: var(--vscode-errorForeground);
                padding: 0 12px 4px;
              "
            >
              Diff failed: {{ diffError }}
            </div>
            <div
              v-if="!selectedCommit && !worktreeSelected"
              style="flex: none; opacity: 0.6; font-size: 12px; padding: 0 12px 4px"
            >
              Select a commit to see its files.
            </div>
            <div
              v-else-if="!worktreeSelected && filesLoading"
              style="flex: none; opacity: 0.6; font-size: 12px; padding: 0 12px 4px"
            >
              Loading files…
            </div>
            <div
              v-else-if="!worktreeSelected && filesError"
              style="
                flex: none;
                font-size: 12px;
                color: var(--vscode-errorForeground);
                padding: 0 12px 4px;
              "
            >
              {{ filesError }}
            </div>
            <div
              v-else-if="activeFiles.length === 0"
              style="flex: none; opacity: 0.6; font-size: 12px; padding: 0 12px 4px"
            >
              {{ worktreeSelected ? "Working tree clean." : "No files changed in this commit." }}
            </div>
            <ul v-else-if="commitPanes.files" :style="filesListStyle">
              <template
                v-for="row in fileRows"
                :key="
                  row.kind === 'dir'
                    ? 'dir:' + row.dir
                    : (row.file.oldPath || '') + '→' + row.file.path
                "
              >
                <li
                  v-if="row.kind === 'dir'"
                  :title="collapsedDirs[row.dir] ? 'Expand directory' : 'Collapse directory'"
                  style="cursor: pointer; padding: 2px 0"
                  @click="collapsedDirs[row.dir] = !collapsedDirs[row.dir]"
                >
                  <span style="display: inline-flex; align-items: center; gap: 4px">
                    <svg
                      class="plegma-tree-icon"
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        :d="collapsedDirs[row.dir] ? ICON_CHEVRON_RIGHT : ICON_CHEVRON_DOWN"
                      /></svg
                    ><svg
                      class="plegma-tree-icon"
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      fill="currentColor"
                      aria-hidden="true"
                      style="opacity: 0.8"
                    >
                      <path :d="collapsedDirs[row.dir] ? ICON_FOLDER : ICON_FOLDER_OPEN" /></svg
                    ><span>{{ row.dir }}</span>
                  </span>
                  <span style="opacity: 0.6"> ({{ row.count }})</span>
                </li>
                <li
                  v-else
                  :title="
                    fileLabel(row.file, false) +
                    ' — Click to preview inline, double-click to open diff'
                  "
                  class="plegma-filerow"
                  :class="{
                    'plegma-filerow-selected': selectedFileKey === fileKey(row.file),
                  }"
                  style="cursor: pointer; padding: 2px 0"
                  :style="{
                    marginLeft: row.dir ? '16px' : '0',
                    background:
                      selectedFileKey === fileKey(row.file)
                        ? 'var(--vscode-list-inactiveSelectionBackground)'
                        : undefined,
                  }"
                  @click="selectFile(row.file)"
                  @dblclick="openDiff(selectedCommit, row.file)"
                  @contextmenu="openFileMenu($event, row.file)"
                >
                  <svg
                    class="plegma-tree-icon"
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="currentColor"
                    aria-hidden="true"
                    style="opacity: 0.8"
                  >
                    <path :d="ICON_FILE" />
                  </svg>
                  <span
                    class="plegma-file-label"
                    style="flex: 1 1 auto; min-width: 0; font-family: inherit"
                    >{{ fileLabel(row.file, filesViewMode === "tree") }}</span
                  >
                  <span class="plegma-rowactions">
                    <button
                      v-if="!worktreeSelected"
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="Open diff in editor"
                      aria-label="Open diff in editor"
                      @click.stop="openDiff(selectedCommit, row.file)"
                    >
                      ⧉
                    </button>
                    <button
                      v-if="!worktreeSelected && row.file.status !== 'Deleted'"
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="View file at this revision"
                      aria-label="View file at this revision"
                      @click.stop="openRevision(row.file)"
                    >
                      ⊙
                    </button>
                    <button
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="Open working-copy file"
                      aria-label="Open working-copy file"
                      @click.stop="openWorkingCopy(row.file)"
                    >
                      ↗
                    </button>
                    <button
                      v-if="!worktreeSelected && row.file.status !== 'Deleted'"
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="Compare with local version"
                      aria-label="Compare with local version"
                      @click.stop="compareWithLocal(selectedCommit, row.file)"
                    >
                      ⇄
                    </button>
                    <button
                      v-if="!worktreeSelected && row.file.status !== 'Deleted'"
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="Revert to this revision"
                      aria-label="Revert to this revision"
                      @click.stop="
                        revertTarget = {
                          sha: selectedCommit.hash,
                          path: row.file.path,
                          status: row.file.status,
                        }
                      "
                    >
                      ↩
                    </button>
                    <button
                      v-if="worktreeSelected"
                      class="plegma-icon-btn"
                      style="font-size: 12px; padding: 1px 5px"
                      title="Discard changes to this file (cannot be undone)"
                      aria-label="Discard changes to this file"
                      @click.stop="(e) => askDiscardFile(e, row.file)"
                    >
                      🗑
                    </button>
                  </span>
                  <span class="plegma-status" :style="{ color: statusColor(row.file.status) }">{{
                    statusLetter(row.file.status)
                  }}</span>
                </li>
              </template>
            </ul>
            <div
              v-if="showFilesSash"
              class="plegma-split-resizer"
              title="Drag to resize the file list"
              aria-label="Resize file list"
              @mousedown="startInlineResize"
            ></div>
            <template v-if="selectedFileKey">
              <div
                class="plegma-pane-header"
                role="button"
                tabindex="0"
                :aria-expanded="commitPanes.diff"
                aria-label="Toggle Diff section"
                style="border-top: 1px solid var(--vscode-panel-border)"
                @click="toggleCommitPane('diff')"
                @keydown.enter.prevent="toggleCommitPane('diff')"
                @keydown.space.prevent="toggleCommitPane('diff')"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                  style="flex: none"
                >
                  <path :d="commitPanes.diff ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT" />
                </svg>
                <span
                  style="
                    font-weight: 600;
                    flex: 1 1 auto;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-family: monospace;
                  "
                  >{{ selectedFileKey }}</span
                >
                <span v-if="inlineDiffTruncated" style="opacity: 0.6; flex: none">(truncated)</span>
                <button
                  class="plegma-icon-btn"
                  style="font-size: 12px; padding: 1px 5px; flex: none"
                  title="Close inline diff"
                  aria-label="Close inline diff"
                  @click.stop="
                    selectedFileKey = null;
                    inlineReq++;
                    clearInlineDiff();
                  "
                >
                  ✕
                </button>
              </div>
              <div v-if="commitPanes.diff" :style="diffBodyStyle">
                <div v-if="inlineDiffLoading" style="opacity: 0.6; font-size: 12px">
                  Loading diff…
                </div>
                <div
                  v-else-if="inlineDiffError"
                  style="font-size: 12px; color: var(--vscode-errorForeground)"
                >
                  {{ inlineDiffError }}
                </div>
                <div v-else-if="inlineDiffBinary" style="opacity: 0.6; font-size: 12px">
                  Binary file — no text diff to show.
                </div>
                <div v-else-if="inlineDiffTooLarge" style="opacity: 0.6; font-size: 12px">
                  File too large to preview inline. Open the diff in the editor.
                </div>
                <div v-else-if="inlineDiffText" style="font-family: monospace; font-size: 12px">
                  <div v-for="(line, i) in diffLines" :key="i" :style="diffLineStyle(line)">
                    <span style="white-space: pre-wrap; word-break: break-all">{{
                      line === "" ? " " : line
                    }}</span>
                  </div>
                </div>
                <div v-else style="opacity: 0.6; font-size: 12px">No differences to show.</div>
              </div>
            </template>
            <div
              v-if="showDiffSash"
              class="plegma-split-resizer"
              title="Drag to resize the diff preview"
              aria-label="Resize diff preview"
              @mousedown="startDiffResize"
            ></div>
            <div
              v-if="revertTarget"
              style="
                flex: none;
                margin: 8px 12px 0;
                padding: 8px;
                border: 1px solid var(--vscode-inputValidation-warningBorder, orange);
                font-size: 12px;
              "
            >
              <div style="margin-bottom: 6px">
                Revert <b style="font-family: monospace">{{ revertTarget.path }}</b> to
                {{ shortHash(revertTarget.sha) }}? Local changes will be lost.
              </div>
              <div style="display: flex; gap: 6px">
                <button :disabled="opBusy" @click="doRevertFile()">Revert</button>
                <button @click="revertTarget = null">Cancel</button>
              </div>
            </div>
            <div
              v-if="discardTarget"
              style="
                flex: none;
                margin: 8px 12px 0;
                padding: 8px;
                border: 1px solid var(--vscode-inputValidation-errorBorder, red);
                font-size: 12px;
              "
            >
              <div style="margin-bottom: 6px">
                <span v-if="discardTarget.paths && discardTarget.paths.length === 1">
                  Discard uncommitted changes to
                  <b style="font-family: monospace">{{ discardTarget.paths[0] }}</b
                  >?
                </span>
                <span v-else>
                  Discard
                  <b
                    >all {{ worktree.length }} uncommitted file{{
                      worktree.length === 1 ? "" : "s"
                    }}</b
                  >?
                </span>
                This permanently deletes the changes, including untracked files. This cannot be
                undone — stash first if you might want them back.
              </div>
              <div style="display: flex; gap: 6px">
                <button @click="discardTarget = null">Cancel</button>
                <button :disabled="opBusy" @click="doDiscardWorktree()">Discard</button>
              </div>
            </div>
            <template v-if="selectedCommit">
              <div
                class="plegma-pane-header"
                role="button"
                tabindex="0"
                :aria-expanded="commitPanes.details"
                aria-label="Toggle Details section"
                style="border-top: 1px solid var(--vscode-panel-border)"
                @click="toggleCommitPane('details')"
                @keydown.enter.prevent="toggleCommitPane('details')"
                @keydown.space.prevent="toggleCommitPane('details')"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                  style="flex: none"
                >
                  <path :d="commitPanes.details ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT" />
                </svg>
                <span style="font-weight: 600; flex: 1 1 auto; min-width: 0">Details</span>
              </div>
              <div
                v-if="commitPanes.details"
                :style="{
                  flex: '1',
                  minHeight: '0',
                  overflow: 'auto',
                  padding: '4px 12px 12px',
                }"
              >
                <div
                  style="
                    font-size: 12px;
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 2px 8px;
                  "
                >
                  <span style="opacity: 0.6">Hash</span>
                  <span style="font-family: monospace">{{ selectedCommit.hash }}</span>
                  <span style="opacity: 0.6">Author</span>
                  <span
                    >{{ selectedCommit.authorName }} &lt;{{ selectedCommit.authorEmail }}&gt;</span
                  >
                  <span style="opacity: 0.6">Date</span>
                  <span>{{ formatDateTime(selectedCommit.timestamp) }}</span>
                  <span style="opacity: 0.6">Branches</span>
                  <span>{{
                    (branchesByTarget.get(selectedCommit.hash) || [])
                      .map((b) => b.name)
                      .join(", ") || "—"
                  }}</span>
                  <span style="opacity: 0.6">Signature</span>
                  <span :style="{ color: signatureColor(selectedCommit.sigStatus) }">{{
                    signatureText(selectedCommit)
                  }}</span>
                </div>
                <div
                  v-if="selectedCommit.body && selectedCommit.body.trim()"
                  style="font-size: 12px; margin-top: 4px; white-space: pre-wrap; opacity: 0.9"
                >
                  <span v-html="rich(selectedCommit.body, { newlines: true })"></span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="hoverCard && hoverCardCommit"
      class="plegma-hover-card"
      role="tooltip"
      :style="{ left: hoverCard.x + 'px', top: hoverCard.y + 'px' }"
      @mouseenter="clearHoverTimer()"
      @mouseleave="cancelHover()"
    >
      <div class="plegma-hover-author">
        <span v-if="showAvatars" class="plegma-avatar plegma-avatar-lg">
          <img
            v-if="
              hoverCardCommit.avatar &&
              hoverCardCommit.avatar.url &&
              !avatarFailed.has(hoverCardCommit.hash)
            "
            class="plegma-avatar-img"
            :src="hoverCardCommit.avatar.url"
            alt=""
            @error="onAvatarError(hoverCardCommit)"
          />
          <span v-else class="plegma-avatar-initials">{{
            (hoverCardCommit.avatar && hoverCardCommit.avatar.initials) || "?"
          }}</span>
        </span>
        <span class="plegma-hover-author-name">{{ hoverCardCommit.authorName }}</span>
        <span v-if="hoverCardCommit.authorEmail" class="plegma-hover-author-email">
          &lt;{{ hoverCardCommit.authorEmail }}&gt;</span
        >
        <span class="plegma-hover-date">
          · {{ formatRelative(hoverCardCommit.timestamp) }} ({{
            formatHoverDate(hoverCardCommit.timestamp)
          }})</span
        >
      </div>
      <div class="plegma-hover-subject">{{ hoverCardCommit.subject }}</div>
      <div v-if="hoverCardCommit.body && hoverCardCommit.body.trim()" class="plegma-hover-body">
        <span v-html="rich(hoverCardCommit.body, { newlines: true })"></span>
      </div>
      <div v-if="hoverCardStats" class="plegma-hover-stats">
        <span
          >{{ hoverCardStats.files }} file{{ hoverCardStats.files === 1 ? "" : "s" }} changed</span
        >
        <span class="plegma-hover-add">+{{ hoverCardStats.additions }}</span>
        <span class="plegma-hover-del">-{{ hoverCardStats.deletions }}</span>
      </div>
      <div v-if="hoverCardRefs.length > 0" class="plegma-hover-refs">
        <span class="plegma-hover-label">Branches:</span>
        <div class="plegma-hover-chips">
          <RefBadge
            v-for="b in hoverCardRefs"
            :key="b.kind + b.name"
            :chip="b"
            :color="hoverCardColor"
            :aria-label="branchTitle(b)"
            @click="onRowClick($event, hoverCardCommit)"
            @dblclick.stop="onBranchChipDblClick(b)"
            @contextmenu.prevent.stop="(e) => onRowContext(e, hoverCardCommit, b)"
          />
        </div>
      </div>
      <div v-if="hoverCardTags.length > 0" class="plegma-hover-refs">
        <span class="plegma-hover-label">Tags:</span>
        <div class="plegma-hover-chips">
          <RefBadge
            v-for="t in hoverCardTags"
            :key="'t' + t"
            :chip="{ type: 'tag', name: t }"
            :color="hoverCardColor"
            :aria-label="`Tag ${t}`"
            @click.stop="copyTagName(t)"
            @contextmenu.prevent.stop="(e) => onTagContext(e, t)"
          />
        </div>
      </div>
      <hr class="plegma-hover-div" />
      <div class="plegma-hover-hashrow">
        <span class="plegma-hover-hash">{{ hoverCardCommit.hash }}</span>
        <button
          class="plegma-icon-btn plegma-hover-copy"
          aria-label="Copy commit hash"
          @click.stop="copyHoverHash(hoverCardCommit.hash)"
        >
          Copy
        </button>
      </div>
      <div
        v-if="hoverCardCommit.parents && hoverCardCommit.parents.length > 0"
        class="plegma-hover-parents"
      >
        {{ hoverCardCommit.parents.length }} parent{{
          hoverCardCommit.parents.length === 1 ? "" : "s"
        }}: {{ hoverCardCommit.parents.join(", ") }}
      </div>
    </div>

    <!--
      One menu for a commit. Opened on the row it carries the commit's
      actions; opened on a ref chip it also carries that branch's. Every
      item either can be done: the repeated ones (checkout, rebase, compare)
      nest, and the ones git would refuse are not rendered at all.
    -->
    <div
      v-if="menu && menuCommit"
      class="plegma-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
      @scroll="closeSubmenu"
    >
      <div v-if="menuChip" class="plegma-menu-header plegma-menu-chipheader">
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
          class="plegma-menu-chipicon"
        >
          <path
            :d="
              menuChip.kind === 'local' ? (menuChip.isHead ? ICON_TARGET : ICON_BRANCH) : ICON_CLOUD
            "
          />
        </svg>
        {{ menuChip.name }}
        <span v-if="menuChip.paired" class="plegma-menu-chipremote">{{
          menuChip.remote.name
        }}</span>
      </div>
      <div class="plegma-menu-header">
        <template v-if="menuMulti">{{ menuMulti.length }} commits selected</template>
        <template v-else>{{ shortHash(menu.hash) }} {{ menuCommit.subject.slice(0, 40) }}</template>
      </div>
      <div v-if="menuChipWorktree" class="plegma-menu-worktree">📁 {{ menuChipWorktree }}</div>

      <template v-if="menuMulti">
        <!--
          A selection of two or more commits: only the actions that work on
          all of them. Single-commit actions (revert, reset, checkout, …)
          would silently apply to one commit of the set, so they are absent.
        -->
        <div class="plegma-menu-item" @click="doRewrite('squash', menuMulti, '')">
          Squash into oldest
        </div>
        <div class="plegma-menu-item" @click="doRewrite('drop', menuMulti, '')">
          Drop
        </div>
        <div class="plegma-menu-sep"></div>
        <div class="plegma-menu-item" @click="copyHashes(menuMulti)">
          Copy hashes
        </div>
        <div class="plegma-menu-item" @click="copyMessages(menuMulti)">
          Copy messages
        </div>
      </template>

      <template v-else>
        <!--
          Update leads the menu: pulling is the most likely next step for a
          branch that tracks a live remote ref. Rendered only then — a
          pruned ("gone") upstream has nothing to pull, so the action is
          absent rather than failing. On a branch other than the checked-out
          one it fast-forwards in place (fetch) instead of switching
          branches around it; the separate fetch item covers only what
          Update cannot.
        -->
        <template v-if="menuChipUpdateOffered">
          <div
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="doUpdateBranch(menuChip.name)"
          >
            <template v-if="menuChipIsHead">Pull from {{ menuChipUpstream }}</template>
            <template v-else>Fetch from {{ menuChipUpstream }}</template>
          </div>
          <div class="plegma-menu-sep"></div>
        </template>
        <div class="plegma-menu-item" @mouseenter="onPlainItem" @click="openChangesFromMenu()">
          Open changes
        </div>
        <div
          v-if="!menuAtHead"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="checkoutDetachedFromMenu()"
        >
          Checkout (detached)
        </div>
        <div
          v-if="menuCheckoutTargets.length > 0"
          class="plegma-menu-item plegma-menu-sub"
          @mouseenter="openSubmenu($event, 'checkout')"
          @click.stop="toggleSubmenu($event, 'checkout')"
        >
          Checkout <span class="plegma-menu-arrow">▸</span>
        </div>
        <div class="plegma-menu-sep"></div>
        <div
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="
            checked = toggleCheck(checked, menu.hash);
            anchor = menu.hash;
            menu = null;
          "
        >
          {{ checked.includes(menu.hash) ? "Unselect" : "Select" }}
        </div>
        <div
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="
            rewordPos = clampXY(menu.x, menu.y, 320, 170);
            rewordFor = menu.hash;
            rewordText = '';
            menu = null;
          "
        >
          Reword message…
        </div>
        <div
          v-if="menuTargets.length >= 2"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="doRewrite('squash', menuTargets, '')"
        >
          Squash {{ menuTargets.length }} selected
        </div>
        <div
          v-if="menuTargets.length > 0"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="doRewrite('drop', menuTargets, '')"
        >
          Drop {{ menuTargets.length > 1 ? `${menuTargets.length} selected` : "this commit" }}
        </div>
        <div
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="
            doCreateBranch(
              menu.hash,
              menuChip && menuChip.kind !== 'local' ? menuChip.name : shortHash(menu.hash),
              menuChip && menuChip.kind !== 'local' && menuChipRemote ? menuChipRemote.short : '',
            )
          "
        >
          Create branch…
        </div>
        <div
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="doCreateTag(menu.hash, shortHash(menu.hash))"
        >
          Create tag…
        </div>
        <div
          class="plegma-menu-item plegma-menu-sub"
          @mouseenter="openSubmenu($event, 'compare')"
          @click.stop="toggleSubmenu($event, 'compare')"
        >
          Compare with <span class="plegma-menu-arrow">▸</span>
        </div>

        <!--
          Everything that changes the checked-out branch, under one header
          that names it, so the items themselves need not repeat it.
        -->
        <div class="plegma-menu-sep"></div>
        <div class="plegma-menu-header plegma-menu-section">
          {{ headBranch ? `On branch ${headBranch.name}` : "HEAD detached" }}
        </div>
        <div class="plegma-menu-item" @mouseenter="onPlainItem" @click="revertFromMenu()">
          Revert this commit
        </div>
        <div
          v-if="!menuAtHead"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="cherryPickFromMenu()"
        >
          Cherry-pick this commit
        </div>
        <!-- On a branch chip the branch merge below is the same commit with a
             better merge message, so the commit merge would only duplicate it. -->
        <div
          v-if="!menuAtHead && !(menuChip && headBranch)"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="mergeCommitFromMenu()"
        >
          Merge this commit…
        </div>
        <div
          v-if="menuChip && menuChip.kind === 'local' && headBranch && !menuChipIsHead"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="mergeFromBranchMenu()"
        >
          Merge branch
        </div>
        <div
          v-if="menuChipRemote && headBranch && !menuChipIsHead"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="doPullRemoteBranch()"
        >
          Pull {{ menuChipRemoteName }}
        </div>
        <div
          v-if="menuRebaseTargets.length > 0 || !menuAtHead"
          class="plegma-menu-item plegma-menu-sub"
          @mouseenter="openSubmenu($event, 'rebase')"
          @click.stop="toggleSubmenu($event, 'rebase')"
        >
          Rebase onto <span class="plegma-menu-arrow">▸</span>
        </div>
        <div
          v-if="!menuAtHead"
          class="plegma-menu-item"
          @mouseenter="onPlainItem"
          @click="doResetAsk()"
        >
          Reset to this commit…
        </div>

        <template v-if="menuChip">
          <div class="plegma-menu-sep"></div>
          <!--
            The branch's own actions; the chip header names the branch.
            What the commit's own items already cover — checking the branch
            out, rebasing onto it, branching from it — is not repeated.
            Update lives at the top of the menu instead of here.
          -->
          <div
            v-if="menuChip.kind === 'local'"
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="pushFromBranchMenu(false)"
          >
            <template v-if="menuChipUpstream">Push to {{ menuChipUpstream }}</template>
            <template v-else>Push…</template>
          </div>
          <div
            v-if="menuChip.kind === 'local' && menuChipUpstream"
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="pushFromBranchMenu(true)"
          >
            Force push…
          </div>
          <div
            v-if="menuChip.kind === 'local'"
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="doRenameBranch(menuChip.name)"
          >
            Rename branch…
          </div>
          <div
            v-else
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="checkoutTrackingFromBranchMenu()"
          >
            Checkout as {{ menuChipLocalName }}
          </div>
          <div
            v-if="menuChip.kind === 'local' && !menuChipIsHead"
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="doDeleteBranch(menuChip.name)"
          >
            Delete branch<template v-if="menuChipWorktree"> and worktree</template>
          </div>
          <template v-if="menuChipRemote">
            <!-- Kept only where Update cannot go (a local branch with no
                 live upstream, or a remote-only chip): there it is the
                 only in-place fast-forward. -->
            <div
              v-if="menuChipFetchAllowed && !menuChipUpdateOffered"
              class="plegma-menu-item"
              @mouseenter="onPlainItem"
              @click="doFetchRemoteBranch()"
            >
              Fetch from {{ menuChipRemoteName }}
            </div>
            <div
              class="plegma-menu-item"
              @mouseenter="onPlainItem"
              @click="askDeleteRemoteFromBranchMenu()"
            >
              Delete from {{ menuChipRemote.remote }}
            </div>
          </template>
          <div
            class="plegma-menu-item"
            @mouseenter="onPlainItem"
            @click="copyBranchName(menuChip.name)"
          >
            Copy branch name
          </div>
        </template>

        <div class="plegma-menu-sep"></div>
        <div class="plegma-menu-item" @mouseenter="onPlainItem" @click="copyHash(menu.hash)">
          Copy commit hash
        </div>
        <div class="plegma-menu-item" @mouseenter="onPlainItem" @click="copyCommitMessage()">
          Copy commit message
        </div>
      </template>
    </div>

    <!--
      Nested lists: the refs this commit can be checked out from, the refs
      the current branch can be rebased onto, and the other sides of a
      comparison. Opened by hovering or clicking their parent item.
    -->
    <div
      v-if="menu && submenu"
      class="plegma-menu plegma-menu-submenu"
      :style="{ left: submenu.x + 'px', top: submenu.y + 'px' }"
      @click.stop
      @mouseenter="clearHoverTimer()"
      @mouseleave="closeSubmenu()"
    >
      <template v-if="submenu.key === 'checkout'">
        <div
          v-for="t in menuCheckoutTargets"
          :key="t.kind + t.name"
          class="plegma-menu-item"
          @click="doCheckout(t.name)"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="currentColor"
            aria-hidden="true"
            class="plegma-menu-chipicon"
          >
            <path :d="t.kind === 'tag' ? ICON_TAG : ICON_BRANCH" />
          </svg>
          {{ t.name }}
        </div>
      </template>
      <template v-else-if="submenu.key === 'rebase'">
        <div
          v-for="b in menuRebaseTargets"
          :key="'rebase-' + b.name"
          class="plegma-menu-item"
          @click="doRebaseOnto(b.name)"
        >
          {{ b.name }}
        </div>
        <div v-if="!menuAtHead" class="plegma-menu-item" @click="doRebaseOnto(menu.hash)">
          This commit
        </div>
      </template>
      <template v-else-if="submenu.key === 'compare'">
        <div v-if="menuCompareRemote" class="plegma-menu-item" @click="compareWithRemoteFromMenu()">
          {{ menuCompareRemote.name }}
        </div>
        <div
          v-if="menuCompareRemote"
          class="plegma-menu-item"
          @click="compareWithMergeBaseFromMenu()"
        >
          Merge base with {{ menuCompareRemote.name }}
        </div>
        <div class="plegma-menu-item" @click="compareRefFromMenu()">Another ref…</div>
        <div class="plegma-menu-item" @click="compareWorktreeFromMenu()">
          Working tree
        </div>
      </template>
    </div>

    <div
      v-if="tagMenu"
      class="plegma-menu"
      :style="{ left: tagMenu.x + 'px', top: tagMenu.y + 'px' }"
      @click.stop
    >
      <div class="plegma-menu-header">
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
          style="vertical-align: -2px; margin-right: 4px"
        >
          <path :d="ICON_TAG" /></svg
        >{{ tagMenu.name }}
        <span v-if="tagMenuTag && !tagMenuTag.annotated" class="plegma-tag-kind">
          lightweight
        </span>
      </div>
      <div
        v-if="tagMenuTag && tagMenuTag.annotated"
        class="plegma-tag-annotation"
        :title="
          (tagMenuTag.taggerName || 'unknown') +
          (tagMenuTag.taggerEmail ? ' <' + tagMenuTag.taggerEmail + '>' : '') +
          (tagMenuTag.timestamp ? ' · ' + formatHoverDate(tagMenuTag.timestamp) : '')
        "
      >
        <span>{{ tagMenuTag.taggerName || "unknown" }}</span>
        <span v-if="tagMenuTag.taggerEmail" class="plegma-hover-author-email"
          >&lt;{{ tagMenuTag.taggerEmail }}&gt;</span
        >
        <span v-if="tagMenuTag.timestamp" class="plegma-hover-date"
          >· {{ formatHoverDate(tagMenuTag.timestamp) }}</span
        >
      </div>
      <div
        v-if="tagMenuTag && tagMenuTag.message"
        class="plegma-tag-message"
        :title="tagMenuTag.message"
      >
        <span v-html="rich(tagMenuTag.message, { newlines: true })"></span>
      </div>
      <div class="plegma-menu-item" @click="checkoutTagFromMenu()">
        Checkout (detached)
      </div>
      <div class="plegma-menu-item" @click="pushTagFromMenu()">Push…</div>
      <div
        class="plegma-menu-item"
        @click="
          copyTagName(tagMenu.name);
          tagMenu = null;
        "
      >
        Copy name
      </div>
      <div
        class="plegma-menu-item"
        @click="
          deleteTagTarget = { name: tagMenu.name, ...clampXY(tagMenu.x, tagMenu.y, 340, 150) };
          tagMenu = null;
        "
      >
        Delete…
      </div>
    </div>

    <div
      v-if="fileMenu"
      class="plegma-menu"
      :style="{ left: fileMenu.x + 'px', top: fileMenu.y + 'px' }"
      @click.stop
    >
      <div class="plegma-menu-header">
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          aria-hidden="true"
          style="vertical-align: -2px; margin-right: 4px"
        >
          <path :d="ICON_FILE" /></svg
        >{{ fileMenu.path }}
      </div>
      <div class="plegma-menu-item" @click="copyFilePath(false)">Copy relative path</div>
      <div class="plegma-menu-item" @click="copyFilePath(true)">Copy absolute path</div>
    </div>

    <div
      v-if="fetchDialog"
      style="
        position: fixed;
        z-index: 101;
        width: 300px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: fetchDialog.x + 'px', top: fetchDialog.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px; font-weight: 600">Fetch from remote</div>
      <label
        style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px; cursor: pointer"
      >
        <input v-model="fetchOptions.prune" type="checkbox" /> Prune deleted branches
      </label>
      <label
        style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; cursor: pointer"
      >
        <input v-model="fetchOptions.pruneTags" type="checkbox" /> Prune tags
      </label>
      <label
        style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px; cursor: pointer"
        title="Fetch straight through next time, using these options"
      >
        <input v-model="fetchRememberChoice" type="checkbox" /> Don't ask again
      </label>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="fetchDialog = null">Cancel</button>
        <button :disabled="opBusy" @click="runFetchFromDialog()">Fetch</button>
      </div>
    </div>

    <div
      v-if="resetTarget"
      style="
        position: fixed;
        z-index: 101;
        width: 320px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: resetTarget.x + 'px', top: resetTarget.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">
        Reset {{ headBranch ? headBranch.name : "current branch" }} to
        {{ shortHash(resetTarget.sha) }} ({{ resetTarget.mode }})?
        <span v-if="resetTarget.mode === 'hard'">This discards all uncommitted changes.</span>
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <div style="display: flex; gap: 10px; margin: 6px 0 8px">
          <label
            v-for="m in RESET_MODES"
            :key="'reset-' + m"
            style="display: flex; gap: 4px; align-items: center; cursor: pointer"
          >
            <input v-model="resetTarget.mode" type="radio" :value="m" />
            {{ m[0].toUpperCase() + m.slice(1) }}
          </label>
        </div>
        <button @click="resetTarget = null">Cancel</button>
        <button :disabled="opBusy" @click="doResetTo()">Reset</button>
      </div>
    </div>

    <div
      v-if="deleteTarget"
      style="
        position: fixed;
        z-index: 101;
        width: 320px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: deleteTarget.x + 'px', top: deleteTarget.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">
        Branch <b style="font-family: monospace">{{ deleteTarget.name }}</b> is not fully merged
        (typical after a squash-merge). Force-delete it? Unmerged commits will be lost.
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="deleteTarget = null">Cancel</button>
        <button :disabled="opBusy" @click="doForceDeleteBranch()">Force delete</button>
      </div>
    </div>

    <div
      v-if="deleteTagTarget"
      style="
        position: fixed;
        z-index: 101;
        width: 320px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: deleteTagTarget.x + 'px', top: deleteTagTarget.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">
        Delete tag <b style="font-family: monospace">{{ deleteTagTarget.name }}</b
        >? The tag will be removed locally.
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="deleteTagTarget = null">Cancel</button>
        <button :disabled="opBusy" @click="doDeleteTag()">Delete</button>
      </div>
    </div>

    <div
      v-if="deleteRemoteTarget"
      style="
        position: fixed;
        z-index: 101;
        width: 320px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: deleteRemoteTarget.x + 'px', top: deleteRemoteTarget.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">
        Delete remote branch <b style="font-family: monospace">{{ deleteRemoteTarget.name }}</b
        >? This removes it from the remote for everyone using it.
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="deleteRemoteTarget = null">Cancel</button>
        <button :disabled="opBusy" @click="doDeleteRemoteBranch()">Delete</button>
      </div>
    </div>

    <div
      v-if="pushForceTarget"
      style="
        position: fixed;
        z-index: 101;
        width: 320px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: pushForceTarget.x + 'px', top: pushForceTarget.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">
        Force-push <b style="font-family: monospace">{{ pushForceTarget.name }}</b> to
        {{ pushForceTarget.remote }}? Commits on the remote that are not in local history will be
        lost. A backup ref is created first.
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="pushForceTarget = null">Cancel</button>
        <button :disabled="opBusy" @click="doForcePush()">Force push</button>
      </div>
    </div>

    <div
      v-if="rewordFor"
      style="
        position: fixed;
        z-index: 101;
        width: 300px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        padding: 10px;
        font-size: 12px;
      "
      :style="{ left: rewordPos.x + 'px', top: rewordPos.y + 'px' }"
      @click.stop
    >
      <div style="margin-bottom: 6px">New message for {{ shortHash(rewordFor) }}:</div>
      <input
        v-model="rewordText"
        autofocus
        style="width: 100%; box-sizing: border-box; margin-bottom: 8px"
        class="plegma-input"
        @keydown.enter="doRewrite('reword', [rewordFor], rewordText)"
        @keydown.esc="rewordFor = null"
      />
      <div style="display: flex; gap: 6px; justify-content: flex-end">
        <button @click="rewordFor = null">Cancel</button>
        <button
          :disabled="!rewordText.trim() || opBusy"
          @click="doRewrite('reword', [rewordFor], rewordText)"
        >
          Rewrite
        </button>
      </div>
    </div>
  </div>
</template>

.plegma-link:hover { text-decoration: underline; }
