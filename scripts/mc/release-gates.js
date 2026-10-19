
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { isCanonical, roleStatus } = require("../testsuite/role");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function gate(name, fn) {
  return { name, fn };
}

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
  if (payload && payload.sandbox_isolation && payload.sandbox_isolation.dirty_set_content_unchanged === false) {
    out.push(
      `sandbox-isolation DIRTY-SET CONTENT CHANGED: ${((payload.sandbox_isolation.dirty_set_changed_files || []).slice(0, 5)).join(", ")}`,
    );
  }
  return out.slice(0, 8);
}

const UPGRADE_REQUIRED_NAMED_ASSERTS = [
  "scan_install_green_3b",
  "fresh_n_parity_pathset_3c",
  "fresh_n_parity_type_3c",
  "fresh_n_parity_symlink_target_3c",
  "fresh_n_parity_content_3c",
];
function gateBNamedEvidencePresent(payload) {
  const asserts = (payload && payload.asserts) || [];
  return UPGRADE_REQUIRED_NAMED_ASSERTS.every((name) => {
    const a = asserts.find((x) => x.name === name);
    return !!a && a.ok === true;
  });
}

const FRESH_SCAFFOLD_REPORT_ONLY = false;

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

  gate("config_paths_resolve", () => {
    const r = runScript("scripts/checks/config-path-resolves.js", []);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Config paths: every registered allowlist/config entry resolves in this tree, and the scripts' literal relative requires and spawn targets resolve (tests and fixtures excepted).",
      };
    return {
      ok: false,
      severity: "red",
      message:
        r.status === 1
          ? "Config paths FAILED (exit 1) — an allowlist/config entry names something this tree does not carry, is a predicate the check cannot read, or rests on a stale run-time vouch; or a script requires or spawns a script this tree does not carry. Drop or rewrite the entry, or record its run-time writer in config-path-resolves.js RUNTIME_PATHS; ship the missing script or drop the require."
          : `Config paths FAILED (exit ${r.status}) — the check could not run: git could not list the tree, an allowlist is unregistered, unreadable or malformed, or a registered constant is gone.`,
      details: (r.stdout || r.stderr || "").split("\n").filter((l) => /DANGLING|UNVERIFIABLE|STALE-RUNTIME|UNRESOLVED-|ERROR/.test(l)).slice(0, 10),
    };
  }),

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

  gate("mode_lifecycle_allowlist_review", () => {
    const r = runScript("scripts/checks/mode-lifecycle-hooks-coverage.js", ["--enforce", "--json"]);
    let out = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {
    }
    const flagged = (out && out.allowlistFlagged) || [];
    const gaps = (out && out.gaps) || [];
    if (r.status === 0 && out && flagged.length === 0)
      return {
        ok: true,
        severity: "green",
        message: "Mode-lifecycle coverage clean under --enforce: no allowlist entry flagged at this version, no gap.",
      };
    return {
      ok: false,
      severity: "red",
      message: `Mode-lifecycle allowlist review FAILED (check --enforce exit ${r.status}): ${flagged.length} allowlist entr${flagged.length === 1 ? "y" : "ies"} flagged, ${gaps.length} gap(s). Review each flagged entry: wire its emitter, prune it if the emitter exists, or record a later review_by_version.`,
      details: flagged.length ? flagged.slice(0, 10).map((f) => `${f.event}: ${f.problem}`) : (r.stdout || r.stderr || "").split("\n").filter(Boolean).slice(0, 5),
    };
  }),

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

  gate("reference_integrity", () => {
    return {
      ok: true,
      severity: "manual",
      message:
        "Reference integrity check requires the /scan:references slash skill (no headless equivalent yet) — run manually before /mc:release. Not auto-passed.",
    };
  }),

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

  gate("hook_fixture_tests", () => {
    const r = runScript("scripts/hooks/test.js", ["--all"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Registered hook fixture tests pass.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Hook fixture tests pending — placeholder gate.",
    };
  }),

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
    }
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.no_delta === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "upgrade_current_to_new: SANDBOX-ISOLATION NO-DELTA VIOLATED — the N-1 materialize/apply run leaked into canonical. This BLOCKS unconditionally.",
        details: summarizeGateBAsserts(payload),
      };
    }
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.dirty_set_content_unchanged === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "upgrade_current_to_new: SANDBOX-ISOLATION DIRTY-SET CONTENT CHANGED — an already-dirty canonical file's CONTENT changed during the run (a porcelain status-line diff cannot see this). This BLOCKS unconditionally.",
        details: summarizeGateBAsserts(payload),
      };
    }
    if (payload && payload.incomplete === true) {
      return {
        ok: true,
        severity: "manual",
        message: `upgrade_current_to_new: INCOMPLETE (skip-loud) — ${payload.incomplete_reason || "no unreleased capsule cut; the full path runs at the release ceremony."}`,
      };
    }
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
        message: `upgrade_current_to_new: ${payload.from_version} -> ${payload.to_version} applied and conforms (ps_available=${payload.ps_available}).`,
      };
    }
    if (payload && payload.ps_available === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "upgrade_current_to_new: INCOMPLETE — no PowerShell on this host, the real N-1/N installs cannot run. Not a pass (skip-loud); BLOCKS release.",
        details: summarizeGateBAsserts(payload),
      };
    }
    if (!payload || !payload.ran && !(payload.asserts && payload.asserts.length)) {
      return {
        ok: false,
        severity: "red",
        message: "upgrade_current_to_new engine errored (no parseable --json payload or no asserts produced).",
        details: payload ? summarizeGateBAsserts(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
      };
    }
    return {
      ok: false,
      severity: "red",
      message: `upgrade_current_to_new FAILED — ${payload.from_version || "?"} -> ${payload.to_version || "?"}: a load-bearing assert failed.`,
      details: summarizeGateBAsserts(payload),
    };
  }),

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
    let preExisting = [];
    let newlyAdded = [];
    try {
      const allTracked = execSync(
        `git ls-files ${RUNTIME_LEAK_PATTERNS.join(" ")}`,
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
        .split("\n")
        .filter((l) => l.trim());
      let recentlyAdded = [];
      let mergeBase = null;
      try {
        mergeBase = execSync(`git merge-base HEAD master`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
        }).trim();
      } catch {
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
        message: `${preExisting.length} pre-existing runtime files are git-tracked from prior commits — schedule cleanup (\`git rm --cached\` + .gitignore additions). Not blocking release.`,
        details: preExisting.slice(0, 5),
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "No runtime / per-session files leaked into git.",
    };
  }),

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
        message: `No release capsule for ${v.version} yet — run /mc:release ${v.version}.`,
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

  gate("path_usage", () => {
    const r = runScript("scripts/checks/path-usage.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message:
          "Path-usage audit found active consumers for previously flagged keys.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Path usage audit found unused flagged keys.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  gate("regression_seed", () => {
    const rs = roleStatus();
    if (!rs.canonical) {
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
    }
    if (payload && payload.sandbox_isolation && payload.sandbox_isolation.no_delta === false) {
      return {
        ok: false,
        severity: "red",
        message:
          "fresh_scaffold_all_ways: SANDBOX-ISOLATION NO-DELTA VIOLATED — a real-install leg leaked into canonical. This BLOCKS unconditionally (never softened by incomplete or report-only).",
        details: summarizeGateALegs(payload),
      };
    }
    if (r.status === 0 && payload && payload.ok) {
      return {
        ok: true,
        severity: "green",
        message: `fresh_scaffold_all_ways: all 3 legs pass, sandbox-isolation no-delta held (ps_available=${payload.ps_available}).`,
      };
    }
    if (payload && payload.incomplete) {
      return {
        ok: false,
        severity: FRESH_SCAFFOLD_REPORT_ONLY ? "degraded" : "red",
        message: `fresh_scaffold_all_ways: INCOMPLETE — Leg 3 (shipped install.ps1) did not run (no PowerShell on this host). Not a pass (skip-loud).${FRESH_SCAFFOLD_REPORT_ONLY ? " Non-blocking during the report-only ramp." : " BLOCKS post-flip — the shipped installer must be certifiable to green the fresh-scaffold gate."}`,
        details: summarizeGateALegs(payload),
      };
    }
    if (FRESH_SCAFFOLD_REPORT_ONLY) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "fresh_scaffold_all_ways [REPORT-ONLY]: a real-install leg is RED. NOT blocking during the report-only ramp. FLIP-TRIGGER: build.js classifies clean AND Leg-3 green → set FRESH_SCAFFOLD_REPORT_ONLY=false.",
        details: payload ? summarizeGateALegs(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
      };
    }
    return {
      ok: false,
      severity: "red",
      message:
        "fresh_scaffold_all_ways FAILED — a real-install leg or the sandbox-isolation no-delta assertion failed.",
      details: payload ? summarizeGateALegs(payload) : (r.stderr || r.stdout || "").split(/\r?\n/).filter(Boolean).slice(-8),
    };
  }),

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
    if (FRESH_SCAFFOLD_REPORT_ONLY) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "install_matrix [REPORT-ONLY]: a scenario failed. NOT blocking during the report-only ramp. FLIP-TRIGGER: unclassified paths resolved → set FRESH_SCAFFOLD_REPORT_ONLY=false.",
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
