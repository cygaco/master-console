#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// team-cwd-scope-under-project.test.js — SP-20260611-002 W1-fold (T-20260611-325,
// MINOR). Exploit-shaped regression for the mode-lifecycle-guard.js active-team
// cwd-membership scoping.
//
// THE OLD ATTACK (must now FAIL CLOSED): findActiveTeamForProject() decided a
// team "belongs" to this project when a member's cwd matched
//   c === project || c.startsWith(project + "/") || project.startsWith(c + "/")
// That LAST clause is PARENT-containment: it is true when the member cwd `c` is
// an ANCESTOR (parent) of the project. So a broad/foreign team rooted ABOVE this
// project (e.g. a member cwd of the home dir or another project's parent dir)
// was mislabeled as THIS project's active team — a foreign team borrowing this
// project's membership.
//
// THE FIX (AC-325.1): membership requires the member cwd to be the project root
// EXACTLY, or strictly UNDER it — NEVER a parent.
//
// FIXTURE NAMESPACING (Hard AC #9 / P-059): a sealed per-test OS-tmpdir home with
// a planted ~/.claude/teams/<team>/config.json — never a live ~/.claude/teams (it
// holds other projects' real teams). Per-surface isolation (Hard AC #4): this
// file covers ONLY scripts/hooks/mode-lifecycle-guard.js#findActiveTeamForProject.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const guard = require(path.join(ROOT, "scripts", "hooks", "mode-lifecycle-guard.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// Seal a home dir, plant one team config whose ONLY membership lever is a member
// cwd (the team NAME is deliberately foreign so the slug filter can't match — the
// cwd test is the surface under test). Returns { home, projectDir }.
//   projectDir   — the canonical project root we test membership against
//   memberCwd    — the planted member.cwd (the attack lever)
//   teamName     — config team name (default a foreign name, NOT "<slug>-...")
function plant(opts) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const teamName = opts.teamName || "some-foreign-broad-team";
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: opts.memberCwd }] }),
  );
  return { home, teamName };
}

// A canonical project dir UNDER the sealed home so parent/child relationships are
// real on-disk-shaped paths. We DON'T need the dir to exist for the string scope
// test, but using a home-rooted path keeps parent = home a realistic ancestor.
function projectUnder(home) {
  return path.join(home, "work", "mc");
}

// ── AC-325.2 — a member cwd that is a PARENT of the project does NOT match ─────
ok("parent-cwd-member-is-not-this-projects-active-team", () => {
  // First seal a home, THEN derive a project under it, THEN plant a team whose
  // member cwd is the home dir itself — a strict ANCESTOR of the project.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const projectDir = projectUnder(home);
  const teamName = "some-foreign-broad-team";
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: home }] }), // PARENT cwd
  );
  // slug deliberately mismatched so ONLY the cwd test can match.
  const active = guard.findActiveTeamForProject("mc", projectDir, home);
  assert.strictEqual(
    active,
    null,
    "a member cwd that is a PARENT of the project must NOT be labeled this project's team",
  );
});

ok("grandparent-cwd-member-is-not-this-projects-active-team", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const projectDir = path.join(home, "a", "b", "mc"); // deeper nesting
  const teamName = "another-foreign-team";
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: path.join(home, "a") }] }),
  );
  const active = guard.findActiveTeamForProject("mc", projectDir, home);
  assert.strictEqual(active, null, "a grandparent cwd member must not match either");
});

// ── AC-325.3 — exact + under-project still match (no happy-path regression) ────
ok("exact-project-cwd-member-still-matches", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const projectDir = projectUnder(home);
  const teamName = "foreign-named-but-cwd-exact";
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: projectDir }] }), // EXACT
  );
  const active = guard.findActiveTeamForProject("mc", projectDir, home);
  assert.strictEqual(active, teamName, "an EXACT project-cwd member is correctly recognized");
});

ok("under-project-cwd-member-still-matches", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const projectDir = projectUnder(home);
  const teamName = "foreign-named-but-cwd-under";
  const memberCwd = path.join(projectDir, ".claude", "worktrees", "wt-x"); // UNDER
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: memberCwd }] }),
  );
  const active = guard.findActiveTeamForProject("mc", projectDir, home);
  assert.strictEqual(active, teamName, "a member cwd strictly UNDER the project is recognized");
});

ok("slug-named-team-still-matches-independent-of-cwd", () => {
  // The slug arm (name === slug || startsWith(slug + "-")) is untouched by this
  // fix — a `<slug>-sprint` team is still ours regardless of cwd. Guards against
  // over-narrowing the fix into the name arm.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcs-home-"));
  const projectDir = projectUnder(home);
  const teamName = "mc-sprint";
  const cfgDir = path.join(home, ".claude", "teams", teamName);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ name: teamName, members: [{ name: "m", cwd: home }] }), // parent cwd, but slug matches
  );
  const active = guard.findActiveTeamForProject("mc", projectDir, home);
  assert.strictEqual(active, teamName, "a slug-named team is ours via the name arm (cwd irrelevant)");
});

console.log(`\nteam-cwd-scope-under-project: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
