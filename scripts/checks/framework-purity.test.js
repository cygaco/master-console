#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for framework-purity.js. Proves:
 *   - a clean string produces no findings of any kind,
 *   - the HARD client-slug detector FAILS the gate on a planted slug (P5.3),
 *   - the report-only DOMAIN-VOCAB advisory DETECTS a planted origin-product
 *     identifier (debitRockets / untrusted_job_data / masterResume /
 *     targetedResumes) — and, being advisory, does NOT flip the exit code.
 *
 *   node scripts/checks/framework-purity.test.js
 */

const assert = require("assert");
const { harness } = require("./lib/fixture-harness");
const { scanContent, CLIENT_SLUGS } = require("./framework-purity");
// The planted slug comes from the detector's own list so this test never carries a
// private product name literally (the gate scans this file too).
const SLUG = CLIENT_SLUGS[0];
const slug = CLIENT_SLUGS[1];

const h = harness("framework-purity");

// Helper: scan a single (path, content) pair and return the findings buckets.
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

// ── Known-answer: a clean, product-neutral string trips nothing ──────────
h.pass("clean framework-neutral text produces no findings", () => {
  const f = scan("docs/x.md", "Resume the build, charge credits via chargeCredits(), parse the primary input document.");
  // Note: the English word "resume" (continue-work) and the generic
  // chargeCredits() must NOT trip any detector — that's the whole point.
  return (
    f.client_slug.length === 0 &&
    f.abs_path.length === 0 &&
    f.promote_relic.length === 0 &&
    f.domain_vocab.length === 0
  );
});

// ── PLANTED HARD VIOLATION: a client slug must FAIL the gate (P5.3) ──────
h.violation("a planted client slug is a hard finding (fails the gate)", () => {
  const f = scan("docs/leak.md", `This file mentions ${SLUG} by name.`);
  return f.client_slug; // non-empty array ⇒ isPass() returns false ⇒ counted as the required planted-violation
});

// ── PATH-SCOPED EXEMPTION: an epic tracker legitimately NAMES the product it documents
// de-contaminating (ALLOW_CLIENT_SLUG_PATHS, same class as ROADMAP). This is PATH-scoped, NOT
// a slug-detector weakening — the SAME slug in a non-exempt canonical path (docs/leak.md above)
// still FAILS. Guards against the false-positive that blocked the W5 reconcile commit.
h.test("an epic tracker is EXEMPT for a client slug (it documents removing it) — but a non-exempt path is NOT", () => {
  const exempt = scan(
    "trackers/epics/E-DISPATCH-PERFECT-001-perfecting-agent-dispatch.md",
    `Remaining: sweep ${slug} vocab from the contaminated specs (~40 residual ${slug} occurrences).`,
  );
  assert.strictEqual(exempt.client_slug.length, 0, "an epic tracker naming the slug it removes must be exempt (path-scoped)");
  const planExempt = scan("_planning/epics/E-DISPATCH-PERFECT-001.md", `The ${slug} genericization plan.`);
  assert.strictEqual(planExempt.client_slug.length, 0, "the plan-artifact mirror is exempt too");
  // The SAME slug in a non-exempt canonical path still fails — proving this is path-scoped.
  const notExempt = scan("docs/some-canonical-doc.md", `This canonical doc mentions ${SLUG}.`);
  assert.ok(notExempt.client_slug.length > 0, "a non-exempt canonical path with the SAME slug must STILL fail (not a slug-detector weakening)");
});

// ── PLANTED ADVISORY: each banned domain identifier is DETECTED ──────────
h.test("debitRockets is flagged by the domain-vocab advisory", () => {
  const f = scan("agents/example.md", "Call debitRockets() before the model call.");
  assert.ok(
    f.domain_vocab.some((d) => d.token === "debitRockets"),
    "expected domain_vocab to flag debitRockets",
  );
  assert.strictEqual(f.client_slug.length, 0, "debitRockets must NOT be a hard client_slug");
});

h.test("untrusted_job_data / masterResume / targetedResumes are each flagged", () => {
  for (const tok of ["untrusted_job_data", "masterResume", "targetedResumes"]) {
    const f = scan("agents/ex.md", `the <${tok}> wrapper / field appears here`);
    assert.ok(
      f.domain_vocab.some((d) => d.token === tok),
      `expected domain_vocab to flag ${tok}`,
    );
  }
});

h.test("the advisory is word-bounded — a benign superstring is NOT flagged", () => {
  // "masterResumed" / "myDebitRocketsHelper" share a substring but are different
  // identifiers; the \b anchors keep the advisory from firing on them.
  const f = scan("agents/ex.md", "masterResumed and debitRocketsHelperX are unrelated symbols");
  assert.strictEqual(f.domain_vocab.length, 0, "word-boundary match must not fire on superstrings");
});

h.test("the advisory does NOT ban broad English words", () => {
  const f = scan("docs/x.md", "resume the job, scan the market, parse the resume of work");
  assert.strictEqual(f.domain_vocab.length, 0, "broad words (resume/job/market) must never be banned");
});

// ── FAIL-CLOSED: malformed input must not read green ─────────────────────
h.failClosed("null content fails closed", () => {
  // scanContent expects a string; a null content should throw rather than
  // silently pass — the harness treats a throw as an acceptable fail-closed.
  return scan("docs/x.md", null) && false;
});

h.done();
