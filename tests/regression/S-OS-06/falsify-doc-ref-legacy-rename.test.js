#!/usr/bin/env node
"use strict";
/**
 * falsify-doc-ref-legacy-rename — S-OS-06 T5-E2d (α ruling).
 *
 * doc-ref-integrity treats a canon-doc citation of a PRE-RENAME path (the legacy slug in the path) as "allowed-renamed"
 * IFF the codemod's mc-renamed counterpart (rename-mc.js#renamePath) EXISTS on disk. The count is visible, never
 * silent, and the tolerance only holds while the registered compat surface `doc-ref-legacy-rename` is unexpired
 * (per-entry expires 2.1.0). This fixture proves the tolerance can never become a blanket pass for legacy-shaped paths:
 *
 * RED:   a legacy-slug ref whose mc counterpart does NOT exist is STILL a broken ref, both in the pure core (tolerance ON)
 *        and on the real disk path under --enforce. A counterpart-present ref is broken again once the window's expiry
 *        is reached, when the tree version is unknown, when the surface is not registered, when the partition is
 *        unloadable, and when no tolerance is supplied (fail closed).
 * GREEN: a counterpart-present ref is allowed-renamed and COUNTED (JSON allowedRenamed + the printed note). The real
 *        partition registers the surface with its OWN expires 2.1.0, binding exactly the checker's one legacy literal.
 *
 *   node --test tests/regression/S-OS-06/falsify-doc-ref-legacy-rename.test.js
 */
const FALSIFIER_ID = "DOC-REF-LEGACY-RENAME";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const H = require("./falsifier-harness");

const CHECK_REL = "scripts/checks/doc-ref-integrity.js";
const CHECK_FILE = path.join(H.REAL_ROOT, ...CHECK_REL.split("/"));
const DRI = require(CHECK_FILE);
const { renamePath } = require(path.join(H.REAL_ROOT, "scripts", "open-source", "rename-mc.js"));

const SURFACE = "doc-ref-legacy-rename";
const GONE = `scripts/${H.SLUG}/moved-and-deleted.js`; // counterpart scripts/mc/moved-and-deleted.js is ABSENT
const MOVED = `scripts/${H.SLUG}/moved-intact.js`; // counterpart scripts/mc/moved-intact.js is PRESENT
const NO_ALLOW = { pathPrefixes: [], literals: [] };

const realPartition = () => H.LOADER.loadPartition({ forceReload: true });
const toleranceAt = (version, partition = realPartition()) =>
  DRI.resolveLegacyRename({ partition, version, isExpired: H.LOADER.isCompatExpired });

/** Synthetic refs annotated against a synthetic disk: `present` is the set of repo paths that exist. */
function refsFor(targets, present) {
  return targets.map((target) =>
    DRI.annotateLegacyRename({ file: "CHANGELOG.md", line: 1, target, exists: present.has(target) }, renamePath, (_file, t) => present.has(t))
  );
}

test(`${FALSIFIER_ID} GREEN: the real partition registers '${SURFACE}' with its OWN expires 2.1.0, binding exactly the checker's one legacy literal`, () => {
  const p = realPartition();
  const w = p.compatWindows.find((x) => x && x.surface === SURFACE);
  assert.ok(w, `compat surface '${SURFACE}' must be registered in the partition's compatWindows`);
  assert.strictEqual(w.expires, "2.1.0", "the tolerance carries the same per-entry expiry as the other compat surfaces");
  const lines = fs.readFileSync(CHECK_FILE, "utf8").split(/\r?\n/);
  const bound = lines.filter((l) => {
    const hit = p.findCompatOccurrence(CHECK_REL, l);
    return hit && hit.window.surface === SURFACE;
  });
  assert.strictEqual(bound.length, 1, `the surface must bind exactly one checker line, bound ${bound.length}`);
  const slugLines = lines.filter((l) => new RegExp(H.SLUG, "i").test(l));
  assert.deepStrictEqual(slugLines, bound, "the checker carries no legacy literal outside its registered compat occurrence");
  const tol = toleranceAt("2.0.0", p);
  assert.strictEqual(tol.active, true, tol.reason);
});

test(`${FALSIFIER_ID} RED: a legacy-slug ref whose mc counterpart does NOT exist is STILL a broken ref (tolerance ON)`, () => {
  const tol = toleranceAt("2.0.0");
  assert.strictEqual(tol.active, true, tol.reason);
  const refs = refsFor([GONE], new Set());
  assert.strictEqual(refs[0].legacyCounterpart, renamePath(GONE));
  assert.notStrictEqual(refs[0].legacyCounterpart, GONE, "the counterpart is the codemod's rename, not the legacy path");
  assert.strictEqual(refs[0].legacyCounterpartExists, false);
  const { findings, allowed, allowedRenamed } = DRI.evaluate({ refs, allowlist: NO_ALLOW, legacyRename: tol });
  assert.deepStrictEqual(findings.map((f) => f.target), [GONE]);
  assert.match(findings[0].message, /does not exist either/);
  assert.strictEqual(allowed.length, 0);
  assert.strictEqual(allowedRenamed, 0);
});

