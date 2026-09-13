#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// team-lifecycle.test.js — S-LC-05. Regression coverage for the persistent-team
// lifecycle manager (scripts/teams/lifecycle.js).
//
// Every case runs against an ISOLATED temp teams dir + state dir (opts.teamsRoot
// / opts.stateDir) so the REAL machine-global ~/.claude/teams (which holds other
// projects' live teams — e.g. `doogle-sprint`) is NEVER touched.
//
//   AC-5.1  Wrong-project team SURVIVES a kill  ← THE load-bearing test
//   AC-5.2  Slug filter: prefix-bleed protection
//   AC-5.3  Orphan/stale + duplicate (-N accretion) detection
//   AC-5.4  Best-effort teardown: records attempt + residual, never a guaranteed kill
//   AC-5.5  Fail-open: missing/malformed config → no throw, reconcile works
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const lifecycle = require(path.join(ROOT, "scripts", "teams", "lifecycle.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

// ── Fixture helpers ──────────────────────────────────────────────────────────
function freshDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "slc05-"));
  const teamsRoot = path.join(base, "teams");
  const stateDir = path.join(base, "runtime");
  fs.mkdirSync(teamsRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  return { base, teamsRoot, stateDir };
}

// Plant a team config.json. ageHours backdates the file mtime (stale fixtures).
function plantTeam(teamsRoot, name, members, opts = {}) {
  const dir = path.join(teamsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  const cfg = {
    name,
    leadSessionId: opts.leadSessionId || "00000000-0000-0000-0000-000000000000",
    members: members.map((m) =>
      typeof m === "string" ? { name: m, agentType: m } : m,
    ),
  };
  if (opts.raw !== undefined) fs.writeFileSync(file, opts.raw);
  else fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  if (opts.ageHours) {
    const t = Date.now() - opts.ageHours * 3_600_000;
    fs.utimesSync(file, new Date(t), new Date(t));
  }
  return { dir, file };
}

// Plant a UUID inbox-only dir (no config.json) — must be ignored by the manager.
function plantInboxDir(teamsRoot, uuid) {
  const dir = path.join(teamsRoot, uuid, "inboxes");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── AC-5.1 — THE LOAD-BEARING TEST: a wrong-project team SURVIVES a kill ──────
ok("AC-5.1 wrong-project team survives a slug-scoped teardown --apply", () => {
  const { teamsRoot, stateDir } = freshDirs();
  // This project = slug "mc". Plant OUR team + a FOREIGN team (doogle —
  // mirrors the real machine's live `doogle-sprint` that MUST NOT be killed).
  // OUR team is STALE (48h) so verifyTerminated() positively confirms it is not
  // live — only then is the handle eligible for removal under --apply. (A fresh,
  // possibly-live team is NOT removed; that is AC-5.9.)
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"], {
    ageHours: 48,
  });
  const foreign = plantTeam(teamsRoot, "doogle-sprint", [
    "team-lead",
    "beta",
    "epsilon",
  ]);

  const opts = { teamsRoot, stateDir, slug: "mc", mode: "adhoc" };
  const res = lifecycle.teardown({ ...opts, apply: true });

  // The FOREIGN team's handle is UNTOUCHED.
  assert.ok(
    fs.existsSync(foreign.file),
    "FOREIGN doogle-sprint config.json was deleted — slug filter FAILED",
  );
  // Proof the filter held: foreign team is listed as protected, never requested.
  assert.ok(
    res.foreignProtected.includes("doogle-sprint"),
    "doogle-sprint not recorded as foreignProtected",
  );
  assert.ok(
    !res.requested.some((r) => r.team === "doogle-sprint"),
    "doogle-sprint must NEVER appear in the teardown request set",
  );
  // OUR team WAS the target (handle removed under apply).
  assert.ok(
    res.requested.some((r) => r.team === "mc-adhoc" && r.handleRemoved),
    "our own team handle should have been removed under --apply",
  );
  // Honest ceiling: never a claimed guaranteed kill.
  assert.strictEqual(res.killedGuaranteed, false);
});

ok("AC-5.1b a foreign team survives even when names share a prefix root", () => {
  const { teamsRoot, stateDir } = freshDirs();
  // slug "warp" must NOT match "mc-sprint" (prefix-bleed protection).
  plantTeam(teamsRoot, "mc-sprint", ["team-lead", "beta", "epsilon"]);
  const res = lifecycle.teardown({
    teamsRoot,
    stateDir,
    slug: "warp",
    mode: "sprint",
    apply: true,
  });
  assert.ok(
    fs.existsSync(path.join(teamsRoot, "mc-sprint", "config.json")),
    "slug 'warp' bled into 'mc-sprint' — prefix-bleed protection FAILED",
  );
  assert.strictEqual(res.requested.length, 0, "no team belongs to slug 'warp'");
});

