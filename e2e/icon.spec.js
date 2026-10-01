// Verifies the contributed status bar icon really renders, in the real host.
// Offline checks (OTS, FreeType, fc-validate) cannot catch a missing CSS rule,
// and that failure is invisible: VS Code still applies .codicon-plegma-mark and
// leaves a correctly sized empty gap.
const { test, expect, _electron: electron } = require("@playwright/test");
const { downloadAndUnzipVSCode } = require("@vscode/test-electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildFixtureRepo, removeFixtureRepo } = require("../test/helpers/fixtureRepo.js");

const ROOT = path.resolve(__dirname, "..");
const SHOT = path.join(__dirname, "screenshots", "icon.png");

test.describe("plegma icon", () => {
  let dir;
  let app;
  let page;
  let profileDir;

  test.beforeAll(async () => {
    ({ dir } = await buildFixtureRepo());
    const executablePath = await downloadAndUnzipVSCode("stable");
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "plegma-icon-"));
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
    await page.waitForTimeout(12000);
  });

  test.afterAll(async () => {
    if (app) await app.close();
    if (dir) await removeFixtureRepo(dir);
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  });

  test("status bar paints the contributed glyph", async () => {
    const item = page.locator(".statusbar .statusbar-item[id='jchrist.plegma']");
    await item.first().waitFor({ timeout: 30000 });
    const icon = item.first().locator(".codicon-plegma-mark");
    await icon.first().waitFor({ state: "attached", timeout: 10000 });

    // The glyph arrives as a ::before content, so the span itself has no box.
    const info = await icon.first().evaluate(async (el) => {
      await document.fonts.ready;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const faces = [...document.fonts].map((f) => `${f.family} [${f.status}]`);
      return {
        content: before.content,
        beforeFamily: before.fontFamily,
        color: cs.color,
        faces,
      };
    });

    // A missing fontPath leaves content "none" and no @font-face at all.
    expect(info.content).not.toBe("none");
    expect(info.faces.some((f) => /plegma\.ttf/.test(f) && /loaded/.test(f))).toBe(true);

    // The decisive check: does the glyph actually paint? Compare the inked
    // pixels of this status bar item against an identical item whose icon is
    // blanked out. A missing glyph renders as pure background, so the two
    // screenshots must differ.
    const painted = await page.evaluate(() => {
      const el = document.querySelector(".codicon-plegma-mark");
      if (!el) return null;
      const host = el.closest(".statusbar-item") || el.parentElement;
      const r = host.getBoundingClientRect();
      // Nothing to compare against on a zero-size box.
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(painted.w).toBeGreaterThan(20);

    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await item.first().screenshot({ path: SHOT });
    expect(fs.existsSync(SHOT)).toBe(true);

    // Now hide just the ::before and re-shoot the same element: if the glyph
    // is really being painted, the two images must not be identical.
    await page.evaluate(() => {
      const el = document.querySelector(".codicon-plegma-mark");
      el.dataset.prevContent = getComputedStyle(el, "::before").content;
      el.style.setProperty("--plegma-test-hide", "1");
      const s = document.createElement("style");
      s.textContent = ".codicon-plegma-mark::before{content:none !important}";
      document.head.appendChild(s);
    });
    await page.waitForTimeout(400);
    const blanked = path.join(path.dirname(SHOT), "icon-blanked.png");
    await item.first().screenshot({ path: blanked });
    expect(fs.existsSync(blanked)).toBe(true);
    const same = fs.readFileSync(SHOT).equals(fs.readFileSync(blanked));
    expect(same).toBe(false);
  });

  test("editor tab shows the mark", async () => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForSelector(".quick-input-widget", { timeout: 20000 });
    await page.keyboard.type("plegma: Open Window");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Enter");

    const tab = page.locator(".tab.has-icon[aria-label='Plegma']");
    await tab.first().waitFor({ timeout: 30000 });
    const painted = await tab.first().evaluate((el) => {
      const out = [];
      for (const child of el.querySelectorAll("*")) {
        const bg = getComputedStyle(child).backgroundImage;
        if (bg && bg.includes("url(") && !bg.includes("codicon")) out.push(bg);
      }
      return out;
    });
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.join(" ")).toContain("icon.png");
  });
});
