#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const {
  verifyGauntlet,
  readCompletions,
  isWellFormedOkRecord,
} = require("./gauntlet-verify");

const {
  canonicalFile,
  AGENT_ROOT,
} = require("../dispatch-agent");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const tmpFiles = [];

function writeTempFile(content) {
  const f = path.join(os.tmpdir(), `gv-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(f, content, "utf8");
  tmpFiles.push(f);
  return f;
}

function cleanupTempFiles() {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch { }
  }
}

function makeRecord(overrides = {}) {
  return {
    role: "reviewer",
    ok: true,
    provider: "openai",
    model: "gpt-5.5",
    completed_at: new Date().toISOString(),
    ...overrides,
  };
}

test("suppressed-record: no records written → verifier fails (core case)", () => {
  const sinceMs = Date.now() - 60_000;
  const res = verifyGauntlet({
    runId: "test-suppressed",
    roles: ["reviewer"],
    since: sinceMs,
    records: [],
  });

  assert.strictEqual(res.ok, false, "ok should be false when record was suppressed");
  assert.ok(res.missingRoles.includes("reviewer"), "reviewer should be in missingRoles");
  assert.strictEqual(res.roles[0].status, "no-record", `expected no-record, got ${res.roles[0].status}`);
  assert.strictEqual(res.roles[0].satisfied, false, "should not be satisfied");
});

test("suppressed-record: one role missing → whole gauntlet fails", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["frontend-reviewer", "qa-reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({ role: "frontend-reviewer", completed_at: new Date(now).toISOString() }),
    ],
  });

  assert.strictEqual(res.ok, false, "ok should be false when qa-reviewer is missing");
  assert.ok(!res.missingRoles.includes("frontend-reviewer"), "frontend-reviewer should NOT be in missingRoles");
  assert.ok(res.missingRoles.includes("qa-reviewer"), "qa-reviewer should be in missingRoles");
});

test("valid: well-formed record → verifier passes (no false-negative)", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    runId: "test-valid",
    roles: ["reviewer"],
    since: now - 60_000,
    records: [makeRecord({ completed_at: new Date(now).toISOString() })],
  });

  assert.strictEqual(res.ok, true, `expected ok:true, got: ${JSON.stringify(res)}`);
  assert.strictEqual(res.malformedTainted, false, "should not be malformedTainted");
  assert.strictEqual(res.roles[0].status, "ran");
  assert.strictEqual(res.roles[0].satisfied, true);
  assert.strictEqual(res.roles[0].wellFormed, true);
});

test("valid: all roles well-formed → passes", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["frontend-reviewer", "qa-reviewer", "security-reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({ role: "frontend-reviewer", completed_at: new Date(now).toISOString() }),
      makeRecord({ role: "qa-reviewer",       completed_at: new Date(now).toISOString() }),
      makeRecord({ role: "security-reviewer", completed_at: new Date(now).toISOString() }),
    ],
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.malformedTainted, false);
  assert.ok(res.roles.every((r) => r.satisfied && r.wellFormed === true));
});

test("valid: legacy 'redteam' requested → satisfied by a security-reviewer record (alias bridge)", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["redteam"],
    since: now - 60_000,
    records: [makeRecord({ role: "security-reviewer", completed_at: new Date(now).toISOString() })],
  });
  assert.strictEqual(res.ok, true, "redteam→security-reviewer alias must bridge the record");
  assert.strictEqual(res.roles[0].role, "security-reviewer", "requested role normalizes to canonical");
  assert.strictEqual(res.roles[0].status, "ran");
});

test("malformed: malformed line in window → fail-CLOSED (ok=false, malformedTainted=true)", () => {
  const now = Date.now();
  const validRecord = makeRecord({ completed_at: new Date(now).toISOString() });
  const tmpFile = writeTempFile(
    `{NOT VALID JSON — corrupt line}\n${JSON.stringify(validRecord)}\n`,
  );

  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    completionsFile: tmpFile,
  });

  assert.strictEqual(res.ok, false, "ok should be false with malformed line + window active");
  assert.strictEqual(res.malformedTainted, true, "malformedTainted should be true");
  assert.ok(res.malformedLines >= 1, `expected >=1 malformed lines, got ${res.malformedLines}`);
});

test("malformed: no window + malformed line → fail-closed (malformed always taints)", () => {
  const now = Date.now();
  const validRecord = makeRecord({ completed_at: new Date(now).toISOString() });
  const tmpFile = writeTempFile(
    `{NOT VALID JSON}\n${JSON.stringify(validRecord)}\n`,
  );

  const res = verifyGauntlet({
    roles: ["reviewer"],
    completionsFile: tmpFile,
  });

  assert.strictEqual(res.malformedTainted, true, "malformed without window should taint");
  assert.ok(res.malformedLines >= 1, "malformed lines should still be counted/surfaced");
  assert.strictEqual(res.ok, false, "ok should be false due to malformed taint");
});

test("readCompletions: counts malformed lines and returns them separately", () => {
  const tmpFile = writeTempFile(
    `{"role":"reviewer","ok":true,"provider":"openai","completed_at":"2026-01-01T00:00:00Z"}\n` +
    `{BROKEN\n` +
    `another broken line\n` +
    `{"role":"qa","ok":true,"provider":"gemini","completed_at":"2026-01-01T00:00:01Z"}\n`,
  );

  const { records, malformed, missing } = readCompletions(tmpFile);
  assert.strictEqual(missing, false);
  assert.strictEqual(records.length, 2, "should parse 2 valid records");
  assert.strictEqual(malformed, 2, "should count 2 malformed lines");
});

test("ill-typed: ok:true missing provider → not counted as ran → fail-closed", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      {
        role: "reviewer",
        ok: true,
        completed_at: new Date(now).toISOString(),
      },
    ],
  });

  assert.strictEqual(res.ok, false, "ok should be false for ill-typed record");
  assert.strictEqual(res.malformedTainted, true, "malformedTainted should be true for ill-typed");
  assert.strictEqual(res.roles[0].status, "ill-typed", `expected ill-typed, got ${res.roles[0].status}`);
  assert.strictEqual(res.roles[0].wellFormed, false);
  assert.strictEqual(res.roles[0].satisfied, false);
});

test("ill-typed: ok:true missing timestamp → not counted as ran", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      {
        role: "reviewer",
        ok: true,
        provider: "openai",
      },
    ],
  });

  assert.strictEqual(res.ok, false, "ok should be false when timestamp is missing");
  const status = res.roles[0].status;
  assert.ok(
    status === "ill-typed" || status === "no-record",
    `expected ill-typed or no-record, got ${status}`,
  );
});

test("ill-typed: ok:true garbage provider → not counted as ran", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      {
        role: "reviewer",
        ok: true,
        provider: "",
        completed_at: new Date(now).toISOString(),
      },
    ],
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.roles[0].status, "ill-typed");
  assert.strictEqual(res.roles[0].wellFormed, false);
});

test("isWellFormedOkRecord: accepts fully-formed record", () => {
  assert.strictEqual(
    isWellFormedOkRecord({
      role: "reviewer",
      ok: true,
      provider: "openai",
      completed_at: "2026-01-01T00:00:00Z",
    }),
    true,
  );
});

test("isWellFormedOkRecord: rejects ok:false", () => {
  assert.strictEqual(
    isWellFormedOkRecord({ role: "reviewer", ok: false, provider: "openai", completed_at: "2026-01-01T00:00:00Z" }),
    false,
  );
});

test("isWellFormedOkRecord: rejects missing provider", () => {
  assert.strictEqual(
    isWellFormedOkRecord({ role: "reviewer", ok: true, completed_at: "2026-01-01T00:00:00Z" }),
    false,
  );
});

test("isWellFormedOkRecord: rejects missing timestamp", () => {
  assert.strictEqual(
    isWellFormedOkRecord({ role: "reviewer", ok: true, provider: "openai" }),
    false,
  );
});

test("isWellFormedOkRecord: accepts started_at as timestamp fallback", () => {
  assert.strictEqual(
    isWellFormedOkRecord({ role: "reviewer", ok: true, provider: "openai", started_at: "2026-01-01T00:00:00Z" }),
    true,
  );
});

test("isWellFormedOkRecord: rejects null", () => {
  assert.strictEqual(isWellFormedOkRecord(null), false);
});

test("stale: only pre-since records → window filter drops them → no-record → fail", () => {
  const sinceMs = Date.now();
  const staleMs = sinceMs - 120_000;

  const res = verifyGauntlet({
    runId: "test-stale",
    roles: ["reviewer"],
    since: sinceMs,
    records: [
      makeRecord({ completed_at: new Date(staleMs).toISOString() }),
    ],
  });

  assert.strictEqual(res.ok, false, "stale record should not satisfy");
  assert.strictEqual(
    res.roles[0].status,
    "no-record",
    `expected no-record for stale record, got ${res.roles[0].status}`,
  );
  assert.strictEqual(res.considered, 0, "stale record should not be in considered");
});

test("stale: record after `until` → filtered out → no-record → fail", () => {
  const untilMs = Date.now() - 10_000;
  const futureMs = untilMs + 60_000;

  const res = verifyGauntlet({
    roles: ["reviewer"],
    until: untilMs,
    records: [
      makeRecord({ completed_at: new Date(futureMs).toISOString() }),
    ],
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.roles[0].status, "no-record");
  assert.strictEqual(res.considered, 0);
});

test("stale: record inside window is considered → ran → ok", () => {
  const sinceMs = Date.now() - 60_000;
  const untilMs = Date.now() + 10_000;
  const inWindowMs = Date.now() - 5_000;

  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: sinceMs,
    until: untilMs,
    records: [
      makeRecord({ completed_at: new Date(inWindowMs).toISOString() }),
    ],
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.roles[0].status, "ran");
  assert.strictEqual(res.considered, 1);
});

test("cwd-regression: canonicalFile returns AGENT_ROOT-anchored path when PATHS points to a different root (worktree)", () => {
  const fakeWorktreePath = path.join(
    os.tmpdir(),
    "fake-worktree",
    ".claude",
    "runtime",
    "dispatch-completions.jsonl",
  );

  const result = canonicalFile(fakeWorktreePath, path.join(".claude", "runtime", "dispatch-completions.jsonl"));

  const expectedPath = path.join(AGENT_ROOT, ".claude", "runtime", "dispatch-completions.jsonl");

  assert.strictEqual(
    path.normalize(result).toLowerCase(),
    path.normalize(expectedPath).toLowerCase(),
    `Expected AGENT_ROOT-anchored path:\n  ${expectedPath}\nGot:\n  ${result}`,
  );
});

test("cwd-regression: canonicalFile accepts PATHS value when it IS under AGENT_ROOT (CLAUDE_PROJECT_DIR set correctly)", () => {
  const correctPath = path.join(
    AGENT_ROOT,
    ".claude",
    "runtime",
    "dispatch-completions.jsonl",
  );

  const result = canonicalFile(correctPath, path.join(".claude", "runtime", "dispatch-completions.jsonl"));

  assert.strictEqual(
    path.normalize(result).toLowerCase(),
    path.normalize(correctPath).toLowerCase(),
    `Expected correct PATHS value to be preserved:\n  ${correctPath}\nGot:\n  ${result}`,
  );
});

test("cwd-regression: canonicalFile falls back when pathsValue is undefined/null", () => {
  const expectedPath = path.join(AGENT_ROOT, ".claude", "runtime", "dispatch-deaths.jsonl");

  const result1 = canonicalFile(undefined, path.join(".claude", "runtime", "dispatch-deaths.jsonl"));
  const result2 = canonicalFile(null, path.join(".claude", "runtime", "dispatch-deaths.jsonl"));

  assert.strictEqual(
    path.normalize(result1).toLowerCase(),
    path.normalize(expectedPath).toLowerCase(),
    "undefined pathsValue should use AGENT_ROOT fallback",
  );
  assert.strictEqual(
    path.normalize(result2).toLowerCase(),
    path.normalize(expectedPath).toLowerCase(),
    "null pathsValue should use AGENT_ROOT fallback",
  );
});

test("cwd-regression: canonicalFile falls back when pathsValue is a relative string", () => {
  const result = canonicalFile(
    ".claude/runtime/dispatch-completions.jsonl",
    path.join(".claude", "runtime", "dispatch-completions.jsonl"),
  );

  assert.ok(
    path.isAbsolute(result),
    `canonicalFile must return an absolute path, got: ${result}`,
  );

  const expectedPath = path.join(AGENT_ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
  assert.strictEqual(
    path.normalize(result).toLowerCase(),
    path.normalize(expectedPath).toLowerCase(),
  );
});

test("backward-compat: result shape is a superset of the original shape", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [makeRecord({ completed_at: new Date(now).toISOString() })],
  });

  assert.ok("ok" in res);
  assert.ok("runId" in res);
  assert.ok("window" in res);
  assert.ok("completionsFile" in res);
  assert.ok("ledgerMissing" in res);
  assert.ok("malformedLines" in res);
  assert.ok("considered" in res);
  assert.ok("roles" in res);
  assert.ok("missingRoles" in res);

  assert.ok("malformedTainted" in res, "malformedTainted should be present");

  assert.ok("wellFormed" in res.roles[0], "wellFormed should be present per-role");
});

test("fell-back: satisfies gauntlet by default, fails with --strict-fallback", () => {
  const now = Date.now();
  const fbRecord = makeRecord({
    completed_at: new Date(now).toISOString(),
    fallback: true,
  });

  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [fbRecord],
  });

  assert.strictEqual(res.ok, true, "fell-back should satisfy by default");
  assert.strictEqual(res.roles[0].status, "fell-back");
  assert.strictEqual(res.roles[0].wellFormed, true, "fell-back well-formed record is wellFormed:true");

  const resStrict = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [fbRecord],
    strictFallback: true,
  });

  assert.strictEqual(resStrict.ok, false, "fell-back should fail with strictFallback:true");
});

test("far-future completed_at + only `since` → excluded → no-record → ok:false", () => {
  const now = Date.now();
  const futureMs = now + 365 * 24 * 60 * 60 * 1000;
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({
        role: "reviewer",
        completed_at: new Date(futureMs).toISOString(),
      }),
    ],
  });

  assert.strictEqual(res.ok, false, "far-future record must be excluded (no Golden Ticket)");
  assert.strictEqual(res.roles[0].status, "no-record", "future record should be filtered out");
  assert.strictEqual(res.considered, 0, "future record must not appear in considered");
});

test("record at 'now' with since in the past → still in-window → ok:true", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({
        role: "reviewer",
        completed_at: new Date(now).toISOString(),
      }),
    ],
  });

  assert.strictEqual(res.ok, true, "record at now must NOT be wrongly excluded");
  assert.strictEqual(res.roles[0].status, "ran");
  assert.strictEqual(res.considered, 1);
});

test("skew-false-red regression: record 5 min ahead of verifier + --since only → accepted → ok:true", () => {
  const now = Date.now();
  const skewedMs = now + 5 * 60 * 1000;
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({
        role: "reviewer",
        completed_at: new Date(skewedMs).toISOString(),
      }),
    ],
  });

  assert.strictEqual(res.ok, true, "5-min skewed record must NOT be false-red'd — legit clock skew within 24h allowance");
  assert.strictEqual(res.roles[0].status, "ran", "role must be satisfied");
  assert.strictEqual(res.considered, 1, "skewed record must appear in considered");
});

test("golden-ticket still blocked: year-9999 completed_at → excluded → ok:false", () => {
  const now = Date.now();
  const yearNineNineNineMs = new Date("9999-01-01T00:00:00Z").getTime();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      makeRecord({
        role: "reviewer",
        completed_at: new Date(yearNineNineNineMs).toISOString(),
      }),
    ],
  });

  assert.strictEqual(res.ok, false, "year-9999 record must still be excluded — Golden Ticket blocked");
  assert.strictEqual(res.roles[0].status, "no-record", "year-9999 record must be filtered");
  assert.strictEqual(res.considered, 0, "year-9999 record must not appear in considered");
});

test("malformed line BEFORE in-window records → historic → no taint → ok:true", () => {
  const now = Date.now();
  const validRecord = makeRecord({
    role: "reviewer",
    completed_at: new Date(now).toISOString(),
  });
  const oldRecord1 = makeRecord({
    role: "reviewer",
    completed_at: new Date(now - 120_000).toISOString(),
  });
  const oldRecord2 = makeRecord({
    role: "reviewer",
    completed_at: new Date(now - 90_000).toISOString(),
  });
  const tmpFile = writeTempFile(
    `{NOT VALID JSON — historic corruption, clearly separated}\n` +
    `${JSON.stringify(oldRecord1)}\n` +
    `${JSON.stringify(oldRecord2)}\n` +
    `${JSON.stringify(validRecord)}\n`,
  );

  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    completionsFile: tmpFile,
  });

  assert.strictEqual(res.ok, true, "historic malformed line (clearly separated before window records) must NOT taint");
  assert.strictEqual(res.malformedTainted, false, "malformedTainted must be false for clearly-pre-window corruption");
  assert.ok(res.malformedLines >= 1, "malformed count must still be surfaced for observability");
  assert.strictEqual(res.roles[0].status, "ran");
});

test("malformed line AFTER in-window records → in-scope → tainted → ok:false", () => {
  const now = Date.now();
  const validRecord = makeRecord({
    role: "reviewer",
    completed_at: new Date(now).toISOString(),
  });
  const tmpFile = writeTempFile(
    `${JSON.stringify(validRecord)}\n{NOT VALID JSON — crash mid-write}\n`,
  );

  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    completionsFile: tmpFile,
  });

  assert.strictEqual(res.ok, false, "malformed line after in-window records must taint");
  assert.strictEqual(res.malformedTainted, true, "malformedTainted must be true for in-scope corruption");
  assert.ok(res.malformedLines >= 1);
});

test("role with only failed record + allowFailed:true → NOT satisfied → ok:false", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    allowFailed: true,
    records: [
      {
        role: "reviewer",
        ok: false,
        provider: "openai",
        completed_at: new Date(now).toISOString(),
      },
    ],
  });

  assert.strictEqual(res.ok, false, "--allow-failed must not green a pure-failed role");
  assert.strictEqual(res.roles[0].status, "failed");
  assert.strictEqual(res.roles[0].satisfied, false, "satisfied must be false for pure-failed");
  assert.ok(res.missingRoles.includes("reviewer"), "reviewer must be in missingRoles");
});

test("failed attempt then well-formed ran record → satisfied (best-outcome-wins unaffected)", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    since: now - 60_000,
    records: [
      {
        role: "reviewer",
        ok: false,
        provider: "openai",
        completed_at: new Date(now - 30_000).toISOString(),
      },
      makeRecord({
        role: "reviewer",
        completed_at: new Date(now).toISOString(),
      }),
    ],
  });

  assert.strictEqual(res.ok, true, "well-formed success after a failure must still satisfy");
  assert.strictEqual(res.roles[0].status, "ran", "best-outcome-wins: ran beats failed");
  assert.strictEqual(res.roles[0].satisfied, true);
});

test("verifyGauntlet({roles:[]}) → ok:false with noRolesRequested:true (no vacuous green)", () => {
  const res = verifyGauntlet({ roles: [] });
  assert.strictEqual(res.ok, false, "empty roles must yield ok:false — no vacuous green");
  assert.strictEqual(res.noRolesRequested, true, "noRolesRequested flag must be set");
  assert.strictEqual(res.roles.length, 0, "roles array must be empty");
  assert.strictEqual(res.missingRoles.length, 0, "missingRoles must be empty (not applicable)");
});

test("cwd-regression real: canonicalFile is cwd-independent after chdir + CLAUDE_PROJECT_DIR deleted", () => {
  const originalCwd = process.cwd();
  const originalEnvValue = process.env.CLAUDE_PROJECT_DIR;
  let tmpDir;

  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-wt-cwd-"));

    process.chdir(tmpDir);
    delete process.env.CLAUDE_PROJECT_DIR;

    const fakeWorktreePath = path.join(
      tmpDir,
      ".claude",
      "runtime",
      "dispatch-completions.jsonl",
    );
    const result = canonicalFile(
      fakeWorktreePath,
      path.join(".claude", "runtime", "dispatch-completions.jsonl"),
    );

    const expectedPath = path.join(AGENT_ROOT, ".claude", "runtime", "dispatch-completions.jsonl");

    assert.ok(
      path.isAbsolute(result),
      `canonicalFile must return an absolute path, got: ${result}`,
    );
    assert.notStrictEqual(
      path.normalize(result).toLowerCase(),
      path.normalize(fakeWorktreePath).toLowerCase(),
      "result must NOT be the worktree-cwd-derived path",
    );
    assert.strictEqual(
      path.normalize(result).toLowerCase(),
      path.normalize(expectedPath).toLowerCase(),
      `Expected AGENT_ROOT-anchored path regardless of cwd:\n  ${expectedPath}\nGot:\n  ${result}`,
    );
  } finally {
    process.chdir(originalCwd);
    if (originalEnvValue !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = originalEnvValue;
    } else {
      delete process.env.CLAUDE_PROJECT_DIR;
    }
    if (tmpDir) {
      try { fs.rmdirSync(tmpDir); } catch { }
    }
  }
});

test("sprint-id: record with wrong sprint_id → excluded even if in window → no-record → fail", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-991",
    since: now - 60_000,
    records: [
      makeRecord({
        sprint_id: "SP-OLD-991",
        completed_at: new Date(now).toISOString(),
      }),
    ],
  });
  assert.strictEqual(res.ok, false, "wrong sprint_id record must not satisfy");
  assert.strictEqual(res.roles[0].status, "no-record", `expected no-record, got ${res.roles[0].status}`);
  assert.strictEqual(res.considered, 0, "wrong-sprint record must not appear in considered");
});

test("sprint-id: record with matching sprint_id -> included -> ran -> pass", () => {
  const now = Date.now();
  const res = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-991",
    since: now - 60_000,
    records: [
      makeRecord({
        sprint_id: "SP-NEW-991",
        completed_at: new Date(now).toISOString(),
      }),
    ],
  });
  assert.strictEqual(res.ok, true, "matching sprint_id + in-window record must satisfy");
  assert.strictEqual(res.roles[0].status, "ran");
  assert.strictEqual(res.considered, 1);
});

test("sprint-id: record without sprint_id field -> time-window applies -> included if in window", () => {
  const now = Date.now();
  const rec = makeRecord({ completed_at: new Date(now).toISOString() });
  delete rec.sprint_id;
  const res = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-991",
    since: now - 60_000,
    records: [rec],
  });
  assert.strictEqual(res.ok, true, "record without sprint_id should fall through to time-window (backwards compat)");
  assert.strictEqual(res.roles[0].status, "ran");
});

test("planted: historic-only record (outside window+wrong sprint) fails; fresh correlated record passes", () => {
  const now = Date.now();
  const historicMs = now - 24 * 60 * 60 * 1000 - 60_000;

  const resFail = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-992",
    since: now - 60_000,
    records: [
      makeRecord({ sprint_id: "SP-OLD-992", completed_at: new Date(historicMs).toISOString() }),
    ],
  });
  assert.strictEqual(resFail.ok, false, "historic record from a different sprint must fail");
  assert.strictEqual(resFail.roles[0].status, "no-record");

  const resPass = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-992",
    since: now - 60_000,
    records: [
      makeRecord({ sprint_id: "SP-NEW-992", completed_at: new Date(now).toISOString() }),
    ],
  });
  assert.strictEqual(resPass.ok, true, "fresh correlated record must pass");
  assert.strictEqual(resPass.roles[0].status, "ran");
});

test("--sprint alone (no window) + sprint_id-less historic record -> NOT counted -> fail", () => {
  const historicMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const rec = makeRecord({ completed_at: new Date(historicMs).toISOString() });
  delete rec.sprint_id;
  const res = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-NEVER-RAN",
    records: [rec],
  });
  assert.strictEqual(res.ok, false, "sprint-only correlation must NOT count sprint_id-less records");
  assert.strictEqual(res.roles[0].status, "no-record");
});

test("--sprint alone (no window) + MATCHING stamped record -> counted -> pass", () => {
  const res = verifyGauntlet({
    roles: ["reviewer"],
    sprintId: "SP-NEW-993",
    records: [
      makeRecord({ sprint_id: "SP-NEW-993", completed_at: new Date(Date.now()).toISOString() }),
    ],
  });
  assert.strictEqual(res.ok, true, "sprint-only correlation counts records stamped with the matching sprint_id");
  assert.strictEqual(res.roles[0].status, "ran");
});

test("garbage --since value (no --sprint) -> exit 2, not whole-ledger scan", () => {
  const r = cp.spawnSync(
    process.execPath,
    [path.join(__dirname, "gauntlet-verify.js"), "--roles", "reviewer", "--since", "not-a-date"],
    { encoding: "utf8" },
  );
  assert.strictEqual(r.status, 2, `Expected exit 2 on garbage --since, got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(
    /not a parseable timestamp/i.test(r.stderr),
    `Expected parseability refusal message, got: ${r.stderr}`,
  );
});

test("garbage --until value (no --sprint) -> exit 2, not whole-ledger scan", () => {
  const r = cp.spawnSync(
    process.execPath,
    [path.join(__dirname, "gauntlet-verify.js"), "--roles", "reviewer", "--until", "definitely!!unparseable"],
    { encoding: "utf8" },
  );
  assert.strictEqual(r.status, 2, `Expected exit 2 on garbage --until, got ${r.status}. stderr: ${r.stderr}`);
});

test("CLI: no --sprint, no --since, no --until -> exit 2 (refuse unbounded)", () => {
  const r = cp.spawnSync(
    process.execPath,
    [path.join(__dirname, "gauntlet-verify.js"), "--roles", "reviewer"],
    { encoding: "utf8" },
  );
  assert.strictEqual(r.status, 2, `Expected exit 2 (refuse unbounded), got ${r.status}. stderr: ${r.stderr}`);
  assert.ok(
    r.stderr.toLowerCase().includes("unbounded"),
    `Expected 'unbounded' in stderr, got: ${r.stderr}`,
  );
});

test("CLI: --roles + --sprint (no since/until) -> NOT refused by correlation check", () => {
  const r = cp.spawnSync(
    process.execPath,
    [path.join(__dirname, "gauntlet-verify.js"), "--roles", "reviewer", "--sprint", "SP-TEST-991"],
    { encoding: "utf8" },
  );
  assert.notStrictEqual(r.status, 2, `Should NOT exit 2 (correlation satisfied by --sprint); got ${r.status} stderr=${r.stderr}`);
});

test("CLI: --roles + --since (no sprint/until) -> NOT refused (has window)", () => {
  const r = cp.spawnSync(
    process.execPath,
    [
      path.join(__dirname, "gauntlet-verify.js"),
      "--roles", "reviewer",
      "--since", new Date(Date.now() - 60_000).toISOString(),
    ],
    { encoding: "utf8" },
  );
  assert.notStrictEqual(r.status, 2, `Should NOT exit 2 (has --since); got ${r.status} stderr=${r.stderr}`);
});

cleanupTempFiles();

if (failures.length) {
  process.stderr.write(
    `\nganutlet-verify bite-test: ${passed} passed, ${failures.length} FAILED\n`,
  );
  for (const f of failures) {
    process.stderr.write(`  FAIL: ${f}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `gauntlet-verify bite-test: ${passed}/${passed} passed\n` +
  `  covers: suppressed-record, valid, malformed, ill-typed, stale, cwd-regression, backward-compat\n` +
  `  future-clamp + skew-false-red-regression + golden-ticket-still-blocked; positional-taint(a,b,c); no-green-from-pure-failed; empty-roles; real-cwd-regression\n` +
  `  sprint-id-correlation + historic-green-prevention + CLI-refuse-unbounded\n`,
);
process.exit(0);
