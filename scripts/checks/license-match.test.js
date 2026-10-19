"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const HEADERS = {
  "AGPL-3.0-only": /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/,
  "AGPL-3.0-or-later": /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/,
  "GPL-3.0-only": /GNU GENERAL PUBLIC LICENSE\s+Version 3/,
  "MIT": /MIT License/,
  "Apache-2.0": /Apache License\s+Version 2\.0/,
};

test("root package.json license matches the LICENSE file", () => {
  const pkgPath = path.join(ROOT, "package.json");
  const licPath = path.join(ROOT, "LICENSE");
  assert.ok(fs.existsSync(pkgPath), "root package.json is missing");
  assert.ok(fs.existsSync(licPath), "root LICENSE is missing");

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const spdx = pkg.license;
  assert.ok(typeof spdx === "string" && spdx.length > 0, "package.json has no `license` field");
  const header = HEADERS[spdx];
  assert.ok(header, `package.json license "${spdx}" is not in the known-license table (add it to HEADERS in this test)`);

  const head = fs.readFileSync(licPath, "utf8").split(/\r?\n/).slice(0, 5).join("\n");
  assert.match(head, header, `LICENSE header does not match package.json license "${spdx}"\n--- LICENSE head ---\n${head}`);
});

test("planted mismatch is detected (self-test)", () => {
  const head = "MIT License\n\nCopyright (c) example";
  assert.doesNotMatch(head, HEADERS["AGPL-3.0-only"]);
});