test(`${FALSIFIER_ID} GREEN: a counterpart-present legacy ref is allowed-renamed and COUNTED; a non-legacy broken ref is untouched`, () => {
  const tol = toleranceAt("2.0.0");
  const neverExisted = "scripts/mc/never-existed.js";
  const refs = refsFor([MOVED, neverExisted], new Set([renamePath(MOVED)]));
  assert.strictEqual(refs[1].legacyCounterpart, undefined, "a path without the legacy slug is never annotated");
  const { findings, allowed, allowedRenamed } = DRI.evaluate({ refs, allowlist: NO_ALLOW, legacyRename: tol });
  assert.strictEqual(allowedRenamed, 1);
  assert.strictEqual(allowed.length, 1);
  assert.strictEqual(allowed[0].target, MOVED);
  assert.strictEqual(allowed[0].renamed, true);
  assert.match(allowed[0].allowedBy, /compat-renamed \(doc-ref-legacy-rename, expires 2\.1\.0\)/);
  assert.deepStrictEqual(findings.map((f) => f.target), [neverExisted]);
});

test(`${FALSIFIER_ID} RED (fail closed): a counterpart-present ref is broken again at expiry, unknown version, unregistered surface, unloadable partition, or no tolerance`, () => {
  const p = realPartition();
  const unregistered = H.LOADER.buildPartition({ ...p.denylist, compatWindows: p.compatWindows.filter((w) => w.surface !== SURFACE) });
  const cases = {
    "expiry reached (tree 2.1.0)": toleranceAt("2.1.0", p),
    "past expiry (tree 3.0.0)": toleranceAt("3.0.0", p),
    "unknown tree version": toleranceAt(null, p),
    "surface not registered": DRI.resolveLegacyRename({ partition: unregistered, version: "2.0.0", isExpired: H.LOADER.isCompatExpired }),
    "partition unloadable": DRI.resolveLegacyRename({ partition: null, loadError: "fixture: unreadable" }),
    "no tolerance supplied": undefined,
  };
  for (const [label, tol] of Object.entries(cases)) {
    if (tol) assert.strictEqual(tol.active, false, `${label}: the tolerance must be OFF (${tol.reason})`);
    const refs = refsFor([MOVED], new Set([renamePath(MOVED)]));
    const { findings, allowedRenamed } = DRI.evaluate({ refs, allowlist: NO_ALLOW, legacyRename: tol });
    assert.deepStrictEqual(findings.map((f) => f.target), [MOVED], `${label}: the citation must be a broken ref again`);
    assert.match(findings[0].message, /legacy-rename tolerance is OFF/, label);
    assert.strictEqual(allowedRenamed, 0, label);
  }
});

test(`${FALSIFIER_ID} RED+GREEN (real disk path): the counterpart-absent citation fails --enforce; the counterpart-present one is counted`, () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "dri-legacy-rename-"));
  try {
    const counterpart = renamePath(MOVED);
    fs.mkdirSync(path.dirname(path.join(proj, ...counterpart.split("/"))), { recursive: true });
    fs.writeFileSync(path.join(proj, ...counterpart.split("/")), "// the renamed file\n");
    fs.writeFileSync(path.join(proj, "CLAUDE.md"), `moved: \`${MOVED}\`\ngone: [g](${GONE})\n`);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };
    delete env.NODE_TEST_CONTEXT;

    const r = spawnSync(process.execPath, [CHECK_FILE, "--json"], { env, encoding: "utf8" });
    let out;
    try {
      out = JSON.parse(r.stdout);
    } catch (e) {
      assert.fail(`expected JSON (${e.message}): ${r.stdout}\n${r.stderr}`);
    }
    assert.strictEqual(out.fatal, false, r.stdout);
    assert.strictEqual(out.legacyRename.active, true, out.legacyRename.reason);
    assert.deepStrictEqual(out.findings.map((f) => f.target), [GONE], "ONLY the counterpart-absent citation is broken");
    assert.strictEqual(out.allowedRenamed, 1);
    assert.ok(out.allowed.some((a) => a.target === MOVED && a.renamed === true), "the counterpart-present citation is allowed-renamed");

    const enforced = spawnSync(process.execPath, [CHECK_FILE, "--enforce"], { env, encoding: "utf8" });
    assert.strictEqual(enforced.status, 1, `--enforce must block on the counterpart-absent citation: ${enforced.stdout}${enforced.stderr}`);
    assert.match(enforced.stderr, /1 allowed-renamed/, "the allowed-renamed count is printed, never silent");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
