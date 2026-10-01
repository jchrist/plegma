// Builds a realistic fixture git repo for end-to-end tests:
// main with 3 commits, a feature branch with a rename, and a tag.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const ex = promisify(execFile);

async function git(cwd, ...args) {
  return ex("git", args, { cwd });
}

async function commitFile(cwd, name, content, message) {
  await fs.writeFile(path.join(cwd, name), content);
  await git(cwd, "add", name);
  await git(cwd, "commit", "-m", message, "--quiet");
  const { stdout } = await git(cwd, "rev-parse", "HEAD");
  return stdout.trim();
}

async function buildFixtureRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plegma-e2e-"));
  await git(dir, "init", "-b", "main", "--quiet");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  await git(dir, "config", "commit.gpgsign", "false");

  await commitFile(dir, "app.js", "console.log(1);\n", "feat: initial app");
  await commitFile(dir, "app.js", "console.log(2);\n", "feat: bump log");
  await git(dir, "tag", "v0.1");
  await git(dir, "checkout", "-b", "feature", "--quiet");
  await commitFile(dir, "app.js", "console.log(3);\n", "feat: feature tweak");
  await git(dir, "mv", "app.js", "main.js");
  await git(dir, "commit", "-m", "refactor: rename app to main", "--quiet");
  const { stdout: renameSha } = await git(dir, "rev-parse", "HEAD");
  await git(dir, "checkout", "main", "--quiet");

  return { dir, renameSha: renameSha.trim() };
}

async function removeFixtureRepo(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

module.exports = { buildFixtureRepo, removeFixtureRepo };
