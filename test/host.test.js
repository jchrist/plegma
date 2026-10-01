// Fast unit tests for the extension-host UI modules: HTML shell,
// view provider routing, and panel singleton. No VS Code, no git.
import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { getWebviewHtml } from "../src/getWebviewHtml.js";
import { GitWindowPanel } from "../src/GitWindowPanel.js";

function fakeUri(fsPath) {
  return { fsPath, toString: () => `file://${fsPath}` };
}

const fakeVscode = {
  ViewColumn: { One: 1, Two: 2 },
  Uri: {
    file: (p) => fakeUri(p),
    joinPath: (base, ...parts) => fakeUri(`${base.fsPath}/${parts.join("/")}`),
  },
  window: { activeTextEditor: undefined },
};

function fakeWebview() {
  const received = [];
  return {
    received,
    options: null,
    html: "",
    cspSource: "vscode-webview://test",
    asWebviewUri: (uri) => fakeUri(`wrapped${uri.fsPath}`),
    onDidReceiveMessage(fn) {
      received.push(fn);
      return { dispose() {} };
    },
    async postMessage(msg) {
      received.push(msg);
    },
  };
}

describe("getWebviewHtml", () => {
  it("builds a CSP shell with matching nonces and initial state", () => {
    const webview = fakeWebview();
    const html = getWebviewHtml(webview, fakeUri("/ext"), "panel", fakeVscode);
    assert.match(html, /<title>Plegma<\/title>/);
    assert.match(html, /<div id="root"><\/div>/);
    const csp = html.match(/content="([^"]*)"/)[1];
    assert.match(csp, /default-src 'none'/);
    const scriptNonce = html.match(/<script nonce="([^"]+)" src="([^"]+)"/);
    assert.ok(scriptNonce, "nonce script tag present");
    assert.ok(
      csp.includes(`script-src 'nonce-${scriptNonce[1]}'`),
      "CSP whitelists the script nonce",
    );
    assert.match(scriptNonce[2], /wrapped\/ext\/out\/webview\.js/);
    const stateText = html.match(
      /<script type="application\/json" id="plegma-initial-state">([^<]*)<\/script>/,
    )[1];
    assert.deepEqual(JSON.parse(stateText), { type: "hello", location: "panel" });
  });

  it("escapes angle brackets in state so it cannot break out of the script tag", () => {
    const webview = fakeWebview();
    const html = getWebviewHtml(webview, fakeUri("/ext"), "panel</script><script>", fakeVscode);
    assert.ok(!html.includes("</script><script>"), "no raw closing tag from input");
    assert.ok(html.includes("\\u003c"), "brackets escaped");
  });

  it("uses a fresh nonce per call", () => {
    const a = getWebviewHtml(fakeWebview(), fakeUri("/ext"), "panel", fakeVscode);
    const b = getWebviewHtml(fakeWebview(), fakeUri("/ext"), "panel", fakeVscode);
    const nonceOf = (html) => html.match(/<script nonce="([^"]+)" src=/)[1];
    assert.notEqual(nonceOf(a), nonceOf(b));
  });
});

