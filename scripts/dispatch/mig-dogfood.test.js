"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dog = require("./broker-dogfood");
const { brokerMerge, buildMergeCommit } = require("./broker-merge");
const { brokerReleaseCommit } = require("./broker-release-commit");
const { makeTransportFixture, headOf, sh } = require("./falsifiers/_lib/transport-fixtures");

function scratchLedger(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mig-ledger-${tag}-`));
  return { dir, logPath: path.join(dir, "dogfood-fallbacks.jsonl"), eventsPath: path.join(dir, "events.jsonl") };
}

test("classifyRefusal — every transport trust-spine refusal classifies as SECURITY (never fallback-eligible)", () => {
  for (const r of [
    "merge-first-parent-not-live-head",
    "release-parent-not-live-head",
    "new-head-not-descendant-of-live-head",
    "result-tree-mutated-mid-run",
    "check-failed",
    "required-check-skipped",
    "missing-required-check",
    "stale-check-result",
    "lease-not-held",
    "ref-update-refused",
    "bundle-pin-mismatch",
    "bundle-lineage-mismatch",
  ]) {
    assert.equal(dog.classifyRefusal(r), "security", `${r} must be security-classified`);
    assert.equal(dog.fallbackAllowed(r), false, `${r} must NOT be fallback-eligible`);
  }
});

test("classifyRefusal — DEFAULT-DENY: an unknown/absent reason is treated as SECURITY, not operational", () => {
  for (const r of ["some-new-reason-nobody-mapped", "", null, undefined, 42, {}]) {
    assert.equal(dog.classifyRefusal(r), "security");
    assert.equal(dog.fallbackAllowed(r), false);
  }
});

test("classifyRefusal — only the enumerated OPERATIONAL reasons are fallback-eligible", () => {
  const eligible = [...dog.SECURITY_REASONS, ...dog.USAGE_REASONS, ...dog.OPERATIONAL_REASONS].filter((r) => dog.fallbackAllowed(r));
  assert.deepEqual(eligible.slice().sort(), dog.OPERATIONAL_REASONS.slice().sort());
  assert.equal(dog.classifyRefusal("bundle-load-failed"), "security");
  assert.equal(dog.classifyRefusal("result-tree-materialize-failed"), "security");
  assert.equal(dog.classifyRefusal("no-pinned-bundle-configured"), "operational");
  assert.equal(dog.classifyRefusal("bundle-pin-mismatch"), "security");
  assert.equal(dog.classifyRefusal("ref-update-error"), "operational");
  assert.equal(dog.classifyRefusal("ref-update-refused"), "security");
});

test("classification classes are disjoint — no reason can be both security and fallback-eligible", () => {
  const sec = new Set(dog.SECURITY_REASONS);
  const use = new Set(dog.USAGE_REASONS);
  for (const r of dog.OPERATIONAL_REASONS) {
    assert.equal(sec.has(r), false, `${r} is in BOTH operational and security`);
    assert.equal(use.has(r), false, `${r} is in BOTH operational and usage`);
  }
});

test("recordFallback — writes a structured record, mirrors to the events log, and increments the count", () => {
  const L = scratchLedger("record");
  assert.equal(dog.fallbackCount(L.logPath), 0);

  const first = dog.recordFallback({ transport: "branch-merge", target_ref: "refs/heads/main", reason: "no-pinned-bundle-configured", classification: "operational", fallback_route: "git merge --no-ff" }, L);
  assert.equal(first.ok, true);
  assert.equal(first.count, 1);
  assert.equal(first.record.seq, 1);
  assert.equal(first.record.schema, dog.FALLBACK_SCHEMA);
  assert.equal(dog.FALLBACK_SCHEMA, "dogfood-fallback/1");
  assert.equal(dog.FALLBACK_LOG_REL, path.join("runtime", "broker-dogfood", "dogfood-fallbacks.jsonl"));
  assert.equal(first.record.unit, "brokered-transport");
  assert.equal(first.event_mirrored, true);

  const second = dog.recordFallback({ transport: "release-commit", target_ref: "refs/heads/main", reason: "no-pinned-bundle-configured", classification: "operational", fallback_route: "git update-ref" }, L);
  assert.equal(second.count, 2);
  assert.equal(second.record.seq, 2);

  const rows = dog.readFallbacks(L.logPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].transport, "branch-merge");
  assert.equal(rows[1].transport, "release-commit");

  const evt = fs.readFileSync(L.eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(evt.length, 2);
  assert.equal(evt[0].type, "broker-dogfood-fallback");
});

test("fallbackCount — a MALFORMED ledger line is still COUNTED (under-counting is the one unsafe direction)", () => {
  const L = scratchLedger("malformed");
  fs.writeFileSync(L.logPath, '{"seq":1}\nnot json at all\n{"seq":3}\n', "utf8");
  assert.equal(dog.fallbackCount(L.logPath), 3);
  const r = dog.report(L.logPath);
  assert.equal(r.count, 3);
  assert.match(r.text, /MALFORMED LEDGER LINE/);
});

test("report — ZERO fallbacks reads as a clean claim; a non-zero count demands explanation", () => {
  const L = scratchLedger("report");
  assert.match(dog.report(L.logPath).text, /ZERO fallbacks/);
  dog.recordFallback({ transport: "branch-merge", target_ref: "refs/heads/main", reason: "no-pinned-bundle-configured", classification: "operational", fallback_route: "git update-ref" }, L);
  const t = dog.report(L.logPath).text;
  assert.match(t, /count\s*:\s*1/);
  assert.match(t, /must be individually EXPLAINED/);
});

test("attemptFallback — a SECURITY reason is REFUSED: no ledger record, no write, count unchanged", () => {
  const L = scratchLedger("sec-gate");
  const r = dog.attemptFallback({ reason: "check-failed", transport: "branch-merge", targetRef: "refs/heads/main", gitRoot: L.dir, ...L, emit: false });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.equal(r.classification, "security");
  assert.equal(r.route, "none");
  assert.equal(dog.fallbackCount(L.logPath), 0, "a refused fallback is NOT a fallback — it must not be logged as one");
});

test("attemptFallback — an UNRECORDABLE fallback does NOT happen (fallback-unrecordable, classified security)", () => {
  const L = scratchLedger("unrecordable");
  const blocked = path.join(L.dir, "blocker", "ledger.jsonl");
  fs.writeFileSync(path.join(L.dir, "blocker"), "i am a file, not a directory\n", "utf8");

  const r = dog.attemptFallback({
    reason: "no-pinned-bundle-configured",
    transport: "branch-merge",
    targetRef: "refs/heads/main",
    gitRoot: L.dir,
    logPath: blocked,
    emit: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.equal(r.reason, "fallback-unrecordable");
  assert.equal(r.classification, "security", "an invisible fallback is a silent bypass — it fails CLOSED");
  assert.equal(r.broker_reason, "no-pinned-bundle-configured");
});

test("attemptFallback — --no-fallback refuses even an operational miss, and logs nothing", () => {
  const L = scratchLedger("nofb");
  const r = dog.attemptFallback({ reason: "no-pinned-bundle-configured", transport: "release-commit", targetRef: "refs/heads/main", gitRoot: L.dir, allowFallback: false, ...L, emit: false });
  assert.equal(r.refused, true);
  assert.equal(r.reason, "fallback-disabled-by-flag");
  assert.equal(dog.fallbackCount(L.logPath), 0);
});

test("attemptFallback — a DRY RUN does NOT move the count (it PROJECTS), and writes neither ledger nor ref", () => {
  const L = scratchLedger("dry");
  const r = dog.attemptFallback({ reason: "no-pinned-bundle-configured", transport: "branch-merge", targetRef: "refs/heads/main", gitRoot: L.dir, dryRun: true, ...L, emit: false });
  assert.equal(r.ok, true);
  assert.equal(r.route, "dry-run");
  assert.equal(r.performed, false);
  assert.equal(r.recorded, false);
  assert.equal(r.count, 0, "the REAL count is untouched");
  assert.equal(r.projected_count, 1, "the projection says what it WOULD become");
  assert.equal(r.record.dry_run, true);
  assert.equal(fs.existsSync(L.logPath), false, "a dry run must not even create the ledger");
  assert.equal(fs.existsSync(L.eventsPath), false);
});

test("brokerMerge — a clean branch LANDS THROUGH THE BROKER: real receipt, ref moves, ZERO fallbacks", () => {
  const fx = makeTransportFixture("mig-land");
  const L = scratchLedger("mig-land");
  try {
    const before = fx.head("refs/heads/main");
    const res = brokerMerge({ branch: "candidate", target_ref: "refs/heads/main" }, { ...fx.opts(), emit: false }, { logPath: L.logPath, eventsPath: L.eventsPath });

    assert.equal(res.ok, true, `expected a brokered land, got: ${res.reason} ${res.detail || ""}`);
    assert.equal(res.route, "brokered", "the whole point: the write went THROUGH the transport");
    assert.equal(res.decision, "LANDED");
    assert.equal(res.receipt.transport, "branch-merge");
    assert.equal(res.receipt.previous_head, before);
    assert.equal(res.receipt.committed_head, res.merge_commit);
    assert.equal(res.receipt.provenance.source_branch_tip, fx.candidate);

    const after = fx.head("refs/heads/main");
    assert.equal(after, res.merge_commit);
    assert.notEqual(after, before);
    const parents = sh(["rev-list", "--parents", "-n", "1", after], fx.dir).split(/\s+/).slice(1);
    assert.equal(parents.length, 2);
    assert.equal(parents[0].toLowerCase(), before);
    assert.equal(parents[1].toLowerCase(), fx.candidate);

    assert.equal(dog.fallbackCount(L.logPath), 0, "a brokered land must not touch the fallback ledger");
    assert.equal(res.fallback_count, 0);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("buildMergeCommit — builds a real 2-parent merge object and moves NO ref", () => {
  const fx = makeTransportFixture("mig-build");
  try {
    const before = fx.head("refs/heads/main");
    const built = buildMergeCommit({ gitRoot: fx.dir, head: before, tip: fx.candidate, message: "probe" });
    assert.equal(built.ok, true);
    assert.match(built.sha, /^[0-9a-f]{40}$/);
    assert.equal(fx.head("refs/heads/main"), before, "building the merge object must not move main");
    assert.equal(sh(["cat-file", "-t", built.sha], fx.dir), "commit");
  } finally {
    fx.cleanup();
  }
});

test("brokerMerge — a SECURITY refusal (poisoned tree fails the pinned suite) NEVER falls back", () => {
  const fx = makeTransportFixture("mig-poison");
  const L = scratchLedger("mig-poison");
  try {
    const poisoned = fx.poisonedBranch("poison");
    const before = fx.head("refs/heads/main");

    const res = brokerMerge({ branch: "poison", target_ref: "refs/heads/main" }, { ...fx.opts(), emit: false }, { logPath: L.logPath, eventsPath: L.eventsPath });

    assert.equal(res.ok, false);
    assert.equal(res.route, "none", "a failed suite must NOT reach the ordinary route");
    assert.equal(res.classification, "security");
    assert.equal(fx.head("refs/heads/main"), before, "main must be exactly where it was");
    assert.notEqual(fx.head("refs/heads/main"), poisoned);
    assert.equal(dog.fallbackCount(L.logPath), 0, "a security refusal is not a fallback and must not be logged as one");
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerMerge — an OPERATIONAL miss FALLS BACK, and the fallback is LOGGED, COUNTED and SURFACED", () => {
  const fx = makeTransportFixture("mig-fallback", { skipHookInstall: true });
  const L = scratchLedger("mig-fallback");
  try {
    const before = fx.head("refs/heads/main");
    assert.equal(dog.fallbackCount(L.logPath), 0);

    const res = brokerMerge(
      { branch: "candidate", target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, emit: false },
      { logPath: L.logPath, eventsPath: L.eventsPath },
    );

    assert.equal(res.ok, true, `fallback should land: ${res.reason} ${res.detail || ""}`);
    assert.equal(res.decision, "LANDED-BY-FALLBACK");
    assert.equal(res.broker_reason, "no-pinned-bundle-configured");
    assert.equal(res.classification, "operational");
    assert.notEqual(res.route, "brokered", "a fallback must never be reported as brokered mileage");
    assert.notEqual(fx.head("refs/heads/main"), before);

    assert.equal(dog.fallbackCount(L.logPath), 1);
    const rows = dog.readFallbacks(L.logPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].schema, dog.FALLBACK_SCHEMA);
    assert.equal(rows[0].transport, "branch-merge");
    assert.equal(rows[0].reason, "no-pinned-bundle-configured");
    assert.equal(rows[0].classification, "operational");
    assert.equal(rows[0].target_ref, "refs/heads/main");
    assert.equal(rows[0].previous_head, before);
    assert.equal(rows[0].source_branch, "candidate");
    assert.ok(rows[0].ts && rows[0].fallback_route, "a record must carry a timestamp and the route taken");

    assert.equal(res.fallback_count, 1);
    assert.equal(res.fallback_record.seq, 1);

    const banner = dog.fallbackBanner(res.fallback_record, res.fallback_count, L.logPath);
    assert.match(banner, /DOGFOOD FALLBACK #1/);
    assert.match(banner, /WAS \*\*NOT\*\* EXERCISED/);
    assert.match(banner, /running count\s*:\s*1/);
    assert.match(banner, /no-pinned-bundle-configured \(operational\)/);
    assert.match(banner, /ZERO fallbacks/, "the banner must state the honest bar, not just the fact");
    assert.equal(/✔|success|LANDED\b/.test(banner), false, "a fallback banner must not contain success language");

    assert.match(fs.readFileSync(L.eventsPath, "utf8"), /"type":"broker-dogfood-fallback"/);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerMerge — the SECOND fallback increments the count to 2 (the count is derived from the ledger)", () => {
  const fx = makeTransportFixture("mig-fallback2", { skipHookInstall: true });
  const L = scratchLedger("mig-fallback2");
  try {
    const opts = { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, emit: false };
    const seams = { logPath: L.logPath, eventsPath: L.eventsPath };
    const a = brokerMerge({ branch: "candidate", target_ref: "refs/heads/main" }, opts, seams);
    assert.equal(a.fallback_count, 1);

    const second = fx.releaseCommit(fx.head("refs/heads/main"), "more-work");
    const b = brokerMerge({ branch: "more-work", target_ref: "refs/heads/main" }, opts, seams);
    assert.equal(b.ok, true, `${b.reason} ${b.detail || ""}`);
    assert.equal(b.fallback_count, 2, "the running count must accumulate across invocations");
    assert.equal(b.fallback_record.seq, 2);
    assert.equal(dog.readFallbacks(L.logPath).length, 2);
    assert.ok(second);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerMerge — --no-fallback makes the dogfood STRICT: an operational miss refuses and writes nothing", () => {
  const fx = makeTransportFixture("mig-strict", { skipHookInstall: true });
  const L = scratchLedger("mig-strict");
  try {
    const before = fx.head("refs/heads/main");
    const res = brokerMerge(
      { branch: "candidate", target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, allowFallback: false, emit: false },
      { logPath: L.logPath, eventsPath: L.eventsPath },
    );
    assert.equal(res.ok, false);
    assert.equal(res.route, "none");
    assert.equal(fx.head("refs/heads/main"), before);
    assert.equal(dog.fallbackCount(L.logPath), 0);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerMerge — an already-merged branch is a USAGE refusal, never a fallback", () => {
  const fx = makeTransportFixture("mig-noop");
  const L = scratchLedger("mig-noop");
  try {
    const res = brokerMerge({ branch: "main", target_ref: "refs/heads/main" }, { ...fx.opts(), emit: false }, { logPath: L.logPath, eventsPath: L.eventsPath });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "already-merged");
    assert.equal(res.classification, "usage");
    assert.equal(dog.fallbackCount(L.logPath), 0);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerMerge — the FLIP FORCING FUNCTION: with the Seam E hook live, the ordinary fallback route FAILS", () => {
  const fx = makeTransportFixture("mig-flip");
  const L = scratchLedger("mig-flip");
  try {
    const before = fx.head("refs/heads/main");
    const res = brokerMerge(
      { branch: "candidate", target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, emit: false },
      { logPath: L.logPath, eventsPath: L.eventsPath },
    );
    assert.equal(res.ok, false, "the armed fence must refuse the un-brokered fallback write");
    assert.equal(res.decision, "FALLBACK-FAILED");
    assert.equal(fx.head("refs/heads/main"), before, "and main must not move");
    assert.equal(dog.fallbackCount(L.logPath), 1);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerReleaseCommit — a staged bookkeeping change LANDS THROUGH THE BROKER as a single-parent commit", () => {
  const fx = makeTransportFixture("mig-release");
  const L = scratchLedger("mig-release");
  try {
    const before = fx.head("refs/heads/main");
    fs.writeFileSync(path.join(fx.dir, "MANIFEST.generated.json"), JSON.stringify({ regenerated: true }, null, 2));

    const res = brokerReleaseCommit(
      { message: "chore: manifest regen", add: ["MANIFEST.generated.json"], target_ref: "refs/heads/main" },
      { ...fx.opts(), emit: false },
      { logPath: L.logPath, eventsPath: L.eventsPath },
    );

    assert.equal(res.ok, true, `expected a brokered release commit, got: ${res.reason} ${res.detail || ""}`);
    assert.equal(res.route, "brokered");
    assert.equal(res.receipt.transport, "release-commit");
    assert.equal(res.receipt.previous_head, before);

    const after = fx.head("refs/heads/main");
    assert.equal(after, res.release_commit);
    const parents = sh(["rev-list", "--parents", "-n", "1", after], fx.dir).split(/\s+/).slice(1);
    assert.equal(parents.length, 1, "a bookkeeping commit is single-parent by construction");
    assert.equal(parents[0].toLowerCase(), before);
    assert.equal(dog.fallbackCount(L.logPath), 0);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerReleaseCommit — an empty index is refused as USAGE (no empty bookkeeping commits, no fallback)", () => {
  const fx = makeTransportFixture("mig-empty");
  const L = scratchLedger("mig-empty");
  try {
    const before = fx.head("refs/heads/main");
    const res = brokerReleaseCommit({ message: "chore: nothing", target_ref: "refs/heads/main" }, { ...fx.opts(), emit: false }, { logPath: L.logPath, eventsPath: L.eventsPath });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "nothing-to-commit");
    assert.equal(res.classification, "usage");
    assert.equal(fx.head("refs/heads/main"), before);
    assert.equal(dog.fallbackCount(L.logPath), 0);
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("brokerReleaseCommit — an OPERATIONAL miss falls back, LOGGED + COUNTED, and is not reported as brokered", () => {
  const fx = makeTransportFixture("mig-release-fb", { skipHookInstall: true });
  const L = scratchLedger("mig-release-fb");
  try {
    fs.writeFileSync(path.join(fx.dir, "LEDGER.md"), "# ledger\n");
    const res = brokerReleaseCommit(
      { message: "chore: ledger hygiene", add: ["LEDGER.md"], target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, emit: false },
      { logPath: L.logPath, eventsPath: L.eventsPath },
    );
    assert.equal(res.ok, true, `${res.reason} ${res.detail || ""}`);
    assert.equal(res.decision, "LANDED-BY-FALLBACK");
    assert.notEqual(res.route, "brokered");
    assert.equal(res.fallback_count, 1);
    assert.equal(dog.readFallbacks(L.logPath)[0].transport, "release-commit");
  } finally {
    fx.cleanup();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("MIG helpers are ALLOWLISTED in the main-write-broker-completeness enforcer as self-brokering", () => {
  const { ALLOWLIST } = require("../checks/main-write-broker-completeness");
  for (const rel of ["scripts/dispatch/broker-merge.js", "scripts/dispatch/broker-release-commit.js", "scripts/dispatch/broker-dogfood.js"]) {
    assert.ok(ALLOWLIST[rel], `${rel} must be allowlisted`);
    assert.match(ALLOWLIST[rel].reason, /self-brokering/i, `${rel}'s allowlist reason must name self-brokering`);
  }
});

