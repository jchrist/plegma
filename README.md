# Plegma

Git history window for VS Code. Extension host in plain JavaScript, webview UI in Vue 3.

## What works

- Status bar item opening the window as a central editor tab (`Plegma: Open Window`); the tab shows the same file as the Extensions page, the status bar the same pi as a glyph.
- Multi-root workspaces show a repository picker in the toolbar; every pane follows the selected repo.
- Command `Plegma: Probe Git Service` logs extension API availability plus live commit/branch/tag counts to the `Plegma` output channel.
- Git Log webview shows live commit graph with lane colors, per-commit branch and tag labels, commit text filter, and a filterable branches/tags sidebar (local/remote/tags toggles + search).
- Selecting a commit lists its changed files below the graph; double-clicking a file opens a standard diff (old revision vs new, temp files under the OS temp dir). Commits that vanished from history report a friendly message instead of a raw git error.
- Icon toolbar: repository picker (multi-root only), commit order, branch filter, column toggles, find, refresh, and fetch with an options popover (prune branches / prune tags, remembered). `Ctrl+H` jumps to HEAD, `Ctrl+R` refreshes. Click / Ctrl-click / Shift-click selection, right-click menu per commit (reword, squash, drop, checkout branch, rebase current branch onto a branch or a commit, merge a commit into the current branch, copy hash). Auto-refresh when history changes outside the window.
- Push lives in the context menus only (never the toolbar): `Push <branch>` runs straight through, setting the upstream when the branch has none, and `Force Push…` confirms first after creating a `refs/plegma-backup/` ref and using `--force-with-lease`. `Push Tag…` lives in the tag menu.
- Hovering a commit opens the native-style popup: author, date, full message, how many files it changed with green `+additions` and red `-deletions`, its refs as separate chips (`main` and `origin/main`, each with its full name, nothing clipped), the full hash and its parents. It states facts and stops there — no instructions, no explanations. Clicking anywhere on a row — the graph, the chips, the subject — selects the commit and fills the side panels.
- Context menus open on right-click only, and a commit has exactly one of them: the commit's actions (open changes, reword, squash, drop, revert, reset, merge, cherry-pick, copy) with `Checkout`, `Rebase onto` and `Compare with` nested like the native graph's, and nothing offered that git would refuse. Right-clicking a branch chip adds that branch's own actions. Labels use git's own verbs, and the menu's headers name the branch, the commit and the checked-out branch once, so the items do not repeat them. Right-clicking inside a selection of several commits offers only what works on all of them. Double-clicking a local branch chip checks it out.
- Tick commits to Squash (any order, grouped at the earliest), Reword (single, optional new message), or Drop; Rebase-onto input plus Continue/Skip/Abort banner when a rebase hits conflicts.
- Every rewrite creates a `refs/plegma-backup/` ref first and requires a clean tree. Stash and backup commits are hidden from the graph (they are not branch history and cannot be rewritten).
- Stashes render as rows in the graph with Apply / Pop / Drop / Create-branch.
- Branch filtering runs inside git: pick refs, only the checked-out branch, or a glob pattern; ordering can be topological, date, or author date.
- Commit messages render as rich text (links, bold/italic/code, gitmoji) with author avatars, GPG signature state in Details, and per-file actions: copy relative/absolute path, view at revision, open working copy.
- Git service (`src/git/`): all reads go through the `git` CLI. The built-in `vscode.git` API is used only where a native editor flow needs it (multi-file diff editors). Pure parsers in `src/git/parsers.js`, lane layout in `src/webview/graph.js`.

## Develop

```sh
npm install
npm run compile   # esbuild (extension host) + Vite (Vue webview)
npm test          # unit + headless end-to-end (fixture repo, faked vscode API)
xvfb-run -a npm run test:e2e   # official suite in a real editor (needs display or xvfb)
```

Press F5 in VS Code to launch Extension Development Host, then run `Plegma: Open Window` or `Plegma: Probe Git Service`.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

`AGENTS.md` covers the architecture, the conventions that matter, and the test
layout. Read it before changing anything.