describe("GitWindowPanel", () => {
  function fakePanel() {
    const received = [];
    return {
      received,
      revealed: [],
      disposed: false,
      webview: {
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri) => fakeUri(`wrapped${uri.fsPath}`),
        onDidReceiveMessage(fn) {
          received.push(fn);
          return { dispose() {} };
        },
        async postMessage(msg) {
          received.push(msg);
        },
      },
      onDidDispose() {},
      reveal: (...args) => {},
      dispose() {},
    };
  }

  function panelVscode(created) {
    return {
      ...fakeVscode,
      window: {
        ...fakeVscode.window,
        createWebviewPanel: (...args) => {
          const panel = fakePanel();
          created.push({ args, panel });
          return panel;
        },
      },
    };
  }

  it("creates, reveals, and reuses the singleton", () => {
    GitWindowPanel.currentPanel = undefined;
    const created = [];
    const vscode = panelVscode(created);
    try {
      GitWindowPanel.createOrShow(vscode, fakeUri("/ext"), async () => null);
      assert.equal(created.length, 1);
      assert.equal(created[0].args[0], "plegma.gitWindow");
      // The tab, the status bar item and the command titles all read
      // "Plegma"; the tab used to read "plegma".
      assert.equal(created[0].args[1], "Plegma");
      assert.match(
        created[0].panel.iconPath && created[0].panel.iconPath.fsPath,
        /resources\/icon\.png$/,
        "editor tab shows the extensions page icon",
      );
      const first = GitWindowPanel.currentPanel;
      assert.ok(first, "singleton stored");
      assert.match(first.panel.webview.html, /<div id="root"><\/div>/);
      GitWindowPanel.createOrShow(vscode, fakeUri("/ext"), async () => null);
      assert.equal(created.length, 1, "second call reveals instead of creating");
      assert.equal(GitWindowPanel.currentPanel, first);
    } finally {
      GitWindowPanel.currentPanel = undefined;
    }
  });

  it("routes git requests and ping through handleMessage", async () => {
    GitWindowPanel.currentPanel = undefined;
    const posted = [];
    const panel = fakePanel();
    panel.webview.postMessage = async (m) => posted.push(m);
    const instance = new GitWindowPanel(
      panel,
      fakeUri("/ext"),
      async (msg) => ({
        type: "git/response",
        id: msg.id,
        ok: true,
        data: "x",
      }),
      fakeVscode,
    );
    try {
      await instance.handleMessage(null);
      await instance.handleMessage({ type: "ping", payload: "p" });
      await instance.handleMessage({ type: "git/request", id: "3", method: "log" });
      assert.deepEqual(posted, [
        { type: "pong", payload: "p" },
        { type: "git/response", id: "3", ok: true, data: "x" },
      ]);
    } finally {
      GitWindowPanel.currentPanel = undefined;
    }
  });

  it("dispose clears the singleton and disposes resources", () => {
    GitWindowPanel.currentPanel = undefined;
    let panelDisposed = false;
    const panel = fakePanel();
    panel.dispose = () => {
      panelDisposed = true;
    };
    const instance = new GitWindowPanel(panel, fakeUri("/ext"), async () => null, fakeVscode);
    GitWindowPanel.currentPanel = instance;
    instance.disposables.push({ dispose() {} });
    instance.dispose();
    assert.equal(GitWindowPanel.currentPanel, undefined);
    assert.equal(panelDisposed, true);
    assert.deepEqual(instance.disposables, []);
  });

  it("second createOrShow updates the handler without recreating", () => {
    GitWindowPanel.currentPanel = undefined;
    const created = [];
    const vscode = {
      ...fakeVscode,
      window: {
        ...fakeVscode.window,
        createWebviewPanel: (...args) => {
          created.push(args);
          return fakePanel();
        },
      },
    };
    try {
      const first = async () => "first";
      const second = async () => "second";
      GitWindowPanel.createOrShow(vscode, fakeUri("/ext"), first);
      GitWindowPanel.createOrShow(vscode, fakeUri("/ext"), second);
      assert.equal(created.length, 1);
      assert.equal(GitWindowPanel.currentPanel.gitHandler, second);
    } finally {
      GitWindowPanel.currentPanel = undefined;
    }
  });

  it("handleMessage without a handler posts nothing", async () => {
    GitWindowPanel.currentPanel = undefined;
    const posted = [];
    const panel = fakePanel();
    panel.webview.postMessage = async (m) => posted.push(m);
    const instance = new GitWindowPanel(panel, fakeUri("/ext"), null, fakeVscode);
    try {
      await instance.handleMessage({ type: "git/request", id: "4", method: "log" });
      assert.deepEqual(posted, []);
    } finally {
      GitWindowPanel.currentPanel = undefined;
    }
  });
});