test("turbo census — scripts/turbo/apply.js performs NO local git write (push-only surface, verified from the TRACKED source)", () => {
  const src = fs.readFileSync(path.join(dog.ROOT, "scripts", "turbo", "apply.js"), "utf8");
  assert.equal(/\bspawnSync\b|\bexecSync\b|\bexecFileSync\b|require\(["']child_process["']\)/.test(src), false, "turbo/apply.js must not spawn any process (it would be an unaudited LOCAL write surface)");
});

test("a present-but-corrupt bundle / un-materializable candidate is SECURITY and NEVER falls back", () => {
  for (const r of ["bundle-load-failed", "result-tree-materialize-failed"]) {
    assert.equal(dog.classifyRefusal(r), "security", `${r} must be security-classified`);
    assert.equal(dog.fallbackAllowed(r), false, `${r} must NOT be fallback-eligible`);
    assert.equal(dog.OPERATIONAL_REASONS.includes(r), false, `${r} must be OUT of OPERATIONAL_REASONS`);
    assert.equal(dog.SECURITY_REASONS.includes(r), true, `${r} must be listed in SECURITY_REASONS`);
  }
  assert.equal(dog.fallbackAllowed("no-pinned-bundle-configured"), true, "true absence stays operational");
  const L = scratchLedger("bundle-load-failed");
  const res = dog.attemptFallback({ reason: "bundle-load-failed", transport: "release-commit", targetRef: "refs/heads/main", gitRoot: L.dir, ...L, emit: false });
  assert.equal(res.ok, false);
  assert.equal(res.refused, true);
  assert.equal(res.classification, "security");
  assert.equal(dog.fallbackCount(L.logPath), 0, "a security refusal is not a fallback — nothing is logged");
  fs.rmSync(L.dir, { recursive: true, force: true });
});

test("a release commit built while a FEATURE branch is checked out cannot smuggle the feature snapshot onto main", () => {
  const fx = makeTransportFixture("mig-feature-snapshot");
  const Lg = scratchLedger("feature-snapshot");
  try {
    const mainHead = fx.head("refs/heads/main");
    sh(["checkout", "-b", "feature/evil"], fx.dir);
    fs.writeFileSync(path.join(fx.dir, "FEATURE_SECRET.txt"), "should never land on main\n");
    sh(["add", "FEATURE_SECRET.txt"], fx.dir);
    sh(["commit", "-m", "feature work"], fx.dir);
    fs.writeFileSync(path.join(fx.dir, "MANIFEST.generated.json"), JSON.stringify({ regenerated: true }));
    const res = brokerReleaseCommit(
      { message: "chore: manifest regen", add: ["MANIFEST.generated.json"], target_ref: "refs/heads/main" },
      { ...fx.opts(), emit: false },
      { logPath: Lg.logPath, eventsPath: Lg.eventsPath },
    );
    assert.equal(res.ok, true, `${res.reason} ${res.detail || ""}`);
    const landed = res.release_commit;
    const parents = sh(["rev-list", "--parents", "-n", "1", landed], fx.dir).split(/\s+/).slice(1);
    assert.equal(parents.length, 1, "a bookkeeping commit is single-parent");
    assert.equal(parents[0].toLowerCase(), mainHead, "parented to live main, not the feature branch");
    const treeFiles = sh(["ls-tree", "-r", "--name-only", landed], fx.dir).split(/\s+/).filter(Boolean);
    assert.ok(treeFiles.includes("MANIFEST.generated.json"), "the named bookkeeping path must be present");
    assert.equal(treeFiles.includes("FEATURE_SECRET.txt"), false, "the feature-branch snapshot must NOT leak onto main");
  } finally {
    fx.cleanup();
    fs.rmSync(Lg.dir, { recursive: true, force: true });
  }
});

test("an unreadable-but-present ledger REFUSES the fallback (fallback-unrecordable), never a count-0 bypass", () => {
  const L = scratchLedger("ledger-unreadable");
  fs.mkdirSync(L.logPath, { recursive: true });
  const rec = dog.recordFallback({ transport: "branch-merge", target_ref: "refs/heads/main", reason: "no-pinned-bundle-configured" }, { logPath: L.logPath });
  assert.equal(rec.ok, false, "an unreadable ledger cannot be counted — recordFallback must fail");
  assert.match(String(rec.error), /ledger-unreadable/);
  const res = dog.attemptFallback({ reason: "no-pinned-bundle-configured", transport: "branch-merge", targetRef: "refs/heads/main", gitRoot: L.dir, logPath: L.logPath, emit: false });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "fallback-unrecordable");
  assert.equal(res.classification, "security");
  const rep = dog.report(L.logPath);
  assert.equal(rep.unreadable, true);
  assert.match(rep.text, /UNREADABLE/);
  assert.equal(/ZERO fallbacks/.test(rep.text), false, "an unreadable ledger must never read as a clean ZERO");
  fs.rmSync(L.dir, { recursive: true, force: true });
});

test("a dogfood-ACQUIRED lease whose release FAILS surfaces the orphan, never swallows it", () => {
  let released = false;
  const fakeApi = {
    acquire: () => ({ ok: true, token: "tok-123" }),
    release: () => { released = true; throw new Error("store write denied"); },
  };
  const held = dog.ensureLease("SP-TEST", os.tmpdir(), fakeApi);
  assert.equal(held.ok, true);
  assert.equal(held.state, "acquired");
  const orig = process.stderr.write;
  let captured = "";
  process.stderr.write = (s) => { captured += s; return true; };
  let rel;
  try {
    rel = held.release();
  } finally {
    process.stderr.write = orig;
  }
  assert.equal(released, true, "the underlying release WAS attempted");
  assert.equal(rel.ok, false, "a failed release must be REPORTED, not swallowed");
  assert.match(String(rel.error), /release threw|store write denied/);
  assert.match(captured, /LEASE RELEASE FAILED/);
  assert.match(captured, /ORPHAN/i);
});

test("a clean release reports released:true; a pre-existing lease is a no-op", () => {
  const okApi = { acquire: () => ({ ok: true, token: "t" }), release: () => ({ ok: true }) };
  const held = dog.ensureLease("SP-OK", os.tmpdir(), okApi);
  assert.deepEqual(held.release(), { ok: true, released: true });
  const heldApi = { acquire: () => ({ ok: false, reason: "held" }) };
  const pre = dog.ensureLease("SP-HELD", os.tmpdir(), heldApi);
  assert.equal(pre.state, "pre-existing");
  assert.deepEqual(pre.release(), { ok: true, released: false });
});

test("resolveBundleConfig SPLITS the overlap: configured-but-missing is SECURITY, true-absence is operational", () => {
  const missing = dog.resolveBundleConfig({ bundleManifestPath: path.join(os.tmpdir(), `absent-${Date.now()}.json`) });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "bundle-load-failed", "a configured-but-missing bundle is the SECURITY reason");
  assert.equal(dog.fallbackAllowed(missing.reason), false, "and so it can never fall back");
  const absent = dog.resolveBundleConfig({});
  assert.equal(absent.reason, "no-pinned-bundle-configured");
  assert.equal(dog.fallbackAllowed(absent.reason), true, "genuine absence stays an operational fallback");
});

test("fallbackCountSafe never throws + never fabricates 0 on an unreadable ledger; fallbackCount still throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-countsafe-"));
  const logPath = path.join(dir, "dogfood-fallbacks.jsonl");
  try {
    fs.mkdirSync(logPath, { recursive: true });
    assert.deepEqual(dog.fallbackCountSafe(logPath), { count: null, unreadable: true });
    assert.throws(() => dog.fallbackCount(logPath), "the security-path read still throws on unreadable");
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "mig-countsafe-absent-"));
    assert.deepEqual(dog.fallbackCountSafe(path.join(dir2, "dogfood-fallbacks.jsonl")), { count: 0, unreadable: false });
    fs.rmSync(dir2, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a PRODUCTION dry-run (seams={}, no logPath) PROJECTS the count, never misreports as unrecordable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-dryrun-"));
  try {
    const r = dog.attemptFallback({ reason: "no-pinned-bundle-configured", transport: "branch-merge", targetRef: "refs/heads/main", gitRoot: root, dryRun: true, root, emit: false });
    assert.equal(r.ok, true, "a legitimate production dry-run must PROJECT, not error");
    assert.equal(r.route, "dry-run");
    assert.equal(r.performed, false);
    assert.equal(r.count, 0, "the real count is untouched (absent ledger = 0)");
    assert.equal(r.projected_count, 1, "projects what the count WOULD become");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
