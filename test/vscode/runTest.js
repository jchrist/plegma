// Launcher for the official VS Code end-to-end suite.
// Run headless with: xvfb-run -a npm run test:e2e
// Creates a fixture git repo, launches a real editor with this extension
// installed from the working tree, runs the suite, then cleans up.
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { buildFixtureRepo, removeFixtureRepo } = require("../helpers/fixtureRepo");

async function main() {
  const { dir } = await buildFixtureRepo();
  try {
    await runTests({
      version: "stable",
      extensionDevelopmentPath: path.resolve(__dirname, "..", ".."),
      extensionTestsPath: path.resolve(__dirname, "suite", "index.js"),
      launchArgs: [dir, "--disable-workspace-trust"],
    });
  } catch (err) {
    console.error("VS Code e2e failed:", err);
    process.exit(1);
  } finally {
    await removeFixtureRepo(dir);
  }
}

main();
