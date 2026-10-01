const { GitWindowPanel } = require("./GitWindowPanel");
const { createRootStore, handleGitRequest } = require("./git/index");
const { handlePromptRequest } = require("./git/prompt");
const { openFileDiff, openLocalDiff, openFileAtRevision, openWorkingFile } = require("./git/diff");
const { openCommit, openCompare, openCompareWorktree } = require("./git/compare");

function activate(context, vscodeApi) {
  // Injected for testability: VS Code calls activate(context), tests pass a
  // fake. The require below only evaluates when no API was injected, so any
  // runner can load this module.
  const vscode = vscodeApi || require("vscode");
  // One spelling of the name everywhere the user reads it: the status bar
  // item, the editor tab, the output channel, the command palette.
  const output = vscode.window.createOutputChannel("Plegma");
  output.appendLine("Plegma activated.");

  let storePromise = null;
  function getStore() {
    if (!storePromise) {
      storePromise = createRootStore(vscode, output);
    }
    return storePromise;
  }

  async function gitHandler(msg) {
    const started = Date.now();
    const response = await gitHandlerInner(msg);
    const ms = Date.now() - started;
    if (ms > 5000) {
      try {
        output.appendLine(`[git-request] ${(msg && msg.method) || "?"} took ${ms}ms`);
      } catch {
        // Logging must never break responses.
      }
    }
    return response;
  }

  async function gitHandlerInner(msg) {
    const started = Date.now();
    try {
      // Native input prompts bypass the git store (no repo needed).
      const promptRes = await handlePromptRequest(vscode, msg);
      if (promptRes) {
        return promptRes;
      }
      // Revealing VS Code's own SCM view needs no repository either.
      if (msg && msg.type === "git/request" && msg.method === "revealScm") {
        await vscode.commands.executeCommand("workbench.view.scm");
        return { type: "git/response", id: msg.id, ok: true, data: { ok: true } };
      }
      const store = await getStore();
      if (msg && msg.type === "git/request" && msg.method === "roots") {
        return {
          type: "git/response",
          id: msg.id,
          ok: true,
          data: { roots: store.roots, activeRoot: store.getActiveRoot() },
        };
      }
      if (msg && msg.type === "git/request" && msg.method === "useRoot") {
        const data = store.useRoot(msg.args && msg.args.root);
        return { type: "git/response", id: msg.id, ok: true, data };
      }
      const service = store.getService();
      if (msg && msg.type === "git/request" && msg.method === "openDiff") {
        const result = await openFileDiff(vscode, service.repoRoot, msg.args || {});
        if (result && result.binary) {
          vscode.window.showInformationMessage("Plegma: binary file — no text diff to show.");
        }
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openLocalDiff") {
        const result = await openLocalDiff(vscode, service.repoRoot, msg.args || {});
        if (result && result.binary) {
          vscode.window.showInformationMessage("Plegma: binary file — no text diff to show.");
        }
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openCommit") {
        const result = await openCommit(vscode, service.repoRoot, (msg.args || {}).sha);
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openFileAtRevision") {
        const result = await openFileAtRevision(vscode, service.repoRoot, msg.args || {});
        if (result && result.binary) {
          vscode.window.showInformationMessage("Plegma: binary file — no text to show.");
        }
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openWorkingFile") {
        const result = await openWorkingFile(vscode, service.repoRoot, msg.args || {});
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openCompare") {
        const result = await openCompare(vscode, service, msg.args || {});
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      if (msg && msg.type === "git/request" && msg.method === "openCompareWorktree") {
        const result = await openCompareWorktree(vscode, service, msg.args || {});
        return { type: "git/response", id: msg.id, ok: true, data: result };
      }
      return await handleGitRequest(service, msg);
    } catch (err) {
      const ms = Date.now() - started;
      try {
        output.appendLine(
          `[git-request] ${(msg && msg.method) || "?"} failed after ${ms}ms: ${(err && err.message) || String(err)}`,
        );
      } catch {
        // Logging must never break responses.
      }
      if (msg && msg.type === "git/request") {
        return {
          type: "git/response",
          id: msg.id,
          ok: false,
          error: (err && err.message) || String(err),
        };
      }
      return null;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("plegma.openGitWindow", async () => {
      GitWindowPanel.createOrShow(vscode, context.extensionUri, gitHandler);
      output.appendLine("Plegma window opened in the editor.");
    }),
  );

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  // $(plegma-mark), not $(plegma): contributed icon ids must be at least two
  // hyphen-separated segments (`component-iconname`) or VS Code rejects them
  // with nothing more than a renderer-log line, leaving an empty gap here.
  statusItem.text = "$(plegma-mark) Plegma";
  statusItem.tooltip = "Open Plegma history window";
  statusItem.command = "plegma.openGitWindow";
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("plegma.probeGitService", async () => {
      try {
        const store = await getStore();
        const service = store.getService();
        const probe = await service.probe();
        output.appendLine(`[probe] ${JSON.stringify(probe)}`);
        output.show();
        if (!service.repoRoot) {
          vscode.window.showWarningMessage("Plegma: no git repository found in workspace.");
          return;
        }
        const [commits, branches, tags] = await Promise.all([
          service.listCommits(5),
          service.listBranches(),
          service.listTags(),
        ]);
        output.appendLine(
          `[probe] commits=${commits.length} branches=${branches.length} tags=${tags.length} root=${service.repoRoot}`,
        );
        output.show();
      } catch (err) {
        const msg = (err && err.message) || String(err);
        output.appendLine(`[probe] failed: ${msg}`);
        output.show();
        vscode.window.showErrorMessage(`Plegma probe failed: ${msg}`);
      }
    }),
  );

  context.subscriptions.push(output);
}

function deactivate() {}

module.exports = { activate, deactivate };
