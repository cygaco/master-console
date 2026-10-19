"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const INSTALLER = path.join(__dirname, "..", "mc-setup.js");

for (const flag of ["--help", "-h"]) {
  test(`mc-setup.js ${flag} prints usage, exits 0 and writes nothing in the current directory`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-setup-help-"));
    try {
      const r = spawnSync(process.execPath, [INSTALLER, flag], { cwd: dir, encoding: "utf8", timeout: 60000 });
      assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
      assert.match(r.stdout, /Usage:/);
      assert.match(r.stdout, /mc-setup\.js/);
      assert.deepStrictEqual(fs.readdirSync(dir), [], "the current directory stays empty");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
