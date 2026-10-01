// Fake `vscode` API object for headless end-to-end tests.
// Pass it into src/ modules that take a vscode parameter (e.g.
// activate(context, vscode)); nothing here patches the module loader.
function createUri(fsPath, scheme = "file", query = "") {
  const uri = {
    fsPath,
    path: fsPath,
    scheme,
    query,
    with(change = {}) {
      return createUri(
        change.path !== undefined ? change.path : uri.path,
        change.scheme || uri.scheme,
        change.query !== undefined ? change.query : uri.query,
      );
    },
    toString() {
      return `${uri.scheme}://${fsPath}${uri.query ? `?${uri.query}` : ""}`;
    },
  };
  return uri;
}

const Uri = {
  file: (p) => createUri(p),
  from: (parts) => createUri(parts.path, parts.scheme || "file", parts.query || ""),
  joinPath: (base, ...parts) => createUri(`${base.fsPath}/${parts.join("/")}`),
};

function createFakeVscode({ workspaceRoot, colorThemeKind = 1 } = {}) {
  const commandsRegistered = new Map();
  const executedCommands = [];
  const statusItems = [];
  const views = [];
  const panels = [];
  const messages = { info: [], warn: [], error: [] };
  // vscode.ColorThemeKind: 1 light, 2 dark, 3 high contrast, 4 HC light.
  const themeListeners = [];

  const vscode = {
    Uri,
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      activeTextEditor: undefined,
      activeColorTheme: { kind: colorThemeKind },
      onDidChangeActiveColorTheme: (listener, thisArg, disposables) => {
        const bound = thisArg ? listener.bind(thisArg) : listener;
        themeListeners.push(bound);
        const disposable = {
          disposed: false,
          dispose() {
            this.disposed = true;
            const i = themeListeners.indexOf(bound);
            if (i >= 0) {
              themeListeners.splice(i, 1);
            }
          },
        };
        if (disposables) {
          disposables.push(disposable);
        }
        return disposable;
      },
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => {
        const item = {
          text: "",
          tooltip: "",
          command: undefined,
          shown: false,
          show() {
            this.shown = true;
          },
          hide() {},
          dispose() {},
        };
        statusItems.push(item);
        return item;
      },
      registerWebviewViewProvider: (viewId, provider, options) => {
        views.push({ viewId, provider, options });
        return { dispose() {} };
      },
      createWebviewPanel: (...args) => {
        const panel = {
          args,
          handler: null,
          posted: [],
          revealed: [],
          webview: {
            html: "",
            options: args[3],
            cspSource: "vscode-webview://test",
            asWebviewUri: (uri) => ({
              toString: () => `vscode-webview://test/${uri.fsPath}`,
            }),
            onDidReceiveMessage: (fn) => {
              panel.handler = fn;
              return { dispose() {} };
            },
            postMessage: async (msg) => {
              panel.posted.push(msg);
            },
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal: (...rargs) => {
            panel.revealed.push(rargs);
          },
          dispose: () => {},
        };
        panels.push(panel);
        return panel;
      },
      showInformationMessage: async (m) => {
        messages.info.push(m);
      },
      showWarningMessage: async (m) => {
        messages.warn.push(m);
      },
      showErrorMessage: async (m) => {
        messages.error.push(m);
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        commandsRegistered.set(id, fn);
        return { dispose() {} };
      },
      executeCommand: async (id, ...args) => {
        executedCommands.push([id, ...args]);
      },
    },
    workspace: {
      workspaceFolders: workspaceRoot ? [{ uri: createUri(workspaceRoot) }] : [],
      getConfiguration: () => ({ get: (_k, dflt) => dflt }),
    },
    extensions: {
      getExtension: () => undefined, // no vscode.git in headless tests
    },
  };

  return {
    vscode,
    commandsRegistered,
    executedCommands,
    statusItems,
    views,
    panels,
    messages,
    // Pretend the user switched color theme; the tab icon must follow.
    setColorThemeKind(kind) {
      vscode.window.activeColorTheme = { kind };
      for (const listener of [...themeListeners]) {
        listener({ kind });
      }
    },
  };
}

// Fake webview side of a WebviewView. Captures posted messages and lets the
// test inject incoming messages as if from the React UI.
function createFakeWebviewView() {
  const posted = [];
  let handler = null;
  return {
    posted,
    webview: {
      options: null,
      html: "",
      cspSource: "vscode-webview://test",
      asWebviewUri: (uri) => ({ toString: () => `vscode-webview://test/${uri.fsPath}` }),
      onDidReceiveMessage: (fn) => {
        handler = fn;
        return { dispose() {} };
      },
      postMessage: async (msg) => {
        posted.push(msg);
      },
    },
    async send(msg) {
      return handler && handler(msg);
    },
    lastResponseTo(id) {
      const found = posted.filter((m) => m && m.id === id);
      return found[found.length - 1];
    },
  };
}

module.exports = { createFakeVscode, createFakeWebviewView, Uri };
