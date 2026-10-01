// Real-VS Code UI suite (Playwright driving Electron). The mocha suite
// (test/vscode) covers extension-host API; this covers the actual window:
// palette command, webview content, row click, screenshot.
// Run: npm run test:e2e:ui   (needs xvfb on headless Linux)
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: ["*.spec.js"],
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
