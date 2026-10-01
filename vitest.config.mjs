import { defineConfig } from "vite-plus";

// Unit + headless suites. The mocha suite inside the real editor
// (test/vscode) runs separately via `npm run test:e2e` — it needs the
// `vscode` module only the editor provides.
export default defineConfig({
  test: {
    // Playwright (e2e/) and mocha (test/vscode) suites have their own
    // runners and must never load here.
    exclude: ["e2e/**", "test/vscode/**", "node_modules/**", "dist/**"],
  },
});
