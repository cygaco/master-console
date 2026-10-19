#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const cHash = require("./lib/content-hash");
const diff = require("./diff");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

const stamp = Date.now();
const tmp = path.join(os.tmpdir(), `mcdiff-${process.pid}-${stamp}`);
const canon = path.join(tmp, "canonical");
const prod = path.join(tmp, "product");

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function hashOf(root, rel) {
  return cHash.contentHash(path.join(root, rel));
}

try {
  fs.mkdirSync(path.join(canon, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(prod, ".claude"), { recursive: true });

  write(canon, "version.json", JSON.stringify({ version: "0.11.0" }));

  write(canon, "a.txt", "A2\n");
  write(canon, "b.txt", "B\n");
  write(canon, "c.txt", "C\n");
  write(canon, "d.txt", "D\n");

  write(prod, "a.txt", "A1\n");
  const installedA = hashOf(prod, "a.txt");
  write(prod, "b.txt", "B\n");
  const installedB = hashOf(prod, "b.txt");
  write(prod, "b.txt", "Bmod\n");
  write(prod, "c.txt", "C\n");
  const installedC = hashOf(prod, "c.txt");
  write(prod, "e.txt", "E\n");
  const installedE = hashOf(prod, "e.txt");

  write(
    canon,
    ".claude/framework-installed.json",
    JSON.stringify({
      installedVersion: "0.11.0",
      assets: [
        { dest: "a.txt", kind: "skill", owner: "framework", installedHash: hashOf(canon, "a.txt") },
        { dest: "b.txt", kind: "agent", owner: "framework", installedHash: hashOf(canon, "b.txt") },
        { dest: "c.txt", kind: "hook", owner: "framework", installedHash: hashOf(canon, "c.txt") },
        { dest: "d.txt", kind: "skill", owner: "framework", installedHash: hashOf(canon, "d.txt") },
      ],
    }),
  );

  write(
    prod,
    ".claude/framework-installed.json",
    JSON.stringify({
      installedVersion: "0.10.0",
      assets: [
        { dest: "a.txt", kind: "skill", owner: "framework", installedHash: installedA },
        { dest: "b.txt", kind: "agent", owner: "framework", installedHash: installedB },
        { dest: "c.txt", kind: "hook", owner: "framework", installedHash: installedC },
        { dest: "e.txt", kind: "skill", owner: "framework", installedHash: installedE },
      ],
    }),
  );

  const r = diff.computeDiff(canon, prod);
  ok("computeDiff ok", r.ok === true, JSON.stringify(r));

  ok("canonicalVersion 0.11.0", r.canonicalVersion === "0.11.0", r.canonicalVersion);
  ok("productVersion 0.10.0", r.productVersion === "0.10.0", r.productVersion);
  ok("versionDelta product_behind", r.versionDelta === "product_behind", r.versionDelta);

  const byDest = Object.fromEntries(r.fileDrift.map((f) => [f.dest, f.status]));
  ok("a.txt → product_stale", byDest["a.txt"] === "product_stale", byDest["a.txt"]);
  ok("b.txt → product_modified", byDest["b.txt"] === "product_modified", byDest["b.txt"]);
  ok("c.txt in sync (not reported)", byDest["c.txt"] === undefined, byDest["c.txt"]);
  ok("d.txt → missing_in_product", byDest["d.txt"] === "missing_in_product", byDest["d.txt"]);
  ok("e.txt → extra_in_product", byDest["e.txt"] === "extra_in_product", byDest["e.txt"]);

  ok("coverage.missingInProduct = [d.txt]", JSON.stringify(r.coverage.missingInProduct) === '["d.txt"]', JSON.stringify(r.coverage.missingInProduct));
  ok("coverage.extraInProduct = [e.txt]", JSON.stringify(r.coverage.extraInProduct) === '["e.txt"]', JSON.stringify(r.coverage.extraInProduct));

  ok("sahMissing.skill = [d.txt]", JSON.stringify(r.skillsAgentsHooks.missingInProduct.skill) === '["d.txt"]', JSON.stringify(r.skillsAgentsHooks.missingInProduct.skill));
  ok("sahMissing.agent empty", r.skillsAgentsHooks.missingInProduct.agent.length === 0);
  ok("sahExtra.skill = [e.txt]", JSON.stringify(r.skillsAgentsHooks.extraInProduct.skill) === '["e.txt"]', JSON.stringify(r.skillsAgentsHooks.extraInProduct.skill));

  ok("drift count product_stale=1", r.counts.drift.product_stale === 1, JSON.stringify(r.counts.drift));
  ok("drift count product_modified=1", r.counts.drift.product_modified === 1, JSON.stringify(r.counts.drift));
  ok("drift count missing_in_product=1", r.counts.drift.missing_in_product === 1, JSON.stringify(r.counts.drift));
  ok("drift count extra_in_product=1", r.counts.drift.extra_in_product === 1, JSON.stringify(r.counts.drift));

  ok("compareVersions(0.10.0, 0.11.0) === -1", diff.compareVersions("0.10.0", "0.11.0") === -1);
  ok("compareVersions(1.0.0, 0.9.9) === 1", diff.compareVersions("1.0.0", "0.9.9") === 1);
  ok("compareVersions(0.10.0, 0.10.0) === 0", diff.compareVersions("0.10.0", "0.10.0") === 0);
  ok("compareVersions(0.10, 0.10.0) === 0 (length-tolerant)", diff.compareVersions("0.10", "0.10.0") === 0);

  const res = diff.resolveProductRoot(undefined, null);
  ok("resolveProductRoot with no slug/path → error", !!res.error, JSON.stringify(res));

  const empty = path.join(tmp, "empty-product");
  fs.mkdirSync(empty, { recursive: true });
  const r2 = diff.computeDiff(canon, empty);
  ok("missing framework-installed.json → ok:false", r2.ok === false, JSON.stringify(r2));
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
  }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
