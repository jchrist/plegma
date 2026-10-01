// Shared message shapes between extension host and Webview.
// Plain JS version: no runtime exports, just documentation.
//
// WebviewToHostMessage:
//   { type: 'ready' } | { type: 'openInEditor' } | { type: 'ping', payload: string }
// HostToWebviewMessage:
//   { type: 'hello', location: 'editor', repoRoot?: string } | { type: 'pong', payload: string }
// Git request (Task 1.2+):
//   { type: 'git/request', id: string, method: string, args?: any }
// Git response:
//   { type: 'git/response', id: string, ok: boolean, data?: any, error?: string }
