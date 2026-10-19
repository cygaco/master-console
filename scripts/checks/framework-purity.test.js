#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { harness } = require("./lib/fixture-harness");
const fs = require("fs");
const os = require("os");
const path = require("path");
const slugsDir = fs.mkdtempSync(path.join(os.tmpdir(), "purity-slugs-"));
const slugsFile = path.join(slugsDir, "slugs.json");
fs.writeFileSync(slugsFile, JSON.stringify({ clientSlugs: ["zorblat-product", "quenneville-app"] }));
require("../hooks/lib/mc-env").setEnv("PURITY_SLUGS_FILE", slugsFile);
const vocabFile = path.join(slugsDir, "domain-vocab.json");
fs.writeFileSync(vocabFile, JSON.stringify({ domainVocab: ["zorblatWidget", { label: "quux credits", pattern: "\\bquux[- ]credits\\b", flags: "i" }] }));
require("../hooks/lib/mc-env").setEnv("PURITY_VOCAB_FILE", vocabFile);
const { scanContent, CLIENT_SLUGS, loadDomainVocab, DOMAIN_VOCAB } = require("./framework-purity");
const SLUG = CLIENT_SLUGS[0];
const slug = CLIENT_SLUGS[1];

const h = harness("framework-purity");

function scan(rel, content) {
  const findings = {
    root_leak: [],
    client_slug: [],
    abs_path: [],
    promote_relic: [],
    domain_vocab: [],
  };
  scanContent(rel, content, findings);
  return findings;
}

h.pass("clean framework-neutral text produces no findings", () => {
  const f = scan("docs/x.md", "Resume the build, charge credits via chargeCredits(), parse the primary input document.");
  return (
    f.client_slug.length === 0 &&
    f.abs_path.length === 0 &&
    f.promote_relic.length === 0 &&
    f.domain_vocab.length === 0
  );
});

h.violation("a planted client slug is a hard finding (fails the gate)", () => {
  const f = scan("docs/leak.md", `This file mentions ${SLUG} by name.`);
  return f.client_slug;
});

h.test("an epic tracker is EXEMPT for a client slug (it documents removing it) — but a non-exempt path is NOT", () => {
  const exempt = scan(
    "trackers/epics/E-EXAMPLE-001-perfecting-agent-dispatch.md",
    `Remaining: sweep ${slug} vocab from the contaminated specs (~40 residual ${slug} occurrences).`,
  );
  assert.strictEqual(exempt.client_slug.length, 0, "an epic tracker naming the slug it removes must be exempt (path-scoped)");
  const planExempt = scan("_planning/epics/E-EXAMPLE-001.md", `The ${slug} genericization plan.`);
  assert.strictEqual(planExempt.client_slug.length, 0, "the plan-artifact mirror is exempt too");
  const notExempt = scan("docs/some-canonical-doc.md", `This canonical doc mentions ${SLUG}.`);
  assert.ok(notExempt.client_slug.length > 0, "a non-exempt canonical path with the SAME slug must STILL fail (not a slug-detector weakening)");
});

h.test("the lane is loaded from the local term file", () => {
  assert.strictEqual(DOMAIN_VOCAB.status, "loaded");
  assert.strictEqual(DOMAIN_VOCAB.terms.length, 2);
});

h.test("a plain local term is flagged by the domain-vocab advisory", () => {
  const f = scan("agents/example.md", "Call zorblatWidget() before the model call.");
  assert.ok(f.domain_vocab.some((d) => d.token === "zorblatWidget"), "expected domain_vocab to flag the fixture term");
  assert.strictEqual(f.client_slug.length, 0, "a domain term must NOT be a hard client_slug");
});

h.test("a pattern local term is flagged under its label", () => {
  const f = scan("agents/ex.md", "Each feature spends Quux-Credits per use.");
  assert.ok(f.domain_vocab.some((d) => d.token === "quux credits"), "expected the pattern term to fire, case-insensitive");
});

h.test("the advisory is word-bounded — a benign superstring is NOT flagged", () => {
  const f = scan("agents/ex.md", "zorblatWidgets and myzorblatWidgetX are unrelated symbols");
  assert.strictEqual(f.domain_vocab.length, 0, "word-boundary match must not fire on superstrings");
});

h.test("no local term file → the lane SKIPS with no terms", () => {
  const v = loadDomainVocab(path.join(slugsDir, "does-not-exist.json"));
  assert.strictEqual(v.terms.length, 0);
  assert.match(v.status, /^skipped/);
});

h.test("a malformed local term file → the lane SKIPS (never throws, never fails closed)", () => {
  const bad = path.join(slugsDir, "bad-vocab.json");
  fs.writeFileSync(bad, "{ \"domainVocab\": [ ");
  const v = loadDomainVocab(bad);
  assert.strictEqual(v.terms.length, 0);
  assert.match(v.status, /^skipped/);
  fs.writeFileSync(bad, JSON.stringify({ domainVocab: [{ label: "x", pattern: "(" }] }));
  assert.match(loadDomainVocab(bad).status, /^skipped/, "an invalid pattern skips too");
});

h.test("the advisory does NOT ban broad English words", () => {
  const f = scan("docs/x.md", "resume the job, scan the market, parse the resume of work");
  assert.strictEqual(f.domain_vocab.length, 0, "broad words (resume/job/market) must never be banned");
});

h.failClosed("null content fails closed", () => {
  return scan("docs/x.md", null) && false;
});

h.test("a malformed slugs file fails closed with a fixed message and no input echo", () => {
  const { spawnSync } = require("child_process");
  const marker = "zorblat-marker-xyz";
  const bad = path.join(slugsDir, "bad.json");
  fs.writeFileSync(bad, "{ \"clientSlugs\": [ " + marker);
  const r = spawnSync(process.execPath, ["-e", "require(" + JSON.stringify(path.join(__dirname, "framework-purity.js")) + ")"], {
    encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: slugsDir, MC_PURITY_SLUGS_FILE: bad, [["WARP", "OS_PURITY_SLUGS_FILE"].join("")]: bad },
  });
  assert.notStrictEqual(r.status, 0);
  const out = r.stdout + r.stderr;
  assert.ok(!out.includes(marker), "input must not be echoed");
  assert.ok(/private slugs file unreadable, malformed/.test(out), "fixed message expected");
  assert.ok(!/Unexpected|position/i.test(out), "no parser text");
});

h.done();
