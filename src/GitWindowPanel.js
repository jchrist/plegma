// Editor-area plegma window (central area). One singleton panel, revealed on command.
// gitHandler: async (msg) => response|null — dispatches git/request messages.
// vscode is injected (constructor / createOrShow args) so tests can pass a
// fake and any runner can load this module.
const { getWebviewHtml } = require("./getWebviewHtml");

// The editor tab shows the exact same file as the Extensions page
// (package.json "icon"): the full-color pi, two lanes under one bowed lane
// with a commit node disc on each lane. The bottom-left status bar item shows
// the same pi as a single-color codicon (`$(plegma-mark)`, drawn from
// resources/plegma.ttf) — StatusBarItem.text only supports codicons, so a
// custom image is not possible there.
//
// WebviewPanel has no icon arg, the tab icon comes from panel.iconPath.
// The mark is full-color on a transparent tile, so one file serves light,
// dark and high-contrast tabs with no theme swap.
const ICON = "icon.png";

class GitWindowPanel {
  static currentPanel = undefined;

  constructor(panel, extensionUri, gitHandler, vscode) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.gitHandler = gitHandler;
    this.vscode = vscode;
    this.disposables = [];
    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      "editor",
      this.vscode,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  static createOrShow(vscode, extensionUri, gitHandler) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (GitWindowPanel.currentPanel) {
      if (gitHandler) {
        GitWindowPanel.currentPanel.gitHandler = gitHandler;
      }
      GitWindowPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "plegma.gitWindow",
      // "Plegma", like the status bar item and the command titles: the tab
      // used to read "plegma" and the bar "Plegma".
      "Plegma",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", ICON);

    GitWindowPanel.currentPanel = new GitWindowPanel(panel, extensionUri, gitHandler, vscode);
  }

  async handleMessage(msg) {
    if (!msg) {
      return;
    }
    if (msg.type === "ping") {
      void this.panel.webview.postMessage({ type: "pong", payload: msg.payload });
      return;
    }
    if (msg.type === "git/request" && this.gitHandler) {
      const response = await this.gitHandler(msg);
      if (response) {
        void this.panel.webview.postMessage(response);
      }
    }
  }

  dispose() {
    GitWindowPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

module.exports = { GitWindowPanel };
