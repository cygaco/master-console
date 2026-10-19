"use strict";

function countOf(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function run(ctx) {
  const env = ctx && typeof ctx === "object" ? ctx.envelope : undefined;
  if (!env || typeof env !== "object") {
    return { status: "skipped", reason: "no-envelope-in-context", evidence: {} };
  }
  const status = env.status;
  const filesCount = countOf(env.files);
  const commitsCount = countOf(env.commits);
  const testsCount = countOf(env.tests);
  const evidenceCount = countOf(env.evidence);
  const evidence = { status: status != null ? status : null, filesCount, commitsCount, testsCount, evidenceCount };

  const looksPassed = status === "passed" || status === "pass" || status === true;
  const zeroEverything = filesCount === 0 && commitsCount === 0 && testsCount === 0 && evidenceCount === 0;

  if (looksPassed && zeroEverything) {
    return { status: "fail", reason: "false-green-envelope-zero-evidence", evidence };
  }
  return { status: "pass", reason: "envelope-has-observable-work-or-is-not-a-success-claim", evidence };
}

module.exports = { name: "false-green-envelope", run };
