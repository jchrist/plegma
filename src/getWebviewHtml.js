function getWebviewHtml(webview, extensionUri, location, vscode) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview.js"));
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `style-src 'unsafe-inline' ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  const initialState = {
    type: "hello",
    location,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Plegma</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root { height: 100vh; width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="application/json" id="plegma-initial-state">${escapeJson(
    JSON.stringify(initialState),
  )}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeJson(json) {
  return json.replace(/</g, "\\u003c");
}

module.exports = { getWebviewHtml };
