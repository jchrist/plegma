// Playwright UI spec: drives the real VS Code Electron app, opens the
// plegma window through the command palette, and asserts on the rendered
// webview (content, row click, screenshot).
const { test, expect, _electron: electron } = require("@playwright/test");
const { downloadAndUnzipVSCode } = require("@vscode/test-electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildFixtureRepo, removeFixtureRepo } = require("../test/helpers/fixtureRepo.js");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

const ROOT = path.resolve(__dirname, "..");
const SHOT = path.join(__dirname, "screenshots", "ui.png");

async function findWebviewFrame(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = page.frames().find((f) => f.url().includes("fake.html"));
    if (frame) {
      return frame;
    }
    if (Date.now() > deadline) {
      throw new Error("plegma webview frame (fake.html) never appeared");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Open (or focus, if already open) the plegma window, then return its frame.
// Every UI test starts this way so tests pass standalone and survive
// worker restarts between tests.
async function openWindow(page) {
  await page.keyboard.press("Control+Shift+p");
  await page.waitForSelector(".quick-input-widget", { timeout: 20000 });
  await page.keyboard.type("plegma: Open Window");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Enter");
  return findWebviewFrame(page);
}

test.describe("plegma window in real VS Code", () => {
  let dir;
  let app;
  let page;
  let profileDir;

  test.beforeAll(async () => {
    ({ dir } = await buildFixtureRepo());
    const executablePath = await downloadAndUnzipVSCode("stable");
    // Isolated profile: without it the test binary forwards to any
    // running desktop VS Code (same default user-data-dir) and exits.
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "plegma-ui-profile-"));
    app = await electron.launch({
      executablePath,
      args: [
        "--new-window",
        "--disable-workspace-trust",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--no-sandbox",
        `--user-data-dir=${profileDir}`,
        `--extensionDevelopmentPath=${ROOT}`,
        dir,
      ],
    });
    page = await app.firstWindow();
    await page.waitForTimeout(10000);
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (dir) {
      await removeFixtureRepo(dir);
    }
    if (profileDir) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test("opens the window from the palette and renders the graph", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    await expect(frame.getByText("refactor: rename app to main")).toBeVisible();
    await expect(frame.getByText("feat: feature tweak")).toBeVisible();
    // Branch chips and tag render next to the commits.
    const body = await frame.locator("body").innerText();
    expect(body).toMatch(/main/);
    expect(body).toMatch(/v0\.1/);
  });

  test("clicking a commit shows its files, then screenshots", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    await frame.getByText("feat: initial app", { exact: true }).click();
    await frame.getByText("Files — feat: initial app", { exact: true }).waitFor({ timeout: 15000 });
    await frame.getByText("app.js", { exact: true }).waitFor({ timeout: 15000 });
    const body = await frame.locator("body").innerText();
    expect(body).toMatch(/app\.js|main\.js/);
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT });
    expect(fs.existsSync(SHOT)).toBe(true);
  });

  test("dirty tree shows the worktree bar and Stash really stashes", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    fs.writeFileSync(path.join(dir, "app.js"), "console.log(99);\n");
    // The 5s fingerprint poll picks up the dirty tree.
    await frame.getByText(/Uncommitted changes on/).waitFor({ timeout: 30000 });
    await frame.getByRole("button", { name: "Stash changes" }).click();
    await frame.getByText(/Stashed 1 file/).waitFor({ timeout: 30000 });
    expect(git(dir, "stash", "list").length).toBeGreaterThan(0);
    expect(git(dir, "status", "--porcelain")).toBe("");
    await frame.getByText(/Uncommitted changes on/).waitFor({ state: "detached", timeout: 30000 });
    // Restore the fixture to a clean tree for later tests.
    execFileSync("git", ["stash", "pop", "--quiet"], { cwd: dir });
    execFileSync("git", ["checkout", "--", "app.js"], { cwd: dir });
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  test("commit menu creates a branch through the input box", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    await frame.getByText("feat: initial app", { exact: true }).click({ button: "right" });
    await frame.getByText("Create Branch…").click();
    // showInputBox appears in the main window, not the webview frame.
    await page.waitForSelector(".quick-input-widget", { timeout: 20000 });
    await page.keyboard.type("e2e-ui-branch");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => git(dir, "branch", "--list", "e2e-ui-branch"), { timeout: 30000 })
      .not.toBe("");
    const tip = git(dir, "rev-parse", "e2e-ui-branch");
    const all = git(dir, "rev-list", "--format=%H %s", "--all");
    expect(all).toContain(tip);
    execFileSync("git", ["branch", "-D", "e2e-ui-branch"], { cwd: dir });
  });

  test("a branch chip's menu has both the commit's and the branch's actions", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    // A left click only selects: no menu, and the commit shows in the panel.
    await frame.getByText("feature", { exact: true }).click();
    await expect(frame.locator(".plegma-menu")).toHaveCount(0);
    // Right-click the chip: the commit's actions and the branch's, together.
    await frame.getByText("feature", { exact: true }).click({ button: "right" });
    await frame.getByText("Open Changes").waitFor({ timeout: 15000 });
    await frame.getByText("Copy Commit Hash").waitFor({ timeout: 15000 });
    await frame.getByText("New branch from here…").waitFor({ timeout: 15000 });
    await frame.getByText("Rename…").waitFor({ timeout: 15000 });
    // Any click elsewhere dismisses it.
    await frame.getByText("feat: initial app", { exact: true }).click();
    await expect(frame.locator(".plegma-menu")).toHaveCount(0);
  });

  test("double-clicking a branch chip checks it out", async () => {
    const frame = await openWindow(page);
    await frame.getByText("feat: initial app", { exact: true }).waitFor({ timeout: 30000 });
    expect(git(dir, "branch", "--show-current")).toBe("main");
    await frame.getByText("feature", { exact: true }).dblclick();
    await expect
      .poll(() => git(dir, "branch", "--show-current"), { timeout: 30000 })
      .toBe("feature");
    execFileSync("git", ["checkout", "--quiet", "main"], { cwd: dir });
    expect(git(dir, "branch", "--show-current")).toBe("main");
  });
});
