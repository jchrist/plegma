// Mocha bootstrap executed inside the real Extension Host.
const path = require("node:path");
const fs = require("node:fs");
const Mocha = require("mocha");

function run() {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 120000 });
  const dir = path.resolve(__dirname);
  fs.readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .forEach((f) => mocha.addFile(path.join(dir, f)));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };
