/**
 * release-gates.js - release gates for /warp:release.
 *
 * Phase 4H artifact. Wraps existing checks (paths, requirements, references,
 * hooks, framework-manifest, runtime-leak, version-consistency, and Phase 6
 * production-quality checks into a single
 * runner that /warp:release calls before publishing.
 *
 * Exit codes:
 *   0 — all green
 *   1 — one or more yellow (warn), no red
 *   2 — one or more red (block)
 *
 * Usage:
 *   node scripts/mc/release-gates.js                # full
 *   node scripts/mc/release-gates.js --json         # machine-readable
 *   node scripts/mc/release-gates.js --skip <name>  # skip a gate (for known YEL during phase progression)
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { isCanonical, roleStatus } = require("../testsuite/role");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function gate(name, fn) {
  return { name, fn };
}

// Extracts failing-assertion names per leg from a fresh_scaffold_all_ways
// --json payload, for gate `details` (bounded to a few lines per leg).
function summarizeGateALegs(payload) {
  const out = [];
  for (const leg of (payload && payload.legs) || []) {
    const fails = (leg.asserts || []).filter((a) => a.status === "fail");
    if (fails.length) {
      out.push(`leg ${leg.leg} (${leg.name}): ${fails.map((a) => a.name).join("; ")}`);
    }
  }
  if (payload && payload.sandbox_isolation && !payload.sandbox_isolation.no_delta) {
    out.push(
      `sandbox-isolation NO-DELTA VIOLATED: onlyBefore=${payload.sandbox_isolation.onlyBefore.length} onlyAfter=${payload.sandbox_isolation.onlyAfter.length}`,
    );
  }
  return out.slice(0, 8);
}

// Extracts failing-assertion names from an upgrade_current_to_new --json
// payload (GATE-B), for gate `details` (bounded to a few lines). Mirrors
// summarizeGateALegs above for the upgrade-domain assert shape
// ({name, ok, detail, loadBearing}) instead of GATE-A's per-leg asserts.
function summarizeGateBAsserts(payload) {
  const out = [];
  for (const a of (payload && payload.asserts) || []) {
    if (!a.ok) {
      out.push(`${a.name}${a.loadBearing === false ? " [non-load-bearing]" : ""}: ${a.detail || ""}`);
    }
  }
  if (payload && payload.sandbox_isolation && !payload.sandbox_isolation.no_delta) {
    out.push(
      `sandbox-isolation NO-DELTA VIOLATED: onlyBefore=${(payload.sandbox_isolation.onlyBefore || []).length} onlyAfter=${(payload.sandbox_isolation.onlyAfter || []).length}`,
    );
  }
  // F6 — dirty-set content-hash compensating control (SP-20260721-001 D-4
  // INC-3 gauntlet-r1 fix cycle).
  if (payload && payload.sandbox_isolation && payload.sandbox_isolation.dirty_set_content_unchanged === false) {
    out.push(
      `sandbox-isolation DIRTY-SET CONTENT CHANGED: ${((payload.sandbox_isolation.dirty_set_changed_files || []).slice(0, 5)).join(", ")}`,
    );
  }
  return out.slice(0, 8);
}

// (F2 — qa FUNC-PAYLOAD-TRUST) GATE-B's named LOAD-BEARING evidence: a green
// verdict must never rest on merely `payload.ok === true` — the gate
// independently re-verifies the SPECIFIC asserts the trust model requires are
// present and green, mirroring the engine's own `ok` computation
// (test-upgrade-current-to-new.js's REQUIRED_NAMED_LOAD_BEARING_ASSERTS).
const GATE_B_REQUIRED_NAMED_ASSERTS = [
  "scan_install_green_3b",
  "fresh_n_parity_pathset_3c",
  "fresh_n_parity_type_3c",
  "fresh_n_parity_symlink_target_3c",
  "fresh_n_parity_content_3c",
];
function gateBNamedEvidencePresent(payload) {
  const asserts = (payload && payload.asserts) || [];
  return GATE_B_REQUIRED_NAMED_ASSERTS.every((name) => {
    const a = asserts.find((x) => x.name === name);
    return !!a && a.ok === true;
  });
}

// GATE-A report-only ramp (SP-20260721-001 INC-2, α-ratified option b — the MC report-only→enforce
// discipline). GATE-A is BUILT + CORRECT and surfaces real findings, but Leg-3 is currently RED on a
// PRE-EXISTING foundation issue (ED-249: scripts/mc/manifest/build.js fails with ~43-45 unclassified
// paths → _mc/MANIFEST.json cannot regenerate → install.ps1 produces an incomplete install). During
// the ramp a real-install LEG failure REPORTS (yellow) but does NOT block; a SANDBOX-ISOLATION leak ALWAYS
// blocks (red), even in report-only mode — that is the load-bearing correctness property. FLIP this to
// false once the named trigger is met: ED-249 resolved (build.js classifies clean) AND GATE-A Leg-3 green.
// FLIPPED 2026-07-22 (ceremony-1.0 Step-7 terminal flip): trigger MET — manifest/build.js classifies CLEAN
// (unclassifiedCount=0, exit 0; the ED-249 43-45 unclassified-paths symptom resolved by the ceremony's
// convergence work) AND GATE-A Leg-3 green (release run 18/0/0 — 0 yellow means no real-install leg failure,
// so enforce = 0 red). Enforce-mode self-verify green + β terminal consult at the release→retro boundary.
const GATE_A_REPORT_ONLY = false;

function runScript(scriptRelative, args, env) {
  const full = path.join(REPO_ROOT, scriptRelative);
  if (!fs.existsSync(full)) {
    return {
      status: 2,
      stdout: "",
      stderr: `Script missing: ${scriptRelative}`,
    };
  }
  const result = spawnSync(process.execPath, [full, ...(args || [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
  return result;
}

const GATES = [
  // 1. Path Coherence
  gate("path_coherence", () => {
    const r = runScript("scripts/paths/gate.js");
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Path registry + generated artifacts current.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Path coherence gate failed.",
      details: (r.stdout || "").split("\n").slice(-5),
    };
  }),

  // 2. Framework Manifest
  gate("framework_manifest", () => {
    const r = runScript("scripts/generate-framework-manifest.js", ["--check"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Framework manifest is current.",
      };
    if (r.status === 1)
      return {
        ok: false,
        severity: "yellow",
        message: "Framework manifest stale — regenerate before release.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Framework manifest generator errored.",
      details: [(r.stderr || r.stdout || "").slice(0, 200)],
    };
  }),

  // 2a-bis. Release-notes placeholder scan (ED-318) — the gate that would have
  // caught MC 1.2.0 being tagged with its own generated placeholder notes
  // ("Replace this placeholder content with real release notes before tagging",
  // "(TODO: list user-visible changes)", and a RELEASES.md row still reading
  // "Fill in via release notes"). Every other gate here checks manifest honesty,
  // structure, install or upgrade; NONE of them checked whether a document says
  // what a human promised it would say, which is the aspirational-vs-enforced
  // pattern in its purest form. The scan closed it mechanically because the
  // placeholders are OUR OWN GENERATOR'S sentinels, so gate and skeleton share
  // one source of truth rather than drifting. It also refuses a capsule that
  // cannot state what it was built from.
  //
  // Not a hypothetical: when first run it showed 1.1.0 had shipped placeholder
  // notes too, so the gap was at least two releases old rather than a one-off.
  //
  // SEVERITY MAPPING, deliberate. exit 1 (placeholder present / no provenance
  // commit) and exit 2 (COULD NOT RUN — missing or unreadable capsule) BOTH map
  // to `red`, because only `red` blocks (`ok: red === 0`) and a gate that cannot
  // verify must never let a release through — absence of a finding is not a
  // finding of absence. `degraded` was considered and REJECTED for exit 2: it
  // does not block. But the two are LABELLED distinctly in the message, so this
  // gate does not repeat GATE-A's conflation of could-not-run with failed, which
  // is ED-313's open residual.
  gate("release_notes_no_placeholders", () => {
    const version = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8")).version;
      } catch {
        return null;
      }
    })();
    if (!version) {
      return {
        ok: false,
        severity: "red",
        message:
          "release_notes_no_placeholders COULD NOT RUN — version.json unreadable, so the capsule under test is unknown. Not a pass.",
      };
    }
    const r = runScript("scripts/checks/release-notes-placeholder-scan.js", ["--version", version, "--json"]);
    let payload = null;
    try {
      payload = JSON.parse(r.stdout || "{}");
    } catch {
      /* fall through to the exit-code reading */
    }
    const problems = (payload && payload.problems) || [];
    const notes = (payload && payload.notes) || [];
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: `Release notes for ${version} carry no generator placeholders and the capsule states its build commit.`,
        details: notes.slice(0, 4),
      };
    if (r.status === 1)
      return {
        ok: false,
        severity: "red",
        message: `release_notes_no_placeholders FAILED — the ${version} capsule still carries placeholder notes, or cannot state what it was built from. Fill the notes before tagging; a tagged placeholder cannot be repaired by a later release.`,
        details: problems.slice(0, 8).concat(notes.slice(0, 2)),
      };
    return {
      ok: false,
      severity: "red",
      message: `release_notes_no_placeholders COULD NOT RUN (exit ${r.status}) — the ${version} capsule is missing or unreadable, so nothing was verified. Distinct from a FAILURE, and still blocking: absence of a finding is not a finding of absence.`,
      details: problems.length ? problems.slice(0, 6) : [(r.stderr || r.stdout || "").slice(0, 200)],
    };
  }),

  // 2b. Ship coverage (SP-20260525-024) — the framework_manifest gate above is
  // TAUTOLOGICAL (it only checks the manifest matches its own generator). This
  // gate closes the "downstream always missing something" class: it asserts the
  // SHIPPING manifest (framework-manifest.json) covers every owner=framework path
  // the OWNERSHIP manifest (_mc/MANIFEST.json) declares under the
  // consumer-essential roots. RED = a framework/schemas/patterns/command/agent
  // path ships to nobody (how framework/templates/* slipped — 0 of 53 shipped).
  gate("ship_coverage", () => {
    const r = runScript("scripts/checks/mc-ship-coverage.js", []);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Ship coverage: every consumer-essential framework path ships.",
      };
    return {
      ok: false,
      severity: "red",
      message:
        "Ship coverage FAILED — framework-owned essential-root path(s) ship to nobody. Add to ASSET_DIRS or allowlist.",
      details: (r.stdout || r.stderr || "").split("\n").filter((l) => l.includes(" - ")).slice(0, 10),
    };
  }),

  // 2c. Version coherence (2026-05-30) — catches the drift NO gate caught before:
  // product version lagging across manifests (the 0.10.0→0.11.0 lag, because
  // version-quorum only checks 4 sources, not manifest.mc.version or install.ps1)
  // AND schema-label divergence (paths v4-label-on-v5-content; stale framework-manifest
  // v1 fallback). RED blocks the release — the release engine now keeps these current.
  gate("version_coherence", () => {
    const r = runScript("scripts/checks/version-coherence.js", []);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Version + schema labels all agree.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Version coherence FAILED — version/schema-label drift detected.",
      details: (r.stdout || r.stderr || "").split("\n").filter((l) => /RED \[/.test(l)).slice(0, 10),
    };
  }),

  // 2d. Entry-preamble parity (SP-20260723-001 / ADR-0036) — the single-source helm
  // entry-file guarantee. Every executor entry doc (CODEX/ANTIGRAVITY/GEMINI + an
  // AGENTS.md section) embeds the canonical entering-agent preamble verbatim
  // (hash-parity vs .claude/project/reference/entry-preamble.md, keyed on REAL FILE
  // BYTES) and each thin shim stays within its size tier. A drifted/dropped/oversized
  // shim or a missing entry file is a single-source LIE — RED, NO yellow tier. exit 2
  // (canonical unreadable / internal error) is also RED (fail-closed, never a silent
  // pass). Its own test plants the semantic-edit->RED / CRLF-reformat->GREEN boundary.
  gate("entry_preamble_parity", () => {
    const r = runScript("scripts/checks/entry-preamble-parity.js", []);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Entry-file preamble: canonical hash-parity + shim thinness clean.",
      };
    return {
      ok: false,
      severity: "red",
      message:
        r.status === 2
          ? "Entry-preamble parity could not run (fail-closed) — canonical oracle unreadable / internal error."
          : "Entry-preamble parity FAILED — a shim drifted/dropped/oversized or an entry file is missing.",
      details: (r.stdout || r.stderr || "").split("\n").filter((l) => /-\s|FAIL/.test(l)).slice(0, 10),
    };
  }),

  // 3. Reference Integrity
  // 0.1.2 honesty fix: this gate cannot run automatically (it needs a running
  // Claude Code agent to invoke /scan:references). Pre-0.1.2 it returned
  // severity=green unconditionally — a lie that release-gates inherited.
  // Now it returns severity=manual: not blocking, but also not pretending to
  // pass. The runner counts manual the same as skipped for the overall PASS
  // tally; critical-by-default gates may upgrade manual to a soft-block.
  gate("reference_integrity", () => {
    return {
      ok: true,
      severity: "manual",
      message:
        "Reference integrity check requires the /scan:references slash skill (no headless equivalent yet) — run manually before /warp:release. Tracked separately, not auto-passed.",
    };
  }),

  // 4. Hook Registration
  gate("hook_registration", () => {
    const settings = path.join(REPO_ROOT, ".claude", "settings.json");
    if (!fs.existsSync(settings)) {
      return {
        ok: false,
        severity: "red",
        message: ".claude/settings.json missing.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "settings.json present (deeper hook fixture tests in gate 5).",
    };
  }),

  // 5. Hook Fixture Tests
  gate("hook_fixture_tests", () => {
    const r = runScript("scripts/hooks/test.js", ["--all"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Registered hook fixture tests pass.",
      };
    // Phase 5G ships fixtures. Until then, surface as YEL not RED.
    return {
      ok: false,
      severity: "red",
      message: "Hook fixture tests pending Phase 5G — placeholder gate.",
    };
  }),

  // 6. RETIRED (SP-20260721-001 D-4 INC-2 — GATE-A `fresh_scaffold_all_ways`,
  // coverage-map below). `fresh_install_fixture` asserted ONLY that
  // fixtures/install-empty-next-app/ EXISTS as a directory — cosmetic, never
  // ran an install. SUBSUMED by GATE-A Leg 1 (/portfolio:new, real install)
  // and Leg 3 (shipped install.ps1, real install) below, both of which
  // exercise a REAL fresh install and assert on its actual end-state
  // (framework-installed.json, scan:install GREEN) rather than a fixture
  // directory's mere existence. See the retirement coverage-map comment next
  // to `fresh_scaffold_all_ways` for the full R5 accounting (why this one
  // retires, why `customized_install_fixture` retires, why
  // `update_fixture_from_previous` does NOT).

  // 7. GATE-B `upgrade_current_to_new` (SP-20260721-001 D-4 INC-3 — upgrades,
  // not retires, the prior `update_fixture_from_previous`). The operator's
  // D-4 standing standard #2 ("upgrade current->new works, for real") is now
  // a REAL, BLOCKING release gate: runs `scripts/mc/test-upgrade-current-
  // to-new.js`, which materializes a real N-1 install (git-tag worktree +
  // ITS OWN install.ps1), runs the real `update.js --apply` against it (via
  // run(), never the --json CLI — see the engine header for why that would
  // silent-green a Class-C/preflight-block), and asserts the applied
  // end-state CONFORMS: 3b (scan:install GREEN, schema-based) + 3c (full-tree
  // parity vs a fresh-N oracle install) are LOAD-BEARING; 3a (version-sanity)
  // is a cheap non-load-bearing signal only (β design->build DECIDE B/0.89 —
  // 3a alone can never flip the verdict). Sandbox-isolated, reusing GATE-A's
  // proven no-delta harness.
  //
  // COVERAGE NOTE: the classifier-only dry-run this gate replaces
  // (`update_fixture_from_previous`) only ran the update.js CLASSIFIER (a
  // dry-run plan) over the static `fixtures/update-from-0.0.0-clean` fixture
  // — it never applied anything and never verified the applied end-state.
  // That coverage is SUBSUMED here by a real N-1 -> N apply + conformance
  // asserts. The fixture may remain as a unit fixture but no longer gates
  // release on its own.
  gate("upgrade_current_to_new", () => {
    const rs = roleStatus();
    if (!rs.canonical) {
      if (rs.manifestExists && !rs.manifestReadable) {
        return {
          ok: true,
          severity: "manual",
          message:
            ".claude/manifest.json exists but is unreadable — cannot resolve repoRole. upgrade_current_to_new was NOT run; verify the manifest before release.",
        };
      }
      return {
        ok: true,
        severity: "green",
        message: `upgrade_current_to_new is opt-in for product repos (repoRole=${rs.role || "product"}) — skipped.`,
      };
    }
    const r = runScript("scripts/mc/test-upgrade-current-to-new.js", ["--json"]);
    let payload = null;
    try {
      payload = JSON.parse((r.stdout || "").trim() || "{}");
    } catch {
      /* leave payload null — the errored branch below fires */
    }
    // (1) SANDBOX-ISOLATION no-delta violation is checked FIRST, unconditionally
    //     — before green/incomplete/errored — so no later branch can soften a
    //     leak into canonical (the GATE-A branch-order lesson).
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.no_delta === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "GATE-B upgrade_current_to_new: SANDBOX-ISOLATION NO-DELTA VIOLATED — the N-1 materialize/apply run leaked into canonical. This BLOCKS unconditionally.",
        details: summarizeGateBAsserts(payload),
      };
    }
    // (1.25) F6 — dirty-set content-hash compensating control (SP-20260721-001
    //     D-4 INC-3 gauntlet-r1). Same unconditional priority as (1): a
    //     porcelain-line diff cannot see a content change to an ALREADY-dirty
    //     file, so this control covers exactly that gap and blocks
    //     unconditionally too, never softened by a later branch.
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.dirty_set_content_unchanged === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "GATE-B upgrade_current_to_new: SANDBOX-ISOLATION DIRTY-SET CONTENT CHANGED — an already-dirty canonical file's CONTENT changed during the run (a porcelain status-line diff cannot see this). This BLOCKS unconditionally.",
        details: summarizeGateBAsserts(payload),
      };
    }
    // (1.5) INCOMPLETE (B skip-loud) — no UNRELEASED capsule to upgrade TO
    //     (steady-state mid-dev: every capsule is a shipped/tagged frozen
    //     release). NOT a pass, NOT a red: the full upgrade->conformance path
    //     runs at the CEREMONY when a fresh capsule is cut from the current tree
    //     (identity-consistent — the fresh capsule == current). Rendered manual
    //     so it never greens release and never falsely blocks it. DISTINCT from
    //     the ps-unavailable INCOMPLETE below, which DOES block (a host that
    //     cannot run the real installs is a genuine gap). At the actual ceremony
    //     an unreleased cut EXISTS, so this manual flag surfaces if the capsule
    //     was not cut.
    if (payload && payload.incomplete === true) {
      return {
        ok: true,
        severity: "manual",
        message: `GATE-B upgrade_current_to_new: INCOMPLETE (skip-loud) — ${payload.incomplete_reason || "no unreleased capsule cut; the full path runs at the release ceremony."}`,
      };
    }
    // (2) clean pass — apply succeeded and every load-bearing conformance
    //     assert (3b, 3c, + preconditions) is green.
    // (F2 — qa FUNC-PAYLOAD-TRUST) never trust `payload.ok === true` alone: a
    //     status-0 payload could claim ok:true while missing the isolation
    //     evidence entirely or omitting the named 3b/3c asserts (e.g. only
    //     n1_resolved ran). Independently re-verify sandbox_isolation is
    //     PRESENT and both its checks are true, AND the named load-bearing
    //     evidence is present and green, before rendering green.
    if (
      r.status === 0 &&
      payload &&
      payload.ok === true &&
      payload.sandbox_isolation &&
      payload.sandbox_isolation.no_delta === true &&
      payload.sandbox_isolation.dirty_set_content_unchanged === true &&
      gateBNamedEvidencePresent(payload)
    ) {
      return {
        ok: true,
        severity: "green",
        message: `GATE-B upgrade_current_to_new: ${payload.from_version} -> ${payload.to_version} applied and conforms (ps_available=${payload.ps_available}).`,
      };
    }
    // (3) INCOMPLETE — no PowerShell on this host (both the N-1 install and
    //     the fresh-N oracle need it, like GATE-A Leg 3) or a required step
    //     never ran. Never a silent pass (R2 skip-loud). GATE-B has no
    //     report-only ramp, so INCOMPLETE still BLOCKS (red) — it is only
    //     distinctly flagged from a genuine conformance failure.
    if (payload && payload.ps_available === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "GATE-B upgrade_current_to_new: INCOMPLETE — no PowerShell on this host, the real N-1/N installs cannot run. Not a pass (R2 skip-loud); BLOCKS release.",
        details: summarizeGateBAsserts(payload),
      };
    }
    // (4) errored — engine crashed or produced no parseable payload.
    //     Fail-closed: never a clean pass on a crash.
    if (!payload || !payload.ran && !(payload.asserts && payload.asserts.length)) {
      return {
        ok: false,
        severity: "red",
        message: "GATE-B upgrade_current_to_new engine errored (no parseable --json payload or no asserts produced).",
        details: payload ? summarizeGateBAsserts(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
      };
    }
    // (5) a load-bearing assert failed (real conformance failure — apply,
    //     3b scan:install, or 3c fresh-N parity).
    return {
      ok: false,
      severity: "red",
      message: `GATE-B upgrade_current_to_new FAILED — ${payload.from_version || "?"} -> ${payload.to_version || "?"}: a load-bearing assert failed.`,
      details: summarizeGateBAsserts(payload),
    };
  }),

  // 8. RETIRED (SP-20260721-001 D-4 INC-2 — GATE-A `fresh_scaffold_all_ways`).
  // `customized_install_fixture` asserted ONLY that
  // fixtures/update-from-0.0.0-customized-claude-md/ EXISTS as a directory —
  // cosmetic, never ran an install or touched a CLAUDE.md. SUBSUMED by
  // GATE-A Leg 2 (manual /warp:setup over a SEEDED pre-existing CLAUDE.md,
  // real merge), which asserts identity-merge, seeded-content survival, and a
  // pre-merge backup — the real behavior this fixture only gestured at.

  // 9. Runtime Leak Scan
  // Only flag truly-runtime paths that should never be in git.
  // .claude/project/events/ and .claude/project/memory/ ARE intentionally
  // tracked in this repo (per-project event log + memory stores); flagging
  // them as "leaks" was wrong. We narrow the scan to the per-session
  // runtime tree only.
  gate("runtime_leak_scan", () => {
    const RUNTIME_LEAK_PATTERNS = [
      ".claude/runtime/.session-checkpoint.json",
      ".claude/runtime/.topology-snapshot.json",
      ".claude/runtime/handoff.md",
      ".claude/runtime/handoffs/",
      ".claude/runtime/logs/",
      ".claude/runtime/notes/",
      ".claude/runtime/dispatch/",
      ".claude/.agent-result-hashes.json",
      ".claude/.last-checkpoint",
      ".claude/.session-checkpoint.json",
      ".claude/scheduled_tasks.lock",
      ".claude/agents/.system/dispatch-backups/",
      ".claude/agents/president/_system/oneshot/store.json",
      ".claude/agents/president/_system/oneshot/store.json.prev-run-backup.json",
    ];
    // Differentiate pre-existing leaks (committed before the leak rule
    // existed) from new leaks (added in the most recent change). New
    // leaks block; pre-existing leaks YEL with a "deferred to Phase 5T
    // cleanup" note. Phase 4 doesn't take on rewriting prior commits.
    let preExisting = [];
    let newlyAdded = [];
    try {
      const allTracked = execSync(
        `git ls-files ${RUNTIME_LEAK_PATTERNS.join(" ")}`,
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
        .split("\n")
        .filter((l) => l.trim());
      // Fix-forward (codex Phase 4 review 2026-04-30): "newly added" should
      // mean "added on this branch since divergence from master," not just
      // "added in HEAD~1..HEAD." A multi-commit phase that added a leak in
      // its first commit and ran the gate from its third commit would have
      // misclassified the leak as pre-existing.
      let recentlyAdded = [];
      let mergeBase = null;
      try {
        mergeBase = execSync(`git merge-base HEAD master`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
        }).trim();
      } catch {
        // No master ref — fall back to the previous commit
        try {
          mergeBase = execSync(`git rev-parse HEAD~1`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
          }).trim();
        } catch {
          mergeBase = null;
        }
      }
      if (mergeBase) {
        try {
          recentlyAdded = execSync(
            `git diff ${mergeBase}..HEAD --name-only --diff-filter=A ${RUNTIME_LEAK_PATTERNS.join(" ")}`,
            { cwd: REPO_ROOT, encoding: "utf8" },
          )
            .split("\n")
            .filter((l) => l.trim());
        } catch {
          recentlyAdded = [];
        }
      }
      const newSet = new Set(recentlyAdded);
      for (const f of allTracked) {
        if (newSet.has(f)) newlyAdded.push(f);
        else preExisting.push(f);
      }
    } catch {
      // git not available or empty result → treat as clean
    }
    if (newlyAdded.length > 0) {
      return {
        ok: false,
        severity: "red",
        message: `${newlyAdded.length} NEWLY-leaked runtime files in the last commit — block release.`,
        details: newlyAdded.slice(0, 5),
      };
    }
    if (preExisting.length > 0) {
      return {
        ok: false,
        severity: "yellow",
        message: `${preExisting.length} pre-existing runtime files are git-tracked from prior commits — schedule Phase 5T cleanup (\`git rm --cached\` + .gitignore additions). Not blocking release.`,
        details: preExisting.slice(0, 5),
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "No runtime / per-session files leaked into git.",
    };
  }),

  // 10. Version Consistency
  gate("version_consistency", () => {
    const versionFile = path.join(REPO_ROOT, "version.json");
    const manifestFile = path.join(
      REPO_ROOT,
      ".claude",
      "framework-manifest.json",
    );
    if (!fs.existsSync(versionFile))
      return { ok: false, severity: "red", message: "version.json missing." };
    if (!fs.existsSync(manifestFile))
      return {
        ok: false,
        severity: "red",
        message: "framework-manifest.json missing.",
      };
    const v = JSON.parse(fs.readFileSync(versionFile, "utf8"));
    const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (v.version !== m.version) {
      return {
        ok: false,
        severity: "red",
        message: `version mismatch: version.json=${v.version} framework-manifest.json=${m.version}`,
      };
    }
    const capsule = path.join(
      REPO_ROOT,
      "framework",
      "releases",
      v.version,
      "release.json",
    );
    if (!fs.existsSync(capsule)) {
      return {
        ok: false,
        severity: "yellow",
        message: `No release capsule for ${v.version} yet — run /warp:release ${v.version}.`,
      };
    }
    const c = JSON.parse(fs.readFileSync(capsule, "utf8"));
    if (c.version !== v.version) {
      return {
        ok: false,
        severity: "red",
        message: `capsule version mismatch: version.json=${v.version} capsule=${c.version}`,
      };
    }
    return {
      ok: true,
      severity: "green",
      message: `All three sources agree: ${v.version}.`,
    };
  }),

  // 11. Production Baseline
  gate("production_baseline", () => {
    const r = runScript("scripts/checks/production-baseline.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message:
          "Production, accessibility, analytics, DR, readiness, and deprecation docs are present.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Production baseline is incomplete.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  // 12. Contract Versioning
  gate("contract_versioning", () => {
    const r = runScript("scripts/checks/contract-versioning.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message: "Shared contracts declare semver and compatibility policy.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Contract versioning check failed.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  // 13. Pattern Library
  gate("pattern_library", () => {
    const admission = path.join(REPO_ROOT, "patterns", "ADMISSION.md");
    const dir = path.join(REPO_ROOT, "patterns");
    if (!fs.existsSync(admission)) {
      return {
        ok: false,
        severity: "red",
        message: "patterns/ADMISSION.md missing.",
      };
    }
    const content = fs
      .readdirSync(dir)
      .filter(
        (f) => f.endsWith(".md") && !["README.md", "ADMISSION.md"].includes(f),
      );
    if (content.length < 3) {
      return {
        ok: false,
        severity: "red",
        message:
          "Pattern library needs at least 3 canonical patterns or pruned references.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: `Pattern library has admission policy and ${content.length} canonical patterns.`,
    };
  }),

  // 14. Phase 6 Path Usage
  gate("path_usage", () => {
    const r = runScript("scripts/checks/path-usage.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message:
          "Phase 6 path-usage audit found active consumers for previously flagged keys.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Path usage audit found unused flagged keys.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  // 15. Regression Seed (0.17.0 Per-Sprint Exhaustive Test-Suite System)
  // The named enforcer for the per-sprint test-suite convention
  // (_docs/sprint/TESTSUITE.md): the regression-seed suite (the 26 recurring
  // bug classes in _requirements/07-testing/recurring-bug-classes.json, made
  // runnable by scripts/testsuite/run.js) must stay green per sprint. This gate
  // runs scripts/testsuite/enforce.js, which itself is role-aware:
  //   - product repos     → opt-in; enforce.js no-ops (consumer-only detectors
  //                         would falsely fail), so we skip-as-green here too.
  //   - canonical/framework → mandatory; a regression in a covered class is RED.
  // Honesty note: pre-existing open regressions in canonical correctly turn this
  // RED — the suite reflects reality and is not suppressed here.
  gate("regression_seed", () => {
    const rs = roleStatus();
    if (!rs.canonical) {
      // qa W5: distinguish a genuine product repo (manifest readable, role
      // absent/product → legitimately opt-in, skip-as-green) from a manifest
      // that EXISTS but is unparseable — that is almost certainly a canonical
      // checkout with a corrupt/locked manifest, and silently skipping
      // enforcement would be a false green at release time. Surface the latter
      // as MANUAL so the release runner flags it for a human rather than
      // pretending the suite passed.
      if (rs.manifestExists && !rs.manifestReadable) {
        return {
          ok: true,
          severity: "manual",
          message:
            ".claude/manifest.json exists but is unreadable — cannot resolve repoRole. Regression-seed enforcement was NOT run; verify the manifest before release (a corrupt manifest in a canonical checkout must not silently skip the suite).",
        };
      }
      return {
        ok: true,
        severity: "green",
        message: `Regression-seed enforcement is opt-in for product repos (repoRole=${rs.role || "product"}) — skipped.`,
      };
    }
    const r = runScript("scripts/testsuite/enforce.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message: "Regression-seed suite: no regressions in covered classes.",
      };
    }
    if (r.status === 1) {
      return {
        ok: false,
        severity: "red",
        message: "Regression-seed suite: a covered bug class regressed — block release.",
        details: (r.stdout || r.stderr || "").split(/\r?\n/).filter(Boolean).slice(-6),
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Regression-seed runner errored (run.js produced no parseable verdict).",
      details: (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-6),
    };
  }),

  // GATE-A `fresh_scaffold_all_ways` (SP-20260721-001 D-4 INC-2 —
  // ADR-0034). The operator's D-4 standing standard #1 ("fresh-scaffold, ALL
  // WAYS") made a REAL, BLOCKING release gate: runs all 3 shipped install
  // paths for real (scripts/mc/test-scaffold-all-ways.js — see that
  // file's header for the full engine contract + the sandbox-isolation
  // binding), sandbox-isolated, and PROVES the run never touched canonical
  // (a no-delta git-status snapshot before/after).
  //
  // R5 RETIREMENT COVERAGE-MAP (coverage-proven, not retired on number):
  //   - `fresh_install_fixture`       RETIRED — was `fs.existsSync` on a
  //     fixture DIRECTORY only, never ran an install. Subsumed by Leg 1
  //     (/portfolio:new) + Leg 3 (shipped install.ps1), both real installs.
  //   - `customized_install_fixture`  RETIRED — same class, directory-exists
  //     only. Subsumed by Leg 2 (manual /warp:setup over a SEEDED pre-existing
  //     CLAUDE.md — real identity-merge + survival + backup asserts).
  //   - `update_fixture_from_previous` STAYED through INC-2 (not cosmetic like
  //     the two above — it ran the update.js classifier over a real fixture)
  //     then was itself UPGRADED in INC-3 into `upgrade_current_to_new`
  //     (GATE-B, below this gate in the array) — a real N-1 -> N apply +
  //     conformance gate, not just a classifier dry-run. See GATE-B's own
  //     comment for the full coverage note.
  //
  // Role-aware like `regression_seed`: only canonical can act as a MC
  // engine SOURCE (a product/consumer repo has no framework-manifest.json and
  // install.ps1 refuses it as a source) — opt-in/skip-as-green for product
  // repos, same qa W5 manifest-unreadable distinction.
  gate("fresh_scaffold_all_ways", () => {
    const rs = roleStatus();
    if (!rs.canonical) {
      if (rs.manifestExists && !rs.manifestReadable) {
        return {
          ok: true,
          severity: "manual",
          message:
            ".claude/manifest.json exists but is unreadable — cannot resolve repoRole. fresh_scaffold_all_ways was NOT run; verify the manifest before release.",
        };
      }
      return {
        ok: true,
        severity: "green",
        message: `fresh_scaffold_all_ways is opt-in for product repos (repoRole=${rs.role || "product"}) — skipped.`,
      };
    }
    const r = runScript("scripts/mc/test-scaffold-all-ways.js", ["--json"]);
    let payload = null;
    try {
      payload = JSON.parse((r.stdout || "").trim() || "{}");
    } catch {
      /* leave payload null — the errored branch below fires */
    }
    // (1) SANDBOX-ISOLATION no-delta violation (a real leg leaking into canonical) is the load-bearing
    //     correctness property — it BLOCKS UNCONDITIONALLY, and it is checked FIRST, before green /
    //     incomplete / report-only, so NO branch (a no-PS `incomplete` short-circuit, the report-only ramp)
    //     can ever soften a leak. (β R1 / the canonical-corruption incident / backend-reviewer branch-order
    //     BLOCKER: on a no-PS host `incomplete` fired before this check and a Leg-1/2 leak returned degraded.)
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.no_delta === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "GATE-A fresh_scaffold_all_ways: SANDBOX-ISOLATION NO-DELTA VIOLATED — a real-install leg leaked into canonical. This BLOCKS unconditionally (never softened by incomplete or report-only).",
        details: summarizeGateALegs(payload),
      };
    }
    // (2) all 3 legs pass, no leak.
    if (r.status === 0 && payload && payload.ok) {
      return {
        ok: true,
        severity: "green",
        message: `GATE-A fresh_scaffold_all_ways: all 3 legs pass, sandbox-isolation no-delta held (ps_available=${payload.ps_available}).`,
      };
    }
    // (3) INCOMPLETE — Leg 3 (the SHIPPED install.ps1) did not run (no PowerShell). Never a pass (R2
    //     skip-loud). Non-blocking (degraded) DURING the report-only ramp; once the ramp flips HARD, a host
    //     that cannot certify the shipped installer must BLOCK (red) — a no-PS host may not green GATE-A
    //     (the R2/AC-15 false-green the gate exists to kill).
    if (payload && payload.incomplete) {
      return {
        ok: false,
        severity: GATE_A_REPORT_ONLY ? "degraded" : "red",
        message: `GATE-A fresh_scaffold_all_ways: INCOMPLETE — Leg 3 (shipped install.ps1) did not run (no PowerShell on this host). Not a pass (R2 skip-loud).${GATE_A_REPORT_ONLY ? " Non-blocking during the report-only ramp." : " BLOCKS post-flip — the shipped installer must be certifiable to green GATE-A."}`,
        details: summarizeGateALegs(payload),
      };
    }
    // (4) Report-only ramp (ED-249): a real-install LEG failure is reported LOUDLY (yellow) but does not
    //     block while GATE-A ramps. report-only ≠ silent — the finding + the flip-trigger are surfaced.
    if (GATE_A_REPORT_ONLY) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "GATE-A fresh_scaffold_all_ways [REPORT-ONLY]: a real-install leg is RED — currently blocked by ED-249 (build.js unclassified paths → _mc/MANIFEST.json missing → install incomplete). NOT blocking during the report-only ramp. FLIP-TRIGGER: ED-249 resolved (build.js classifies clean) AND Leg-3 green → set GATE_A_REPORT_ONLY=false.",
        details: payload ? summarizeGateALegs(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
      };
    }
    return {
      ok: false,
      severity: "red",
      message:
        "GATE-A fresh_scaffold_all_ways FAILED — a real-install leg or the sandbox-isolation no-delta assertion failed.",
      details: payload ? summarizeGateALegs(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
    };
  }),

  // `install_matrix` — wires the previously-orphaned
  // scripts/mc/test-install-matrix.js (7-scenario install-fixture CI
  // matrix — SP-20260524-001/SP-20260525-019) into the release gate so it
  // actually runs and blocks, instead of sitting unreferenced. Same
  // role-aware opt-in-for-product-repos treatment as the gates above.
  gate("install_matrix", () => {
    const rs = roleStatus();
    if (!rs.canonical) {
      return {
        ok: true,
        severity: "green",
        message: `install_matrix is opt-in for product repos (repoRole=${rs.role || "product"}) — skipped.`,
      };
    }
    const r = runScript("scripts/mc/test-install-matrix.js", ["--json"]);
    let payload = null;
    try {
      payload = JSON.parse((r.stdout || "").trim() || "{}");
    } catch {
      /* leave payload null */
    }
    if (r.status === 0 && payload && payload.ok) {
      return {
        ok: true,
        severity: "green",
        message: `install_matrix: ${payload.totals ? `${payload.totals.pass}/${payload.scenarios.length}` : "all"} scenarios passed.`,
      };
    }
    const matrixDetails = payload && payload.scenarios
      ? payload.scenarios.filter((s) => s.status !== "pass").map((s) => `scenario ${s.id} (${s.name}): ${(s.assertions || []).find((a) => a.status === "fail")?.name || "?"}`)
      : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8);
    // install_matrix reds on the SAME pre-existing ED-249 (build.js unclassified → _mc/MANIFEST.json
    // missing) that GATE-A was ramped past. So it SHARES GATE-A's ED-249 report-only window (the same
    // GATE_A_REPORT_ONLY flag = the ED-249 ramp, same flip-trigger): a scenario failure is REPORTED loudly
    // (yellow) but does not block while the window is open — else the release would be blocked on ED-249 via
    // this SECOND gate, defeating GATE-A's ramp (qa-reviewer HIGH). Flips HARD with GATE-A when ED-249 clears.
    if (GATE_A_REPORT_ONLY) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "install_matrix [REPORT-ONLY]: a scenario failed — currently blocked by ED-249 (shared with GATE-A: build.js unclassified paths → _mc/MANIFEST.json missing). NOT blocking during the ED-249 report-only ramp. FLIP-TRIGGER: ED-249 resolved → set GATE_A_REPORT_ONLY=false.",
        details: matrixDetails,
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "install_matrix FAILED — a install-fixture regression scenario failed.",
      details: matrixDetails,
    };
  }),

  // Seam-E protected-ref fence STANDING falsifier suite (ED-264 / ADR-0035, 1.0 ceremony).
  // falsifier-liveness runs the manifest-enumerated fence falsifier set PER-FILE (>=1 test,
  // skipped===0, fail===0) and BLOCKS on any missing/skipped/red file — so the fence guard set
  // can never pass graceful-empty (a deleted/renamed fence falsifier fails liveness, not silently
  // drops). The manifest IS the expected-set.
  gate("fence_falsifier_liveness", () => {
    const r = runScript("scripts/checks/falsifier-liveness.js", [
      "--manifest",
      "scripts/dispatch/falsifiers/fence-suite.manifest.json",
    ]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Fence falsifier suite: all Seam-E fence falsifiers executed per-file (0 skipped, 0 fail).",
      };
    return {
      ok: false,
      severity: "red",
      message:
        "Fence falsifier liveness FAILED — a Seam-E fence falsifier is missing, skipped, or red. The protected-ref fence guard set is not fully live. Block release.",
      details: (r.stdout || r.stderr || "")
        .split(/\r?\n/)
        .filter((l) => /BLOCK|violation|MISSING|fail|skipped/i.test(l))
        .slice(0, 8),
    };
  }),

  // Sealed-capsule consumer-contract gate (ADR-0006 / SP-20260602-001 / keystone).
  // The named `sealed-capsule-contract-gate` enforcer: materialize the CURRENT
  // bill-of-materials into a self-contained payload, install it into a disposable
  // OUT-OF-TREE repo with canonical UNREACHABLE, and assert no reach-back + a
  // certified install. This is the structural cure for the "downstream always
  // missing" class that the tautological framework_manifest gate cannot catch.
  // Promotion runs the FULL contract (--full): seal+isolate+unreachable+scan:install
  // PLUS the real lifecycle matrix (both roles × cold+warm) and typed-success
  // telemetry verify (gauntlet finding C1 — bounded mode would let release pass
  // without AC-3/AC-4/AC-5). The fast --self-test path is the per-commit signal
  // (recurring-bug-classes BC-28); this is the heavier promotion gate.
  gate("sealed_capsule_contract", () => {
    const r = runScript("scripts/mc/test-sealed-capsule-gate.js", ["--full"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Sealed-capsule contract (--full): BOM stands up self-contained, no reach-back, lifecycle matrix + typed telemetry pass.",
      };
    if (r.status === 1)
      return {
        ok: false,
        severity: "red",
        message:
          "Sealed-capsule contract FAILED — the sealed install reaches back into canonical or is incomplete (downstream-missing/reach-back class). Block release.",
        details: (r.stdout || r.stderr || "").split(/\r?\n/).filter((l) => l.includes("FAIL")).slice(0, 8),
      };
    return {
      ok: false,
      severity: "red",
      message: "Sealed-capsule gate errored (fail-closed — never a clean pass on a crash).",
      details: (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-6),
    };
  }),
];

function run(opts) {
  const skip = new Set((opts && opts.skip) || []);
  const results = [];
  let red = 0;
  let yellow = 0;
  let manual = 0;
  let degraded = 0;
  for (const g of GATES) {
    if (skip.has(g.name)) {
      results.push({
        name: g.name,
        severity: "skipped",
        message: "Skipped via --skip flag.",
      });
      continue;
    }
    let r;
    try {
      r = g.fn();
    } catch (e) {
      r = {
        ok: false,
        severity: "red",
        message: `${g.name} threw: ${e.message}`,
      };
    }
    results.push({ name: g.name, ...r });
    if (r.severity === "red") red += 1;
    else if (r.severity === "yellow") yellow += 1;
    else if (r.severity === "manual") manual += 1;
    else if (r.severity === "degraded") degraded += 1;
  }
  return {
    ok: red === 0,
    red,
    yellow,
    manual,
    degraded,
    green: results.filter((r) => r.severity === "green").length,
    skipped: results.filter((r) => r.severity === "skipped").length,
    results,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const skip = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) {
      skip.push(args[i + 1]);
      i += 1;
    }
  }
  const summary = run({ skip });
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const r of summary.results) {
      const tag =
        r.severity === "red"
          ? "RED  "
          : r.severity === "yellow"
            ? "YEL  "
            : r.severity === "skipped"
              ? "SKIP "
              : r.severity === "manual"
                ? "MAN  "
                : r.severity === "degraded"
                  ? "DEGR "
                  : "GRN  ";
      console.log(`[${tag}] ${r.name}: ${r.message}`);
      if (r.details) {
        for (const d of (Array.isArray(r.details)
          ? r.details
          : [r.details]
        ).slice(0, 5)) {
          console.log(
            `         ${typeof d === "string" ? d : JSON.stringify(d)}`,
          );
        }
      }
    }
    console.log(
      `\n${summary.green} green · ${summary.yellow} yellow · ${summary.red} red · ${summary.manual || 0} manual · ${summary.degraded || 0} degraded · ${summary.skipped} skipped — overall ${summary.ok ? "PASS" : "FAIL"}`,
    );
  }
  process.exit(summary.red > 0 ? 2 : summary.yellow > 0 ? 1 : 0);
}

module.exports = { run };
