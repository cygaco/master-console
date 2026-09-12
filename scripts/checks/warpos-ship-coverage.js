#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/checks/warpos-ship-coverage.js — THE systemic enforcer for the
 * "downstream always missing something" class (SP-20260525-024). EXHAUSTIVE
 * as of 0.16.0 (run-0160): every owner=framework path is either shipped or in
 * a reviewed KNOWN_NOT_SHIPPED entry (zero unallowlisted info_gaps, enforced).
 * Also asserts seeded_from integrity: every manifest seeded_from pointer must
 * resolve to a real file. As of 0.16.0 the prefix-drift was RECONCILED in the
 * generator (build.js now emits resolvable paths), so KNOWN_DANGLING_SET is EMPTY
 * and the gate is zero-tolerance: ANY dangling seeded_from is a RED.
 *
 * Root cause it closes: WarpOS has TWO manifests.
 *   - _warpos/MANIFEST.json (SP-20260522-001) — the AUTHORITATIVE per-path
 *     OWNERSHIP declaration (owner=framework|generated|project|runtime). Built by
 *     scripts/warpos/manifest/build.js. Validated by /scan:warpos-manifest-coverage.
 *   - .claude/framework-manifest.json — what /warp:setup AND /warp:update actually
 *     SHIP (assets[]). Built by scripts/generate-framework-manifest.js (ASSET_DIRS).
 * Nothing asserted the second covers the first. So a framework-owned path absent
 * from ASSET_DIRS shipped to NOBODY, silently, with green gates (the existing
 * framework_manifest gate is tautological — it only checks the manifest matches
 * its own generator). framework/templates/* (the canon + bootstrap + sprint
 * templates) was the live casualty: 0 of 53 shipped.
 *
 * This check diffs them: every owner=framework path in _warpos/MANIFEST.json MUST
 * be shipped by framework-manifest.json — OR be in KNOWN_NOT_SHIPPED, which makes
 * every exclusion a CONSCIOUS, reviewed decision (the "name the enforcer / name
 * the exclusion" rule applied to content). RED if any framework-owned path is
 * neither shipped nor explicitly excluded.
 *
 * Also asserts seeded_from integrity: every `seeded_from` value in _warpos/MANIFEST.json
 * must point at an existing file (path.join(ROOT, seeded_from) exists). Any dangling
 * seeded_from is a RED. The "100 dangling pointers" of pre-0.16.0 were PREFIX-DRIFT
 * (framework/templates/_requirements/... — a path that never existed) caused by a no-op
 * .replace() in build.js; the fix repointed the generator at the real resolvable paths
 * (_requirements/... and the decision-policy file), so KNOWN_DANGLING_SET is now EMPTY.
 * A future dangle must be added as an EXACT string (not a prefix) with a tracked reason.
 *
 * Wire into scripts/warpos/release-gates.js so "forgot to ship X" fails the
 * release loudly instead of surfacing months later in a consumer install.
 *
 * Exit: 0 = every framework-owned path ships or is allowlisted (zero hard_gaps AND zero
 *           info_gaps) AND all seeded_from pointers resolve or are in KNOWN_DANGLING_SET;
 *       1 = gap(s) [hard_gaps | info_gaps | boundary_violations | dangling_unallowlisted];
 *       2 = setup error.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.argv.includes("--root")
  ? path.resolve(process.argv[process.argv.indexOf("--root") + 1])
  : process.cwd();
const JSON_OUT = process.argv.includes("--json");

// ── KNOWN_DANGLING: EMPTY as of 0.16.0 (prefix-drift reconciled in the generator) ─
// The pre-0.16.0 "100 dangling seeded_from" were PREFIX-DRIFT: build.js emitted
// framework/templates/_requirements/<x> (a path that never existed) via a no-op
// .replace(). The fix repointed the generator at the real resolvable paths, so there
// are ZERO dangling pointers and this set is intentionally EMPTY. The gate is now
// zero-tolerance: ANY dangling seeded_from is a RED. A future dangle (e.g. when the
// _warpos/templates/ end-state lands, SP-20260522-001) must be added here as an EXACT
// string (not a prefix) with a reason tying it to a tracked sprint.
const KNOWN_DANGLING_SET = new Set([]);

// ── KNOWN_NOT_SHIPPED: framework-owned on disk but intentionally NOT shipped ──
// Deliberate, reviewed exclusions: framework-owned on disk but intentionally
// NOT shipped via framework-manifest. Each MUST have a reason.
// Supports two forms:
//   { prefix: "...", reason: "..." }  — path equals or starts with prefix
//   { match: (p) => bool, reason: "..." } — custom predicate (use for patterns)
const KNOWN_NOT_SHIPPED = [
  // _warpos/ is the framework source-of-truth zone. Most of it SHIPS from canonical
  // (e.g. _warpos/templates/* — the master seeds — must fall through to the shipped
  // set, NOT be allowlisted). Only the per-install build/compiler artifacts are
  // not-shipped, carved narrowly so an unshipped template can never hide here again
  // (the old blanket `_warpos/` entry masked exactly that gap).
  { prefix: "_warpos/MANIFEST.json", reason: "build-output ownership manifest, not shipped from canonical" },
  { prefix: "_warpos/settings/", reason: "layered-settings compiler source, not shipped from canonical" },
  // SP-20260618-001: pristine post-install seed snapshot, the diff target for the
  // DEFERRED validate.js:30 owner=project seed-drift check. Build-output reference
  // (gets a per-install generator when seed-drift lands — addendum §1 deferred-debt);
  // not shipped from canonical (consumers generate their own). Narrow prefix so
  // _warpos/templates/ still falls through to the shipped set.
  { prefix: "_warpos/BASELINE/", reason: "build-output seed snapshot for the deferred validate.js:30 seed-drift diff; not shipped from canonical (per-install generator pending)" },
  // W4 restructure (c89a73a7): labeled reference examples relocated OUT of canonical
  // _requirements/ to keep installs product-agnostic. Framework-owned on disk for
  // canonical reference only; shipping a product example (e.g. the origin product) into every
  // install would re-introduce product-specific content — the exact thing W4 removed.
  // Consumers generate their own canon via the canon engine. Narrow prefix so
  // _warpos/templates/ still falls through to the shipped set.
  { prefix: "_warpos/EXAMPLES/", reason: "W4 labeled reference examples — UNTRACKED + gitignored in S-OS-04 (private product tree); rule retained so a re-tracked copy can never ship; the synthetic example lives at _warpos/BASELINE/; consumers generate their own canon" },
  // WarpOS-as-product canon — root-leak pending 0.10.0 scrub; product content,
  // never shipped (consumers generate their own via the canon engine).
  { prefix: "_requirements/00-canonical/", reason: "WarpOS product canon (root-leak pending scrub); consumers generate their own" },
  // Dev-only / framework-maintenance artifacts (already excluded from ASSET_DIRS).
  { prefix: "scripts/one-off/", reason: "framework-dev one-off scripts (directory)" },
  { prefix: "scripts/products/", reason: "framework-dev product scripts" },
  // Installer self + dev metadata.
  { prefix: "install.ps1", reason: "the installer itself (consumers run it, don't receive a copy via manifest)" },
  { prefix: "install.sh", reason: "the installer itself" },
  { prefix: "package.json", reason: "framework-dev metadata" },
  { prefix: "package-lock.json", reason: "framework-dev metadata" },
  { prefix: "README.md", reason: "framework-repo readme; consumers get their own scaffolded PROJECT.md/README" },
  { prefix: "CLAUDE.md", reason: "merged separately by /warp:setup CLAUDE.md merge, not a manifest asset" },
  { prefix: "version.json", reason: "shipped as version_file (separate manifest section), not an asset dir" },

  // ── Exhaustive dev-tooling allowlist (SP-20260525-024 follow-up; run-0160 curation) ──
  // Root dev documents — framework-authoring docs, never shipped to consumers.
  { prefix: ".gitattributes", reason: "framework-repo git config — dev-tooling, not shipped to consumers" },
  { prefix: "DICTIONARY.md", reason: "framework-repo authoring glossary — dev-tooling, not shipped to consumers" },
  { prefix: "INTERESTING.md", reason: "framework-repo project notes — dev-tooling, not shipped to consumers" },
  { prefix: "PROJECT.md", reason: "framework-repo project doc — dev-tooling; consumers get their own scaffolded PROJECT.md" },
  { prefix: "RELEASES.md", reason: "framework-repo release notes — dev-tooling, not shipped to consumers" },
  { prefix: "ROADMAP.md", reason: "framework-repo roadmap — dev-tooling, not shipped to consumers" },
  { prefix: "USER_GUIDE.md", reason: "framework-repo user guide — dev-tooling; consumers get per-product docs" },

  // Framework version migrations — internal tooling, not shipped to consumers.
  { prefix: "migrations/", reason: "framework version migration scripts — internal tooling, never shipped to consumers" },

  // Framework regression tests — internal test suite, not shipped.
  { prefix: "tests/", reason: "framework regression test suite — internal, never shipped to consumers" },

  // Top-level scripts/*.js — framework-dev orchestrators, analyzers, dashboards.
  // Predicate covers ONLY direct children of scripts/ (no slashes in basename).
  // scripts/hooks/, scripts/warpos/, scripts/checks/ etc. are separately governed
  // by ASSET_DIRS and the hard-signal root check.
  {
    match: (p) => /^scripts\/[^/]+\.js$/.test(p),
    reason: "top-level framework-dev tooling scripts (orchestrators/analyzers/dashboards) — not consumer assets",
  },

  // Framework-internal dev subdirectories.
  { prefix: "scripts/arbitration/", reason: "framework-internal arbitration module — dev-tooling, not shipped" },
  { prefix: "scripts/contracts/", reason: "framework-internal contract validation module + fixtures — dev-tooling, not shipped" },
  { prefix: "scripts/etc/", reason: "framework-internal etc harness module — dev-tooling, not shipped" },
  { prefix: "scripts/growth/", reason: "framework-internal growth analytics scripts — dev-tooling, not shipped" },
  { prefix: "scripts/guides/", reason: "framework-internal guide registry scripts — dev-tooling, not shipped" },
  { prefix: "scripts/models/", reason: "framework-internal model check scripts — dev-tooling, not shipped" },
  { prefix: "scripts/scaffold/", reason: "framework-internal scaffold scripts — dev-tooling, not shipped" },
  { prefix: "scripts/testsuite/", reason: "framework-internal test suite runner — dev-tooling, not shipped" },
  // SP-20260723-005 (β B/0.88): the rest of scripts/enforcement/ SHIPS via the ASSET_DIRS dir-ship (the
  // /scan:full-invoked betaevents-dedup / ed-dup-id / pipe-masks lints + /enforcement:log's next-ed-id +
  // their deps ed-registry/dedup-util — else a product's scaffolded full.md / log.md reference a missing
  // script; they SKIP on an absent WarpOS ledger). builder-right-size is the ONE exception: a build-chain
  // prompt-size heuristic (WARPOS_BUILDER_SIZE_ENFORCE) NOT invoked by any shipped skill — dev-tooling,
  // canonical-only. Prefix covers builder-right-size.js + .test.js (excluded from the dir-ship in
  // generate-framework-manifest.js EXCLUDE_RELATIVE_PREFIXES).
  { prefix: "scripts/enforcement/builder-right-size", reason: "SP-005: builder prompt-size right-sizing heuristic — build-chain dispatch dev-tooling, not invoked by any shipped skill; canonical-only (covers .js + .test.js)" },

  // Stray scratch / manifest-misclassification: these files are owner=framework in the
  // manifest but are per-run scratch artifacts that should eventually be reclassified
  // (deferred; out of scope for this sprint). Allowlisted to avoid false-positive gate
  // failures until the manifest is corrected.
  {
    match: (p) => /^scripts\/delta-[^/]+\.txt$/.test(p),
    reason: "stray scratch: per-run delta output files — manifest-misclassification (should be owner=runtime); deferred reclassification",
  },
  { prefix: "scripts/market-research-fix-1-brief.md", reason: "stray scratch: per-run brief artifact — manifest-misclassification; deferred reclassification" },
  { prefix: "scripts/store-viewer.html", reason: "stray scratch: dev HTML viewer — manifest-misclassification; deferred reclassification" },
  { prefix: "scripts/run-compliance.sh", reason: "stray scratch: dev compliance runner — manifest-misclassification; deferred reclassification" },
  { prefix: "scripts/install-git-hooks.sh", reason: "stray scratch: dev git-hooks installer — manifest-misclassification; deferred reclassification" },
  { prefix: "scripts/path-lint.rules.generated.json", reason: "stray scratch: generated path-lint rules — manifest-misclassification; deferred reclassification" },
];

// Ship-boundary (SP-20260531-002, ADR-0005): the fail-closed allow/deny
// boundary between WarpOS-authored product-facing guides (MUST ship) and operator
// scratch / per-project output (must NEVER ship). Asserted against the shipped set
// in main(). Prefix match on the project-relative path.
const MUST_SHIP_PREFIXES = [
  { prefix: "_guides/", reason: "product-facing launch guides must ship to consumer products" },
];
const MUST_NOT_SHIP_PREFIXES = [
  { prefix: "_planning/", reason: "operator planning scratch — must never ship to products" },
  { prefix: "_reports/", reason: "per-project report output — must never ship to products" },
];

function fail(msg) {
  console.error(`warpos-ship-coverage: ${msg}`);
  process.exit(2);
}

function loadJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) fail(`missing ${rel} — run the manifest builders first`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`invalid JSON in ${rel}: ${e.message}`);
  }
}

// Flatten framework-manifest assets (grouped by kind → arrays of {src,dest})
// into the set of shipped project-relative source paths, plus generated_files +
// any top-level single-file sections.
function shippedPathSet(fm) {
  const set = new Set();
  const addEntry = (e) => {
    if (e && typeof e === "object") {
      if (e.src) set.add(e.src);
      if (e.dest) set.add(e.dest);
    }
  };
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.src || v.dest) addEntry(v);
      else for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(fm.assets);
  // generated_files + version/installer single-file sections may be arrays/objects too
  for (const key of ["generated_files", "version_file", "installer_script"]) {
    if (fm[key]) walk(fm[key]);
  }
  return set;
}

function isAllowlisted(p) {
  return KNOWN_NOT_SHIPPED.find((a) => {
    if (typeof a.match === "function") return a.match(p);
    return p === a.prefix || p.startsWith(a.prefix);
  });
}

function isKnownDangling(seededFrom) {
  return KNOWN_DANGLING_SET.has(seededFrom);
}

// HARD-FAIL roots: the consumer-essential engine. A new owner=framework path
// under these that doesn't ship is unambiguously a ship bug (this is exactly how
// framework/templates/* slipped — 0 of 53 shipped). Gaps elsewhere (top-level
// scripts/*.js dev tooling, tests/, root dev docs) are owner=framework too but
// are framework-internal — reported as INFO, full allowlist curation tracked as
// the SP-20260525-024 follow-up. `owner=framework` is BROADER than
// `consumer-shipped`, so a blanket must-ship over-flags the framework's own tools.
const HARD_SIGNAL_ROOTS = [
  "framework/",
  "schemas/",
  "patterns/",
  ".claude/commands/",
  ".claude/agents/",
];
function isHardSignal(p) {
  return HARD_SIGNAL_ROOTS.some((r) => p.startsWith(r));
}

function main() {
  const own = loadJson("_warpos/MANIFEST.json");
  const fm = loadJson(".claude/framework-manifest.json");
  const shipped = shippedPathSet(fm);

  const ownPaths = own.paths || {};

  // ── seeded_from integrity check ───────────────────────────────────────────
  // Every manifest seeded_from pointer must point at a real file, OR be in
  // KNOWN_DANGLING. Dangling pointers NOT in KNOWN_DANGLING → RED (new regression).
  const danglingAllowlisted = [];
  const danglingUnallowlisted = [];
  let danglingTotal = 0;
  for (const [, entry] of Object.entries(ownPaths)) {
    if (!entry || !entry.seeded_from) continue;
    const sf = entry.seeded_from;
    const resolvedPath = path.join(ROOT, sf);
    if (fs.existsSync(resolvedPath)) continue; // resolves — OK
    danglingTotal++;
    if (isKnownDangling(sf)) {
      danglingAllowlisted.push(sf);
    } else {
      danglingUnallowlisted.push(sf);
    }
  }

  // ── Ship coverage check ───────────────────────────────────────────────────
  const hardGaps = []; // essential-root gaps — RED, block the release
  const infoGaps = []; // dev-tooling gaps — now fully curated; should be 0
  let frameworkOwned = 0;
  for (const [p, entry] of Object.entries(ownPaths)) {
    if (!entry || entry.owner !== "framework") continue;
    if (entry.kind === "dir") continue; // dirs are implied by their files
    frameworkOwned++;
    if (shipped.has(p)) continue;
    if (isAllowlisted(p)) continue;
    if (isHardSignal(p)) hardGaps.push(p);
    else infoGaps.push(p);
  }

  // Ship-boundary assertions (SP-20260531-002, ADR-0005), fail-closed.
  // _guides/** MUST ship (WarpOS-authored product-facing guides); _planning/** +
  // _reports/** must NEVER ship (operator scratch / per-project report output).
  const boundaryViolations = [];
  for (const d of MUST_NOT_SHIP_PREFIXES) {
    for (const p of shipped) {
      if (p === d.prefix || p.startsWith(d.prefix)) {
        boundaryViolations.push(`must-not-ship-present: ${p} — ${d.reason}`);
      }
    }
  }
  for (const m of MUST_SHIP_PREFIXES) {
    const present = [...shipped].some(
      (p) => p === m.prefix || p.startsWith(m.prefix),
    );
    if (!present) {
      boundaryViolations.push(`must-ship-missing: ${m.prefix} — ${m.reason}`);
    }
  }

  const result = {
    ok:
      hardGaps.length === 0 &&
      boundaryViolations.length === 0 &&
      danglingUnallowlisted.length === 0 &&
      infoGaps.length === 0, // FIX1: unallowlisted owner=framework paths now block the gate
    framework_owned_paths: frameworkOwned,
    shipped_paths: shipped.size,
    allowlisted_rules: KNOWN_NOT_SHIPPED.length,
    hard_gaps: hardGaps,
    boundary_violations: boundaryViolations,
    info_gaps_count: infoGaps.length,
    info_gaps: infoGaps,
    // seeded_from integrity
    dangling_seeds_total: danglingTotal,
    dangling_allowlisted: danglingAllowlisted.length,
    dangling_unallowlisted: danglingUnallowlisted,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok) {
      console.log(
        `OK   [warpos-ship-coverage] every framework-owned path ships or is allowlisted (${frameworkOwned} paths scanned, 0 hard_gaps, 0 info_gaps, 0 boundary_violations); seeded_from: ${danglingTotal} dangling (0.16.0: prefix-drift reconciled in the generator; KNOWN_DANGLING_SET empty; zero-tolerance).`,
      );
    } else {
      if (hardGaps.length) {
        console.error(
          `FAIL [warpos-ship-coverage] ${hardGaps.length} essential-root path(s) ship to NOBODY (under framework/|schemas/|patterns/|commands|agents, not shipped, not allowlisted):`,
        );
        for (const g of hardGaps) console.error(`  - ${g}`);
        console.error(
          `Fix: add the covering dir to ASSET_DIRS in scripts/generate-framework-manifest.js, OR add a reviewed KNOWN_NOT_SHIPPED entry.`,
        );
      }
      if (infoGaps.length) {
        // FIX1: info_gaps are now a hard gate failure — an unallowlisted owner=framework
        // path (even outside hard-signal roots) means the exclusion was not consciously
        // reviewed. Add it to KNOWN_NOT_SHIPPED with a reason (the "name the exclusion"
        // rule) or add it to the shipping manifest.
        console.error(
          `FAIL [warpos-ship-coverage] ${infoGaps.length} owner=framework path(s) are not shipped and not in KNOWN_NOT_SHIPPED (unallowlisted — every exclusion must be a conscious reviewed decision):`,
        );
        for (const g of infoGaps) console.error(`  - ${g}`);
        console.error(
          `Fix: add a reviewed KNOWN_NOT_SHIPPED entry with a reason, OR add the path to ASSET_DIRS in scripts/generate-framework-manifest.js to ship it.`,
        );
      }
      if (boundaryViolations.length) {
        console.error(
          `FAIL [warpos-ship-coverage] ${boundaryViolations.length} ship-boundary violation(s) (SP-20260531-002):`,
        );
        for (const b of boundaryViolations) console.error(`  - ${b}`);
        console.error(
          `Fix: _guides/** must ship (ASSET_DIRS); _planning/** + _reports/** must never ship (walk-skip + absent from ASSET_DIRS).`,
        );
      }
      if (danglingUnallowlisted.length) {
        console.error(
          `FAIL [warpos-ship-coverage] ${danglingUnallowlisted.length} seeded_from pointer(s) are dangling and NOT in KNOWN_DANGLING_SET (new regression — exact-match required):`,
        );
        for (const d of danglingUnallowlisted) console.error(`  - ${d}`);
        console.error(
          `Fix: either author the seed template at that path, OR add the exact seeded_from string to KNOWN_DANGLING_SET with a reason tying it to a tracked sprint.`,
        );
      }
    }
    if (danglingTotal > 0 && danglingUnallowlisted.length === 0) {
      console.log(
        `INFO [warpos-ship-coverage] seeded_from: ${danglingTotal} dangling pointer(s), all ${danglingAllowlisted.length} in KNOWN_DANGLING_SET (each an EXACT-string allowlist entry tied to a tracked sprint).`,
      );
    }
  }
  process.exit(result.ok ? 0 : 1);
}

main();