// ── AC-5.2 — slug filter unit / prefix-bleed protection ──────────────────────
ok("AC-5.2 teamBelongsToProject: exact + prefix, no bleed", () => {
  const b = lifecycle.teamBelongsToProject;
  assert.strictEqual(b("mc", "mc"), true, "exact match");
  assert.strictEqual(b("mc-sprint", "mc"), true, "<slug>- prefix");
  assert.strictEqual(b("mc-adhoc", "mc"), true);
  assert.strictEqual(b("doogle-sprint", "mc"), false, "foreign slug");
  assert.strictEqual(b("mcx-sprint", "mc"), false, "no prefix bleed (x)");
  assert.strictEqual(b("mc-sprint", "warp"), false, "no prefix bleed (warp)");
  assert.strictEqual(
    b("3c48a70b-7089-4c31-b168-06a51373d69c", "mc"),
    false,
    "unattributable UUID team is foreign (never killed)",
  );
  assert.strictEqual(b("anything", ""), false, "empty slug never matches");
});

// ── AC-5.2b — E-TEAMS-MIGRATION-001: the member-CWD arm (v2.1.178 session-<uuid>). ─
// The harness now names teams `session-<uuid>` (NOT <slug>-<mode>), so the name-slug
// arm alone can't find our own team. The cwd arm identifies it by a member cwd at /
// under the project root — WHILE the wrong-project-survives invariant HOLDS (a foreign
// session-<uuid> team rooted elsewhere is NEVER ours). β rider 4: pin this so a future
// harness rename to a THIRD scheme fails loudly rather than silently widening scope.
ok("AC-5.2b teamBelongsToProject: member-cwd arm finds OUR session-<uuid> team, excludes foreign", () => {
  const b = lifecycle.teamBelongsToProject;
  const proj = process.platform === "win32" ? "C:\\proj\\mc" : "/proj/mc";
  const underProj = process.platform === "win32" ? "C:\\proj\\mc\\sub" : "/proj/mc/sub";
  const sibling = process.platform === "win32" ? "C:\\proj\\doogle" : "/proj/doogle";
  const parent = process.platform === "win32" ? "C:\\proj" : "/proj";
  const team = (members) => ({ name: "session-3c48a70b-7089-4c31-b168-06a51373d69c", members });
  // OURS — a uuid-named team with a member cwd AT the project root:
  assert.strictEqual(b(team([{ agentType: "epsilon", cwd: proj }]), "mc", proj), true, "member cwd == project root => ours");
  // OURS — a member cwd strictly UNDER the project root:
  assert.strictEqual(b(team([{ name: "Beta", cwd: underProj }]), "mc", proj), true, "member cwd under project root => ours");
  // FOREIGN — a sibling-project uuid team (the wrong-project-survives invariant):
  assert.strictEqual(b(team([{ agentType: "epsilon", cwd: sibling }]), "mc", proj), false, "sibling-project member cwd => NOT ours (survives teardown)");
  // FOREIGN — a team rooted ABOVE the project (parent-containment is NOT ownership):
  assert.strictEqual(b(team([{ cwd: parent }]), "mc", proj), false, "parent-dir member cwd => NOT ours");
  // FOREIGN — a uuid team with NO member cwd evidence + a foreign slug name:
  assert.strictEqual(b(team([{ agentType: "epsilon" }]), "mc", proj), false, "no cwd evidence + uuid name => NOT ours");
  // legacy name-slug arm still works alongside the cwd arm:
  assert.strictEqual(b({ name: "mc-sprint", members: [] }, "mc", proj), true, "legacy <slug>- name still ours");
});

// ── AC-5.3 — orphan/stale + duplicate (-N accretion) detection ───────────────
ok("AC-5.3 stale-team handle detected (config older than STALE_HOURS)", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"], {
    ageHours: 48, // ≥ 24h → stale
  });
  const findings = lifecycle.detectOrphansStale({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
  });
  assert.ok(
    findings.some((f) => f.type === "stale-team" && f.team === "mc-adhoc"),
    "stale 48h team handle not detected",
  );
});

ok("AC-5.3b -N accretion duplicate member detected", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", [
    "team-lead",
    "beta",
    "gamma",
    "gamma-2", // the Claude Code de-dup suffix → accretion
  ]);
  const dupes = lifecycle.detectDuplicates({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
  });
  assert.ok(
    dupes.some((f) => f.type === "duplicate-suffix" && f.member === "gamma-2"),
    "-N accretion (gamma-2) not detected",
  );
});

ok("AC-5.3c duplicate project TEAM handles detected", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"]);
  // A second handle for the same mode (different dir name, same -adhoc suffix).
  const dir = path.join(teamsRoot, "mc-adhoc-dup");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ name: "mc-adhoc", members: [{ name: "team-lead" }] }),
  );
  const dupes = lifecycle.detectDuplicates({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
  });
  assert.ok(
    dupes.some((f) => f.type === "duplicate-team"),
    "duplicate project team handles not detected",
  );
});

// ── AC-5.4 — best-effort teardown honesty ────────────────────────────────────
ok("AC-5.4 default teardown is REQUEST-ONLY (no handle removal)", () => {
  const { teamsRoot, stateDir } = freshDirs();
  const mine = plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"]);
  const res = lifecycle.teardown({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
  }); // no apply
  assert.strictEqual(res.apply, false);
  assert.ok(
    fs.existsSync(mine.file),
    "request-only teardown must NOT remove the handle",
  );
  assert.ok(
    res.requested.every((r) => r.shutdownRequested && !r.handleRemoved),
    "request-only: shutdown requested, handle NOT removed",
  );
  assert.strictEqual(res.killedGuaranteed, false);
  assert.ok(/best-effort/.test(res.residual), "residual must be honest");
});

ok("AC-5.4b teardown writes a durable state record", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"]);
  lifecycle.teardown({ teamsRoot, stateDir, slug: "mc", mode: "adhoc" });
  const state = lifecycle.readState({ teamsRoot, stateDir, slug: "mc" });
  assert.ok(
    state.teardownRequests.length >= 1 &&
      state.teardownRequests[0].teams.includes("mc-adhoc"),
    "teardown request not durably recorded",
  );
});

ok("AC-5.4c readiness record writes the .team-live marker + state", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"]);
  const rec = lifecycle.writeReadinessRecord({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
    sid: "s-abc123",
  });
  assert.strictEqual(rec.markerWritten, true);
  assert.ok(
    fs.existsSync(path.join(stateDir, ".team-live-s-abc123")),
    "readiness marker not written",
  );
});

// ── AC-5.5 — fail-open: missing / malformed config → no throw, reconcile ─────
ok("AC-5.5 malformed config.json → no throw; listed unreadable", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantTeam(teamsRoot, "mc-adhoc", [], { raw: "{ not json ]" });
  const opts = { teamsRoot, stateDir, slug: "mc", mode: "adhoc" };
  let teams;
  assert.doesNotThrow(() => {
    teams = lifecycle.listTeams(opts);
  });
  assert.ok(
    teams.some((t) => t.unreadable),
    "malformed config not surfaced as unreadable",
  );
  // reconcile must also not throw on a malformed handle.
  assert.doesNotThrow(() => lifecycle.reconcile(opts));
});

ok("AC-5.5b missing teams dir → empty list, no throw", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "slc05-"));
  const opts = {
    teamsRoot: path.join(base, "does-not-exist"),
    stateDir: path.join(base, "runtime"),
    slug: "mc",
    mode: "adhoc",
  };
  let teams;
  assert.doesNotThrow(() => {
    teams = lifecycle.listTeams(opts);
  });
  assert.deepStrictEqual(teams, []);
  assert.doesNotThrow(() => lifecycle.teardown({ ...opts, apply: true }));
});

ok("AC-5.5c UUID inbox-only dir (no config.json) is ignored", () => {
  const { teamsRoot, stateDir } = freshDirs();
  plantInboxDir(teamsRoot, "3c48a70b-7089-4c31-b168-06a51373d69c");
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"]);
  const teams = lifecycle.listTeams({ teamsRoot, stateDir, slug: "mc" });
  assert.strictEqual(teams.length, 1, "inbox-only UUID dir must be skipped");
  assert.strictEqual(teams[0].name, "mc-adhoc");
});

ok("AC-5.5d reconcile records a reconciliation, never blind-kills", () => {
  const { teamsRoot, stateDir } = freshDirs();
  const mine = plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"], {
    ageHours: 48,
  });
  const opts = { teamsRoot, stateDir, slug: "mc", mode: "adhoc" };
  const rec = lifecycle.reconcile(opts);
  assert.strictEqual(rec.action, "marked-stale-no-kill");
  assert.ok(
    fs.existsSync(mine.file),
    "reconcile must NEVER blind-kill the stale handle",
  );
  assert.ok(
    rec.staleFindings.some((f) => f.type === "stale-team"),
    "reconcile did not surface the stale finding",
  );
});

// ── AC-5.9 — verify-terminated gate: never blind-remove a possibly-live handle ─
ok("AC-5.9 apply + verifyTerminated()=FALSE (fresh) → handle NOT removed, residual logged", () => {
  const { teamsRoot, stateDir } = freshDirs();
  // FRESH heartbeat → a member may still be live → termination unverified.
  const mine = plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"]);
  const opts = { teamsRoot, stateDir, slug: "mc", mode: "adhoc" };
  const res = lifecycle.teardown({ ...opts, apply: true });
  const entry = res.requested.find((r) => r.team === "mc-adhoc");
  assert.ok(entry, "our team must still appear in the request set");
  assert.strictEqual(entry.handleRemoved, false, "fresh/unverified handle must NOT be removed");
  assert.strictEqual(
    entry.skippedReason,
    "termination-unverified",
    "skip reason must be recorded",
  );
  assert.ok(
    fs.existsSync(mine.file),
    "config.json (the handle) must SURVIVE when termination is unverified",
  );
  // Honest ceiling preserved at every exit.
  assert.strictEqual(res.killedGuaranteed, false);
});

ok("AC-5.9b apply + verifyTerminated()=TRUE (stale) → handle removed", () => {
  const { teamsRoot, stateDir } = freshDirs();
  // STALE heartbeat (48h ≥ STALE_HOURS) → positively confirmed not-live.
  const mine = plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"], {
    ageHours: 48,
  });
  const opts = { teamsRoot, stateDir, slug: "mc", mode: "adhoc" };
  const res = lifecycle.teardown({ ...opts, apply: true });
  const entry = res.requested.find((r) => r.team === "mc-adhoc");
  assert.strictEqual(entry.handleRemoved, true, "verified-stale handle should be removed");
  assert.strictEqual(entry.terminationVerified, true);
  assert.ok(
    !fs.existsSync(mine.file),
    "config.json should be removed once termination is verified",
  );
  assert.strictEqual(res.killedGuaranteed, false);
});

ok("AC-5.9c verifyTerminated unit: fresh=false, stale=true, unreadable=false", () => {
  const { teamsRoot, stateDir } = freshDirs();
  const opts = { teamsRoot, stateDir, slug: "mc" };
  // Fresh (mtime ≈ now) → not verified.
  assert.strictEqual(
    lifecycle.verifyTerminated({ name: "mc-adhoc", ageHours: 0 }, opts),
    false,
    "fresh heartbeat must be treated as possibly-live",
  );
  // Stale beyond STALE_HOURS → confirmed not-live.
  assert.strictEqual(
    lifecycle.verifyTerminated(
      { name: "mc-adhoc", ageHours: lifecycle.STALE_HOURS + 1 },
      opts,
    ),
    true,
    "stale-beyond-threshold heartbeat must confirm not-live",
  );
  // Unreadable handle → roster unverifiable → fail-safe false.
  assert.strictEqual(
    lifecycle.verifyTerminated(
      { name: "mc-adhoc", ageHours: Infinity, unreadable: true },
      opts,
    ),
    false,
    "unreadable handle must default to NOT verified",
  );
  // Missing/nameless → fail-safe false.
  assert.strictEqual(lifecycle.verifyTerminated(null, opts), false);
});

ok("AC-5.9d unverified skip is honest: foreign STILL protected, never a guaranteed kill", () => {
  const { teamsRoot, stateDir } = freshDirs();
  // Our team is fresh (unverified) AND a foreign team is present — both must be
  // left intact: the foreign one by the slug filter, ours by the verify gate.
  const mine = plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta"]);
  const foreign = plantTeam(teamsRoot, "doogle-sprint", ["team-lead", "epsilon"]);
  const res = lifecycle.teardown({
    teamsRoot,
    stateDir,
    slug: "mc",
    mode: "adhoc",
    apply: true,
  });
  assert.ok(fs.existsSync(mine.file), "unverified own handle must survive");
  assert.ok(fs.existsSync(foreign.file), "foreign handle must survive");
  assert.ok(res.foreignProtected.includes("doogle-sprint"));
  assert.ok(!res.requested.some((r) => r.team === "doogle-sprint"));
  assert.strictEqual(res.killedGuaranteed, false);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nteam-lifecycle.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
