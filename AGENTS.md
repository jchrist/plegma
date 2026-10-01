# AGENTS.md — working on Plegma

Notes for coding agents (and people) changing this repository. Anything
personal — hosts, aliases, private paths, individual workflow — belongs in
`AGENTS.local.md`, which is gitignored and never committed. If that file
exists, it wins over anything here.

## What this project is

A VS Code extension that renders a git history window: a swimlane commit
graph, ref chips, per-commit files and diffs, and the history-rewriting verbs
(squash, reword, drop, rebase, merge, cherry-pick, reset, revert).

- Extension host: plain JavaScript, no build step beyond esbuild.
- Webview: Vue 3 single-file component.
- Git access: `git` CLI over `child_process`. The built-in `vscode.git` API is
  only used where a native editor flow needs it (multi-file diff editors); all
  reads go CLI because that API is unversioned and has returned truncated data.

## Commands

```sh
npm install
npm run compile    # esbuild (host) + Vite (Vue webview) into out/
npm test           # unit + headless end-to-end suites
npm run test:e2e   # mocha inside a real editor host (needs a display or xvfb)
npm run package    # vsce package --no-dependencies
```

`npm test` is the gate. It runs the fixture-repo suites with a faked `vscode`
API, so it needs no display and no network.

`scripts/` and `.vite-hooks/` are gitignored local tooling, not part of the
project. If a script you rely on is missing, ask before adding a committed
replacement.

## Layout

| Path | Role |
| --- | --- |
| `src/extension.js` | Activation: commands, status bar, `gitHandler` dispatch. The `vscode` module is injected so any runner can load the file. |
| `src/git/cliGit.js` | Every git verb. Argument construction and failure modes live here. |
| `src/git/rewrite.js` | History-rewriting verbs (rebase, reset, cherry-pick, …). |
| `src/git/parsers.js` | Pure parsers for `git log` records. No I/O — keep it that way. |
| `src/git/compare.js` | Native multi-file diff editors via `vscode.git`. |
| `src/webview/App.vue` | All webview UI and state. |
| `src/webview/graph.js` | Swimlane layout maths. Pure functions. |
| `src/webview/settings.js` | localStorage-backed settings with typed accessors. |
| `esbuild.mjs` | Extension-host bundle (Node, CommonJS, `vscode` external). |

## Conventions that matter

- **Backups before rewrites.** Every history rewrite writes a
  `refs/plegma-backup/<branch>-<timestamp>` ref first and requires a clean
  tree. Do not add a rewrite path that skips this.
- **Destructive verbs confirm first.** The message names both ends of what it
  does (`Fetch origin/x into x`, `Delete x from origin`).
- **Offer only what git would accept.** Menus check the current repo state and
  disable rather than offering an action that fails.
- **Stash and backup refs stay out of the graph.** `--exclude=refs/stash` and
  `--exclude=refs/plegma-backup/*` must stay in `cliGit.js`; those refs are not
  branch history and every rewrite validates against HEAD.
- **Reads are CLI, always.** The `vscode.git` API is only for native editor
  surfaces. Multi-root and detached HEAD have bitten this before.
- **No sourcemaps in the shipped webview.** The bundle's trailing
  `sourceMappingURL` triggers a CSP violation on every open.
- **Settings live in webview `localStorage`**, one key per setting, not in VS
  Code configuration — per-machine UI choices do not belong in synced settings.
- **Comments explain why, not what.** Several record a specific past bug; keep
  that history when editing around them.

## Tests

- `test/` — vitest suites. Fixture repos are built with real git in
  `os.tmpdir()`; nothing touches the network.
- `test/vscode/` — mocha inside the real editor host (`npm run test:e2e`).
  Needs a display: `xvfb-run -a npm run test:e2e` works on headless machines.
- `e2e/` — Playwright driving a real editor for UI-level checks.
- A new behaviour needs a test that fails without it. A test that cannot fail
  is worse than no test.

## Release and version bumps

Keep these as separate, explicit requests:

- **release** / **repackage** — delete old `*.vsix`, then `npm run package`,
  leaving exactly one vsix. Do not commit or push.
- **bump** — `package.json` to the next patch version only. Do not bump twice
  for one request; if the tree is already at an unbumped version, that is the
  bump. Do not package, commit, or push.

Neither action touches git history unless asked separately.