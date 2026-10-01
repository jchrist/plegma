// Host-side prompts served over the git/request protocol so the webview
// can delegate data entry to native VS Code UI instead of custom popovers.
// No repo needed; the extension host answers directly.
//
// promptInput: args { prompt, placeHolder?, value? }
//   -> data { value: string|null } (null when dismissed).
// promptPick: args { placeHolder?, items: [{ label, description?, value? }] }
//   -> data { value: any|null } (item value, label fallback, or null).
async function handlePromptRequest(vscode, msg) {
  if (!msg || msg.type !== "git/request") {
    return null;
  }
  const args = (msg && msg.args) || {};
  if (msg.method === "promptInput") {
    const value = await vscode.window.showInputBox({
      prompt: args.prompt,
      placeHolder: args.placeHolder,
      value: args.value,
      ignoreFocusOut: true,
    });
    return {
      type: "git/response",
      id: msg.id,
      ok: true,
      data: { value: value === undefined ? null : value },
    };
  }
  if (msg.method === "promptPick") {
    const items = Array.isArray(args.items) ? args.items : [];
    const picked = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: item.label,
        description: item.description,
        value: item.value !== undefined ? item.value : item.label,
      })),
      { placeHolder: args.placeHolder, ignoreFocusOut: true },
    );
    return {
      type: "git/response",
      id: msg.id,
      ok: true,
      data: { value: picked ? picked.value : null },
    };
  }
  return null;
}

module.exports = { handlePromptRequest };
