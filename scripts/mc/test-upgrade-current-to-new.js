#!/usr/bin/env node
/**
 * scripts/mc/test-upgrade-current-to-new.js
 *
 * GATE-B `upgrade_current_to_new` engine (SP-20260721-001 D-4 INC-3).
 *
 * The operator's D-4 standing standard #2 ("upgrade current->new works, for
 * real"): materializes a REAL N-1 install in a sandbox, runs the REAL
 * `update.js --apply` against it (never the --json CLI, which silent-greens a
 * Class-C/preflight-block — see Step 2 below), and proves canonical was never
 * touched (reuses GATE-A's sandbox-isolation harness verbatim).
 *
 * Full engine shape: Step 0 (resolve N/N-1 via tagged-release capsules, fail-
 * closed on any git-tag query error) -> Step 1 (materialize a REAL N-1
 * install via git-tag worktree + its own install.ps1) -> Step 2 (real apply
 * via run(), never the --json CLI) -> 3a (cheap, NON-load-bearing version-
 * sanity signal) -> 3b (LOAD-BEARING: scan:install GREEN on the upgraded
 * tree) -> 3c (LOAD-BEARING: FULL-TREE parity vs a fresh-N oracle install via
 * test-scaffold-all-ways#runLeg3, over TYPED entries — {rel, type: "file" |
 * "symlink", target?} — never string-marker paths, R3-3): path-set parity
 * over the rel KEYS, then per common key a type check (file vs symlink,
 * R3-3), a symlink TARGET-string check (never followed, R3-2), and file
 * CONTENT parity via a NAMED-allowlist-only normalization (R3-1 — every file
 * NOT in the small enumerated allowlist of known-volatile install artifacts
 * is byte-exact, regardless of UTF-8/binary classification), including
 * framework-installed.json so a stuck/wrong installedVersion is caught here,
 * not only by non-load-bearing 3a). Sandbox isolation (no-delta on canonical
 * `git status`, plus a content-hash compensating control over the
 * already-dirty file set — see `dirty_set_content_unchanged`) is checked
 * unconditionally and blocks before any green verdict, regardless of asserts.
 * `ok` requires: isolation held (both checks) AND every load-bearing assert
 * passed AND the NAMED load-bearing evidence (`scan_install_green_3b`,
 * `fresh_n_parity_pathset_3c`, `fresh_n_parity_type_3c`,
 * `fresh_n_parity_symlink_target_3c`, `fresh_n_parity_content_3c`) is present
 * and green — never merely "the set of load-bearing asserts happened to be
 * non-empty and pass". 3a is excluded from `ok` on purpose; it can appear in
 * `asserts` but can never flip the verdict alone.
 *
 * Usage:
 *   node scripts/mc/test-upgrade-current-to-new.js [--json] [--timeout-ms <n>] [--help]
 *
 * Exit codes: 0 = every emitted assert passed + isolation held; 1 = an assert
 * failed, a required step didn't run, or isolation was violated; 2 = usage/
 * internal error (fail-CLOSED — a crash is never a pass).
 */
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const {
  assertSandboxTargetSafe,
  snapshotCanonicalState,
  noDeltaCheck,
  findPowershellReal,
  runLeg3,
} = require("./test-scaffold-all-ways");
// NOTE: `treeFileList` deliberately NOT imported here — test-install-matrix.js's
// version is SCOPED (.claude/_mc/_requirements/_docs/ROADMAP.md/PROJECT.md
// only), for THAT script's own narrower parity contract. GATE-B's 3c claims
// FULL-TREE parity, so it uses its own `fullTreeFileList` (below), which walks
// EVERY file under the install root. `parityDiff` (a generic set-diff) is
// still shared.
const { parityDiff } = require("./test-install-matrix");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_TIMEOUT_MS = 240_000;
const SCAN_INSTALL_TIMEOUT_MS = 60_000;
const ORACLE_TIMEOUT_MS = 180_000;

// ── Step 0 — resolve N (current) and N-1 (highest release capsule < N) ─────
function semverParts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ""));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

function semverLt(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

function semverCompare(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Fail-closed: throws if version.json is unreadable, if resolving the
// unreleased-cut's identity fails to bind to version.json (see
// checkUnreleasedCutIdentity below), or if a tag query itself errors (see
// tagExists below); returns n1:null (never a guess) if no capsule strictly
// below N exists under framework/releases/.
//
// (F1 — qa FUNC-INCOMPLETE-FAILOPEN / TRACE-B-SEMANTICS) A git ERROR querying
// a tag must NEVER be folded into ordinary "tag absent" — that silently
// degrades a real git failure into the B-semantics "no unreleased cut"
// INCOMPLETE path (skip-loud, renders manual, never blocks). Split the
// outcomes: a CLEAN result (git exits 0) yields a definitive true/false by
// stdout (`git tag -l <pattern>` exits 0 with empty stdout for a genuine
// no-match — that is real tag-absence, not an error). A git ERROR (spawn
// error, signal/timeout, or ANY non-zero exit — `git tag -l` never exits
// non-zero for "no match") THROWS, so the caller (resolveVersions, then
// runEngine's `n1_resolved` assert) propagates it as a LOAD-BEARING failure —
// the engine/gate FAIL-CLOSED (red), never fail-open to manual.
// `spawnFn` is injectable for testability (mirrors runLeg3's `findPs` seam)
// without needing a real git failure to exercise the fail-closed path.
function tagExists(version, spawnFn = spawnSync) {
  const r = spawnFn("git", ["tag", "-l", `mc@${version}`], { cwd: REPO_ROOT, encoding: "utf8", timeout: 15_000 });
  if (r && r.error) {
    throw new Error(`tagExists(${version}): git spawn error: ${r.error.message}`);
  }
  if (r && r.signal) {
    throw new Error(`tagExists(${version}): git tag -l TIMEOUT/KILLED (signal=${r.signal})`);
  }
  if (!r || r.status !== 0) {
    throw new Error(
      `tagExists(${version}): git tag -l exited non-zero (status=${r && r.status}): ${((r && (r.stderr || r.stdout)) || "").slice(0, 300)}`,
    );
  }
  return (r.stdout || "").trim() === `mc@${version}`;
}

// (F1 identity bind) version.json is the current tree's release identity —
// fail-closed if unreadable or malformed (never a silent skip).
function readCurrentVersion() {
  const versionPath = path.join(REPO_ROOT, "version.json");
  const raw = fs.readFileSync(versionPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`version.json at ${versionPath} has no usable .version field`);
  }
  return parsed.version;
}

// (F1 — qa TRACE-B-SEMANTICS) BIND identity: the selected unreleased-cut N
// must equal version.json's version (the current tree's release identity).
// Without this, a stale/foreign untagged capsule dir could be selected as N
// even though it does not represent the tree actually under test — a
// phantom N. Throws (fail-closed) on mismatch; never silently substitutes.
function checkUnreleasedCutIdentity(unreleasedCut, currentVersion) {
  if (unreleasedCut !== currentVersion) {
    throw new Error(
      `identity mismatch: selected unreleased-cut N=${unreleasedCut} does not equal version.json's version=${currentVersion} — refusing to select a phantom N (fail-closed)`,
    );
  }
  return true;
}

// B semantics (ceremony-faithful): upgrade the newest SHIPPED release -> what we
// are ABOUT TO SHIP. "About to ship" = a capsule that has been CUT (dir +
// release.json) but not yet TAGGED (the release-in-progress). A capsule whose
// mc@<v> tag already exists is a SHIPPED, frozen release.
//   - unreleasedCut = highest capsule with NO mc@<v> tag AND strictly above
//     the newest TAGGED capsule = the ceremony's fresh cut. Its content == the
//     current tree, so apply(--source=current) and oracle(fresh from current)
//     are identity-consistent.
//   - none => INCOMPLETE (skip-loud): there is no unreleased release to upgrade
//     TO. Testing against a frozen shipped capsule skews by post-cut drift and
//     hits baked shipped-drift (ED-251) — proves nothing about the release being
//     cut. The full upgrade->conformance path runs at the CEREMONY.
// `tagExistsFn` is injectable (defaults to the real `tagExists`) so a git-tag
// ERROR can be exercised synthetically without needing a real git failure —
// see selfTest()'s F1 tooth. Any error thrown by `tagExistsFn` propagates
// straight out of this function uncaught (fail-closed) — the caller
// (runEngine) already wraps `resolveVersions()` in a try/catch that asserts
// `n1_resolved:false` (LOAD-BEARING) on throw, never folding it into the
// ordinary "no unreleased cut" INCOMPLETE (skip-loud/manual) path.
function resolveVersions({ tagExistsFn = tagExists } = {}) {
  const releasesDir = path.join(REPO_ROOT, "framework", "releases");
  const capsules = fs
    .readdirSync(releasesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && semverParts(d.name))
    .filter((d) => fs.existsSync(path.join(releasesDir, d.name, "release.json")))
    .map((d) => d.name)
    .sort(semverCompare);
  if (!capsules.length) {
    return { incomplete: true, reason: "no release capsules under framework/releases/ — nothing to resolve" };
  }
  const tagged = capsules.filter((v) => tagExistsFn(v));
  const newestTagged = tagged.length ? tagged[tagged.length - 1] : null;
  const unreleased = capsules.filter(
    (v) => !tagExistsFn(v) && v !== newestTagged && (!newestTagged || !semverLt(v, newestTagged)),
  );
  const unreleasedCut = unreleased.length ? unreleased[unreleased.length - 1] : null;
  if (unreleasedCut && newestTagged) {
    // F1 identity bind — throws (fail-closed) on mismatch, never selects a
    // phantom N. See checkUnreleasedCutIdentity above.
    checkUnreleasedCutIdentity(unreleasedCut, readCurrentVersion());
    return { incomplete: false, n: unreleasedCut, n1: newestTagged };
  }
  return {
    incomplete: true,
    reason: `no unreleased capsule cut (newest shipped/tagged=${newestTagged || "none"}); the full upgrade->conformance path runs at the ceremony when a fresh capsule is cut from the current tree. Mid-dev, a frozen shipped capsule skews by post-cut drift (ED-251) and proves nothing about the release being cut.`,
  };
}

function describeSpawnFailure(r) {
  if (!r) return "no result (spawn never returned)";
  if (r.error) return `spawn error: ${r.error.message}`;
  if (r.signal) return `TIMEOUT/KILLED (signal=${r.signal}) — fail-closed`;
  // ED-262 FIX: surface the ACTUAL FAILING-check line(s), not a blind byte-tail. A `slice(-400)`
  // keeps the output TAIL, which drops the head where the FAIL line lives — it once rendered a
  // `manifest.mc.version matches version.json` FAIL as an adjacent OK "agent under
  // agents/president" line whose "OK" prefix got truncated, sending triage down a false
  // "president-missing" path (a whole investigation for a version-stamp bug). Key the report to the
  // failing assertion; fall back to the byte-tail ONLY when no FAIL marker is present (non-check
  // spawns: git-worktree / install.ps1, whose failures carry no FAIL/MISSING/ERROR line convention).
  // Diagnostic only — the gate keys on `status === 0`, never on this string.
  const raw = `${r.stdout || ""}\n${r.stderr || ""}`;
  const failing = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(FAIL|MISSING|ERROR)\b/i.test(l));
  if (failing.length) {
    const shown = failing.slice(0, 8);
    const extra = failing.length > shown.length ? ` (+${failing.length - shown.length} more)` : "";
    return `code=${r.status} FAILING: ${shown.join(" | ")}${extra}`;
  }
  return `code=${r.status} ${(r.stderr || r.stdout || "").slice(-400)}`;
}

// ── Step 3 conformance — pure-ish helpers (factored so the self-test can feed
// them SYNTHETIC fixtures without a real 2-install run) ────────────────────

// (3a) NON-LOAD-BEARING settable-label check (β#1): reads a field
// `update.js --apply` writes itself. Catches a non-advancing version; does
// NOT prove correctness. Never allowed to gate `ok` alone (see runEngine's
// verdict wiring).
function check3aVersionSanity(installedVersion, expectedVersion) {
  const ok = installedVersion === expectedVersion;
  return {
    ok,
    detail: `installedVersion=${installedVersion} expected=${expectedVersion} (non-load-bearing settable-label check; defeated by 3c/3b, not absent here)`,
  };
}

// (3b) LOAD-BEARING schema-absolute check: scan:install GREEN on the
// upgraded tree, independent of anything the apply self-reports.
function check3bScanInstall(scanResult) {
  const ok = !!scanResult && scanResult.status === 0;
  return {
    ok,
    detail: ok ? "" : `scan:install exited non-zero: ${describeSpawnFailure(scanResult)}`,
  };
}

// (3c) LOAD-BEARING convergence-to-oracle — content-parity normalization
// (β#3, R4 lesson: MINIMAL, ENUMERATED, one-line why each). Each rule targets
// ONLY a named volatile-substring class. None touch `version`, non-volatile
// JSON fields, or file bodies broadly — a too-broad rule here would
// false-green a half-applied upgrade.
function replaceAllLiteral(haystack, needle, replacement) {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

// ORDER MATTERS: the two exact-literal rules (absolute_sandbox_path,
// per_run_nonce) run FIRST, before the generic pattern-based rules
// (iso_timestamp, transaction_id). A sandbox tmp-dir name can incidentally
// contain a substring shaped like a timestamp or txn-id — if a generic regex
// rule ran first it could partially consume an exact-literal match, leaving
// the rest unnormalized and producing a false content mismatch. Running the
// known exact substitutions first, then generic patterns on what's left,
// avoids that class of order-dependent false-red.
//
// (F5 — qa FUNC-NORMALIZATION-OVERBROAD / backend 7G-001) `per_run_nonce` used
// to be a GENERIC regex (`/\b[0-9a-z]{6,13}-[0-9a-z]{4,8}\b/`) that normalized
// ANY token of that shape — proved to false-green real content drift (e.g.
// "release-alpha" vs "release-bravo" both collapsed to the same placeholder).
// It is now a LITERAL replacement of the ACTUAL minted nonce(s) for this run,
// threaded through `ctx.nonces` exactly like `ctx.sandboxRoots` — never a
// pattern. A nonce-SHAPED string that is NOT one of this run's actual minted
// nonces is real content and must still diverge.
const NORMALIZE_3C = [
  {
    name: "absolute_sandbox_path",
    why: "the upgraded tree and the fresh-N oracle tree live under two DIFFERENT os.tmpdir() sandbox roots minted once per engine run; a path pointing back at either root is sandbox-identity, never install content",
    apply: (text, ctx) => {
      let out = text;
      for (const root of (ctx && ctx.sandboxRoots) || []) {
        if (!root) continue;
        out = replaceAllLiteral(out, root, "<NORMALIZED-SANDBOX-PATH>");
        out = replaceAllLiteral(out, root.split(path.sep).join("/"), "<NORMALIZED-SANDBOX-PATH>");
        out = replaceAllLiteral(out, JSON.stringify(root).slice(1, -1), "<NORMALIZED-SANDBOX-PATH>");
      }
      return out;
    },
  },
  {
    name: "per_run_nonce",
    why: "this engine mints a per-run nonce for tmp-dir naming; if the EXACT minted literal leaks into an installed artifact it is run-identity, not upgrade content — normalized as a literal (ctx.nonces), never a shape-based pattern (see F5)",
    apply: (text, ctx) => {
      let out = text;
      for (const n of (ctx && ctx.nonces) || []) {
        if (!n) continue;
        out = replaceAllLiteral(out, n, "<NORMALIZED-NONCE>");
      }
      return out;
    },
  },
  {
    name: "iso_timestamp",
    why: "install/apply/regen stamp real wall-clock ISO-8601 timestamps (installedAt, generatedAt, ...); two independent runs never share a clock reading by construction, not by upgrade defect",
    // (d) ED-264: the trailing zone must also match PowerShell's TZ-OFFSET form (e.g.
    // "2026-07-22T08:20:23.3501290-07:00" from install.ps1's fresh-N installedAt) — not only "Z". Without
    // the offset alternative the offset survived normalization and false-RED'd framework-installed.json.
    apply: (text) => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, "<NORMALIZED-TS>"),
  },
  {
    name: "transaction_id",
    why: "update.js's transaction system stamps a fresh transaction id into per-run bookkeeping on every --apply; two independent runs never share one by design",
    apply: (text) => text.replace(/("(?:transactionId|transaction_id|txnId|txn_id)"\s*:\s*")[^"]*(")/g, "$1<NORMALIZED-TXN>$2"),
  },
];

function normalizeContent3c(text, ctx) {
  let out = text;
  for (const rule of NORMALIZE_3C) out = rule.apply(out, ctx);
  return out;
}

// (R3-1 — qa 7C-003 / FUNC-3C-NORMALIZE-OVERBROAD) Content normalization
// applies ONLY to this NAMED, ENUMERATED set of known-volatile install
// artifacts — files that LEGITIMATELY differ between a fresh-N install and
// an upgraded-N-from-N-1 install because they are themselves REGENERATED
// per-run by the install/apply/regen tooling. Previously `isRoundTripUtf8`
// was used as a "this looks like text" GATE deciding whether ANY file was
// eligible for normalization — but round-trip-UTF-8-safe is a property of
// essentially any byte sequence that happens to decode cleanly (which
// includes plenty of non-text/binary content), so an adversarial file
// crafted with a timestamp/txn-id-shaped substring could be normalized away
// and false-green a real byte divergence. Every file NOT in this set
// compares BYTE-EXACT, full stop — binary-vs-text classification never
// enters the decision at all.
const NORMALIZE_ALLOWED_RELPATHS = new Map([
  // NOTE (β (a) ruling): .claude/framework-installed.json and _mc/MANIFEST.json are NOT normalized here —
  // they are STRUCTURED-compared (compareFrameworkInstalledRecord / compareMcManifestInventory) so their
  // framework-owned fields stay under a load-bearing check while per-install fields/entries are filtered.
  [
    ".claude/manifest.json",
    "regenerated by install.ps1/update.js at install time; carries the run's mc.source provenance, repointed independently on each leg (Step 1.5)",
  ],
  [
    ".claude/paths.json",
    "regenerated by scripts/paths/build.js at install/regen time from the paths registry, independently per leg",
  ],
  [
    ".claude/framework-manifest.json",
    "regenerated by scripts/generate-framework-manifest.js at install/regen time, independently per leg",
  ],
  [
    ".claude/settings.json",
    "recompiled by scripts/hooks/build.js at install/regen time; carries a _compiledAt ISO timestamp stamped fresh per run — two independent runs never share the clock reading (bundle-3 / ED-264 (d))",
  ],
]);

// ED-263 FROZEN-ACCEPT set (bundle-3 / 1.0 ceremony): the frozen, IMMUTABLE N-1 release tag COMMITTED
// runtime/generated-in-place artifacts that a fresh-N install never ships (or that only the update-side
// regen produces), so they appear onlyInUpgraded FOREVER — the N-1 tag cannot be re-frozen. Accept ONLY
// this named/patterned immutable set. Any OTHER onlyInUpgraded path (a NEW pollution class) still REDs —
// that is the structural tooth (the filter only ever removes THESE).
const ACCEPT_ONLY_IN_UPGRADED_3C = [
  { re: /^\.claude\/\.last-checkpoint$/, why: "per-session runtime checkpoint committed into the frozen N-1 tag; fresh-N never ships it" },
  { re: /^\.claude\/\.session-checkpoint\.json$/, why: "per-session runtime checkpoint (frozen N-1 tag)" },
  { re: /^\.claude\/project\/builds\/builder-fixture-[0-9a-f]+\/transaction\.json$/, why: "a builder-fixture transaction record committed into the frozen N-1 tag (per-fixture nonce); fresh-N never ships it" },
  { re: /^_mc\/agents\/president\/_system\/policy\/decision-policy\.md$/, why: "a _mc source-mirror policy copy committed into the frozen N-1 tag; not in the fresh-N install set" },
  // REMOVED (β beta-ceremony-broader-delegation-b089 — dead-accept bar): _requirements/03-architecture/PATH_KEYS.md
  // AND scripts/path-lint.rules.generated.json were accepted because "fresh-N does not ship them (update-side
  // regen only)". The bug-1 delegation makes the FRESH install run scripts/paths/build.js, which GENERATES both
  // (build.js:12/42/116) — so both are now COMMON to fresh + upgrade (byte-equal, proven in KEEP run4) and no
  // longer onlyInUpgraded. Retaining an accept for a now-shipped file is a latent FALSE-GREEN (it would silently
  // accept a REAL future onlyInUpgraded divergence of these paths). ED-263-accepted drops 6→4 (verified run4).
];
function isFrozenAcceptedOnlyInUpgraded(rel) {
  return ACCEPT_ONLY_IN_UPGRADED_3C.some((e) => e.re.test(rel));
}

// CONTENT preserve-by-design divergence (β b090 disposition): files whose CONTENT legitimately differs
// between a fresh-N install (defaults) and an upgraded-N tree (preserved runtime state) in a way that is
// NOT normalizable and MUST NOT be regenerated. Excluded from the byte/normalization content parity.
const CONTENT_PRESERVE_DIVERGENCE_3C = new Map([
  [
    ".claude/agents/store.json",
    "RUNTIME BUILD-STATE (features/tasks/cycle/circuitBreaker/heartbeat/runLog; no version field). update PRESERVES it by design (regenerating would WIPE live state — bundle-3 / ED-264); fresh-N gets defaults, so the two legitimately differ.",
  ],
  [
    ".claude/manifest.json",
    "PROJECT-OWNED identity card (β b088 ownership discriminator). Its FRAMEWORK-owned field mc.version is verified elsewhere (3b scan:install version-match, and restamped by the update); its PROJECT-owned config (providers/agentProviders/features) is PRESERVED across upgrade (same principle as the restamp touching ONLY mc.version) while fresh-N gets 1.0.0 defaults; project.name/slug is the install-dir basename. NOTE: a FUTURE framework-owned manifest field would need separate coverage (it is not caught here).",
  ],
  // NOTE (β (a) ruling, beta-ceremony-inventory-aware-go-b090): .claude/framework-installed.json is NO LONGER
  // wholesale-preserved here — it is now STRUCTURED-compared (compareFrameworkInstalledRecord) so its
  // FRAMEWORK-owned fields (installedVersion/pathRegistryVersion/manifestSchema/$schema/generated) stay under a
  // LOAD-BEARING 3c check (the wholesale preserve dropped installedVersion to the non-load-bearing 3a — the F3
  // gap). Only its genuinely per-install fields are filtered, inside the comparator.
  [
    "PROJECT.md",
    "PROJECT-OWNED scaffolded doc; its only divergence is the project name in the H1 title (= install-dir basename, sandbox-identity). No framework content.",
  ],
]);

// Byte-exact except for the NAMED-ALLOWLISTED files above. `commonRelPaths`
// is the intersection of the two trees' FILE path sets — symlinks are judged
// separately by TARGET string (R3-2/R3-3, typed entries, never string-marker
// paths); path-set parity already caught missing/extra entries — this covers
// what that does NOT: divergent content in files present in both.
function compareTreeContents(treeA, treeB, commonRelPaths, ctx) {
  const mismatches = [];
  for (const rel of commonRelPaths) {
    // Structured WHOLE-RECORD comparators (β (a) ruling, msg beta-ceremony-inventory-aware-go-b090):
    // _mc/MANIFEST.json (whole-tree ownership inventory) and .claude/framework-installed.json (per-install
    // record) are DERIVED per-install artifacts. A wholesale preserve would drop their FRAMEWORK-owned fields
    // from the load-bearing 3c compare (the installedVersion coverage gap F3 caught). Instead we byte-check the
    // framework-owned fields and filter ONLY fields/entries already dispositioned at the file level, via the
    // IMPORTED existing dispositions (β condition 1). These run BEFORE the preserve/normalize generic paths.
    if (rel === "_mc/MANIFEST.json") {
      const r = compareMcManifestInventory(treeA, treeB, rel);
      if (!r.equal) mismatches.push({ rel, reason: r.reason });
      continue;
    }
    if (rel === ".claude/framework-installed.json") {
      const r = compareFrameworkInstalledRecord(treeA, treeB, rel);
      if (!r.equal) mismatches.push({ rel, reason: r.reason });
      continue;
    }
    // CONTENT preserve-by-design divergence (store.json etc.): excluded from content parity — its
    // content legitimately differs (preserved runtime state vs fresh defaults) and is NOT normalizable.
    if (CONTENT_PRESERVE_DIVERGENCE_3C.has(rel)) continue;
    let bufA;
    let bufB;
    try {
      bufA = fs.readFileSync(path.join(treeA, rel));
    } catch (e) {
      mismatches.push({ rel, reason: `unreadable in upgraded tree: ${e.message}` });
      continue;
    }
    try {
      bufB = fs.readFileSync(path.join(treeB, rel));
    } catch (e) {
      mismatches.push({ rel, reason: `unreadable in fresh-N tree: ${e.message}` });
      continue;
    }
    if (bufA.equals(bufB)) continue; // byte-identical — no normalization needed
    // R3-1: the buffers DIFFER here. Only the NAMED allowlist above is
    // eligible for normalization — everything else (regardless of whether it
    // happens to round-trip UTF-8) is a real byte-exact mismatch.
    if (!NORMALIZE_ALLOWED_RELPATHS.has(rel)) {
      mismatches.push({ rel, reason: "byte-exact content differs (not in the named normalization allowlist)" });
      continue;
    }
    const normA = normalizeContent3c(bufA.toString("utf8"), ctx);
    const normB = normalizeContent3c(bufB.toString("utf8"), ctx);
    if (normA !== normB) {
      mismatches.push({ rel, reason: `content differs outside NORMALIZE_3C (named allowlisted file: ${rel})` });
    }
  }
  return { equal: mismatches.length === 0, mismatches };
}

// ── β (a) ruling (msg beta-ceremony-inventory-aware-go-b090): structured WHOLE-RECORD comparators ──
// _mc/MANIFEST.json and .claude/framework-installed.json are per-install DERIVED records that
// inventory/record the whole tree. A wholesale CONTENT_PRESERVE drops their FRAMEWORK-owned fields from the
// load-bearing 3c compare (the installedVersion coverage gap F3 caught). These comparators byte-check the
// framework-owned fields and filter ONLY the fields/entries already dispositioned at the file level. The
// filter predicates are IMPORTED from the existing file-level dispositions — isFrozenAcceptedOnlyInUpgraded,
// CONTENT_PRESERVE_DIVERGENCE_3C, isFullTreeExcluded — never a re-implemented/looser copy (β condition 1).
// Negative space (β condition 3): no framework field/entry escapes the byte-identical requirement except via
// one of those existing ruled dispositions (or the documented _mc/MANIFEST.json walk self-reference).
function readJsonRecord(root, rel) {
  let s = fs.readFileSync(path.join(root, rel), "utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip a leading BOM (no BOM-literal in source)
  return JSON.parse(s);
}

// _mc/MANIFEST.json is a WHOLE-TREE ownership inventory (manifest/build.js product-mode enumerates every
// path). Its framework-owned entries are reconverged in-target by update.js#regenerateMcManifest and MUST
// match; entries for paths already dispositioned at the file level are filtered by the IMPORTED predicates.
function isDispositionedInventoryKey(key) {
  return (
    key === "_mc/MANIFEST.json" || // walk self-reference: the manifest lists itself only when it
    //                                    pre-exists its own walk; fresh builds it before it exists, so this
    //                                    single entry is asymmetric by construction (documented exclusion)
    isFrozenAcceptedOnlyInUpgraded(key) || // EXISTING ruled disposition (ACCEPT_ONLY_IN_UPGRADED, frozen N-1)
    CONTENT_PRESERVE_DIVERGENCE_3C.has(key) || // EXISTING ruled disposition (preserve-by-design)
    isFullTreeExcluded(key) // EXISTING full-tree walk exclusion (.claude/runtime, project/events, memory, …)
  );
}
function compareMcManifestInventory(treeA, treeB, rel) {
  let a, b;
  try { a = readJsonRecord(treeA, rel); } catch (e) { return { equal: false, reason: `_mc/MANIFEST.json unparseable in upgraded tree: ${e.message}` }; }
  try { b = readJsonRecord(treeB, rel); } catch (e) { return { equal: false, reason: `_mc/MANIFEST.json unparseable in fresh-N tree: ${e.message}` }; }
  // Top-level fields except the volatile generatedAt (real wall-clock stamp per run) must match.
  const topA = { ...a }; const topB = { ...b };
  delete topA.generatedAt; delete topB.generatedAt; delete topA.paths; delete topB.paths;
  if (JSON.stringify(topA) !== JSON.stringify(topB)) {
    return { equal: false, reason: "_mc/MANIFEST.json top-level fields diverge (mcVersion/schema/version/…)" };
  }
  const pa = (a && a.paths) || {};
  const pb = (b && b.paths) || {};
  const bad = [];
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    if (isDispositionedInventoryKey(k)) continue;
    if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) bad.push(k);
  }
  if (bad.length) {
    return { equal: false, reason: `_mc/MANIFEST.json framework-owned inventory entries diverge (${bad.length}): ${bad.slice(0, 5).join(", ")}` };
  }
  return { equal: true, reason: "" };
}

// .claude/framework-installed.json is a per-install RECORD. Its FRAMEWORK-owned fields MUST match — this is the
// LOAD-BEARING installedVersion check F3 requires (3b checks manifest.mc.version, a DIFFERENT field, so
// without this installedVersion would only be under the non-load-bearing 3a settable-label check). The
// genuinely per-install fields (installedAt/installedCommit/source/target/assets/applyCounts/migrationsApplied/
// userModified) are filtered — β condition 3: they are the ONLY escapes, and every OTHER field is checked.
const FRAMEWORK_INSTALLED_OWNED_FIELDS = [
  "$schema",
  "installedVersion",
  "pathRegistryVersion",
  "manifestSchema",
  "generated",
];
function compareFrameworkInstalledRecord(treeA, treeB, rel) {
  let a, b;
  try { a = readJsonRecord(treeA, rel); } catch (e) { return { equal: false, reason: `framework-installed.json unparseable in upgraded tree: ${e.message}` }; }
  try { b = readJsonRecord(treeB, rel); } catch (e) { return { equal: false, reason: `framework-installed.json unparseable in fresh-N tree: ${e.message}` }; }
  const bad = [];
  for (const f of FRAMEWORK_INSTALLED_OWNED_FIELDS) {
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) bad.push(f);
  }
  if (bad.length) {
    return { equal: false, reason: `framework-installed.json framework-owned fields diverge: ${bad.join(", ")}` };
  }
  return { equal: true, reason: "" };
}

// ── F4 (qa FUNC-3C-SCOPE / INT-OVERCLAIM-FULL-TREE) — TRUE full-tree file
// enumeration for 3c ────────────────────────────────────────────────────────
// test-install-matrix.js's `treeFileList` is SCOPED (only .claude, _mc,
// _requirements, _docs, ROADMAP.md, PROJECT.md) — of 1668 manifest assets,
// only 582 ever entered that scope, so a broken upgrade that left
// scripts/framework/schemas/etc. at N-1 could still pass. GATE-B's 3c claims
// FULL-TREE parity, so it must actually walk the full tree. This is a SHORT,
// ENUMERATED exclusion list — everything else under the install root is
// in-scope, including .claude/framework-installed.json and
// .claude/framework-manifest.json (previously excluded upstream; see F3).
const FULL_TREE_EXCLUDES = [
  {
    re: /^\.git(\/|$)/,
    why: "git metadata — not a manifest asset, never install content",
  },
  {
    re: /^\.mc(\/|$)/,
    why: "update.js's own per-run transaction bookkeeping (.mc/transactions/<txId>/backup, plan, etc.) written by the Step-2 apply; the fresh-N oracle never runs an update, so this subtree has no counterpart to diff against",
  },
  {
    re: /^\.claude\/runtime(\/|$)/,
    why: "runtime state (events, dispatch, checkpoints) written at RUN time by whichever process subsequently touches the tree (scan:install, update.js) — not by install/apply content itself; same class test-install-matrix.js's PARITY_ALLOWLIST already vets",
  },
  {
    re: /^\.claude\/project\/events(\/|$)/,
    why: "event logs — per-run, not install content",
  },
  {
    re: /^\.claude\/project\/memory(\/|$)/,
    why: "memory stores — per-run, not install content",
  },
  {
    re: /(^|\/)node_modules(\/|$)/,
    why: "dependency tree — never a manifest asset or install content",
  },
  {
    re: /(^|\/)\.DS_Store$/,
    why: "macOS filesystem noise",
  },
];

function isFullTreeExcluded(rel) {
  return FULL_TREE_EXCLUDES.some((e) => e.re.test(rel));
}

/**
 * Build a sorted list of TYPED entries for EVERY file/symlink under `rootDir`
 * (POSIX rel paths), pruning only the short enumerated exclusion list above.
 * Each entry is `{ rel, type: "file" | "symlink", target? }` (R3-3 — qa
 * 7C-005 / FUNC-3C-SYMLINK-MARKER-COLLISION) — NEVER a string-marker path.
 * The prior `"<rel>\t<SYMLINK>"` convention (a) collided with any legal rel
 * path that happened to contain that literal substring, and (b) made a
 * `.includes()` check silently skip a real file. Type (and, for a symlink,
 * its TARGET — R3-2, qa 7C-004) lives IN the entry object, never smuggled
 * into the path string. Unlike test-install-matrix.js's `treeFileList`,
 * there is no scope allowlist here — this is the FULL tree.
 */
function fullTreeFileList(rootDir) {
  const out = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      // FAIL-CLOSED (qa FUNC-3C-SCOPE still-open / backend 7C-001): an unreadable
      // directory must NEVER be silently omitted — that would let an upgraded-only
      // file behind an EACCES subtree vanish from BOTH parity sets and false-green
      // "full-tree". THROW so the 3c block catches it and RED-fails "cannot certify
      // full-tree parity" instead of pretending the subtree is empty.
      throw new Error(`fullTreeFileList: cannot read ${relDir || "."} (${e.code || e.message}) — full-tree parity uncertifiable, fail-closed`);
    }
    for (const ent of entries) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        // Record symlinks/junctions as TYPED entries (do NOT follow — a
        // followed link could escape the tree or loop); presence divergence
        // is caught by path-set parity over the KEYS, type divergence and
        // TARGET divergence are judged separately by the 3c block (R3-2/R3-3).
        if (isFullTreeExcluded(relPath)) continue;
        // FAIL-CLOSED (qa/backend 7C-004 TERMINAL): a readlinkSync failure must
        // NOT become a comparable in-band sentinel — two unreadable links (or a
        // real link whose target IS the literal sentinel string) would then match
        // and false-green. THROW so the 3c block RED-fails "full-tree parity
        // uncertifiable", mirroring fullTreeFileList's readdir fail-closed above.
        let target;
        try {
          target = fs.readlinkSync(path.join(absDir, ent.name));
        } catch (e) {
          throw new Error(`fullTreeFileList: cannot readlink ${relPath} (${e.code || e.message}) — full-tree parity uncertifiable, fail-closed`);
        }
        out.push({ rel: relPath, type: "symlink", target });
      } else if (ent.isDirectory()) {
        if (isFullTreeExcluded(`${relPath}/`)) continue;
        walk(path.join(absDir, ent.name), relPath);
      } else if (ent.isFile()) {
        if (!isFullTreeExcluded(relPath)) out.push({ rel: relPath, type: "file" });
      }
    }
  }
  walk(rootDir, "");
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

// (R3-2/R3-3 — qa 7C-004/7C-005) Judge type + symlink-target divergence for
// entries present in BOTH typed maps (presence/absence is judged elsewhere,
// by path-set parity over the keys). Returns { typeMismatches,
// symlinkTargetMismatches, commonFileRels } — factored so the self-test can
// exercise it with SYNTHETIC typed maps without a real 2-install run (mirrors
// compareTreeContents/check3a/check3b's existing factoring pattern). Type is
// judged SOLELY from `entry.type` — never from the `rel` string's content,
// so a rel path that happens to contain a marker-shaped substring is never
// treated specially.
function compareTypedEntries(mapA, mapB) {
  const typeMismatches = [];
  const symlinkTargetMismatches = [];
  const commonFileRels = [];
  for (const rel of mapA.keys()) {
    if (!mapB.has(rel)) continue; // presence divergence judged by path-set parity
    const a = mapA.get(rel);
    const b = mapB.get(rel);
    if (a.type !== b.type) {
      typeMismatches.push(`${rel} (a=${a.type} b=${b.type})`);
      continue;
    }
    if (a.type === "symlink") {
      // R3-2 — compare the TARGET STRING; never follow the link.
      if (a.target !== b.target) {
        symlinkTargetMismatches.push(`${rel} (a->${a.target} b->${b.target})`);
      }
      continue;
    }
    commonFileRels.push(rel);
  }
  return { typeMismatches, symlinkTargetMismatches, commonFileRels };
}

// ── F6 (qa FUNC-ISOLATION-FALSE-GREEN) — dirty-set content-hash compensating
// control ────────────────────────────────────────────────────────────────
// The real fix (content-hash canonical no-delta) is cross-cutting into
// GATE-A's snapshotCanonicalState/noDeltaCheck — OUT OF SCOPE here (tracked
// debt ED-255; the full fix is cross-engine and belongs to GATE-A). This is an
// ENGINE-LOCAL compensating control targeted at exactly the gap a porcelain
// `git status` line diff cannot see: a file that was ALREADY dirty before
// this run started, whose CONTENT changes during the run without its
// porcelain status line changing (e.g. still "M path/to/file" before and
// after). We hash the content of the pre-existing dirty set before the run
// and re-hash the SAME set after; any mismatch is caught here even though
// noDeltaCheck's line-level diff would miss it.
function listDirtyFiles() {
  // NUL-safe (backend 7C-002 / F6-false-green): plain --porcelain C-QUOTES paths
  // with special chars (spaces, unicode, control) and uses " -> " for renames, so
  // a newline+slice parser hashes a quoted literal as a nonexistent path (an
  // identical UNREADABLE sentinel that false-greens). `-z` emits NUL-delimited,
  // UNquoted records; a rename/copy ("R"/"C") record is followed by a SECOND
  // NUL field (the origin path) which we consume and ignore.
  const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    // SECOND site of the same defect fixed at test-scaffold-all-ways.js#snapshotCanonicalState (see
    // the note there): `--untracked-files=all` output grows with accumulated artifacts, and Node's
    // 1 MiB spawnSync default then SIGTERMs the child with ENOBUFS, surfacing as a gate FAILURE
    // rather than a gate that could not RUN. This call site is independent of that one, so fixing
    // only the other would leave GATE-B failing here instead.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`listDirtyFiles: git status failed (status=${r.status}${r.error ? `, ${r.error.code || r.error.message}` : ""}): ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  }
  const parts = (r.stdout || "").split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const status = rec.slice(0, 2);
    files.push(rec.slice(3));
    if (status[0] === "R" || status[0] === "C") i++; // skip the origin-path field
  }
  return files;
}

function hashDirtyFileSet(rootDir, relFiles) {
  const hashes = {};
  for (const rel of relFiles) {
    try {
      const buf = fs.readFileSync(path.join(rootDir, rel));
      hashes[rel] = crypto.createHash("sha256").update(buf).digest("hex");
    } catch (e) {
      // A file that is genuinely gone/unreadable is still a state change vs
      // "had a hash before" — recorded distinctly so it counts as changed,
      // never silently dropped from the set.
      hashes[rel] = `UNREADABLE:${e.code || e.message}`;
    }
  }
  return hashes;
}

function dirtySetUnchanged(beforeHashes, afterHashes) {
  const changed = [];
  const keys = new Set([...Object.keys(beforeHashes || {}), ...Object.keys(afterHashes || {})]);
  for (const k of keys) {
    if ((beforeHashes || {})[k] !== (afterHashes || {})[k]) changed.push(k);
  }
  return { equal: changed.length === 0, changed };
}

// ── Orchestration ────────────────────────────────────────────────────────────
async function runEngine({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const asserts = [];
  // loadBearing defaults true — ONLY 3a (version_sanity_NON_LOAD_BEARING) is
  // marked false, per the β trust model: it may appear in `asserts` but must
  // NEVER be able to flip `ok` on its own.
  // (F7 — qa FUNC-WARNING-DETAIL-DROPPED / backend 7B-001) `detail` is now
  // recorded REGARDLESS of `ok` — previously it was erased on ok:true, which
  // silently discarded the committedWithWarnings / provider-smoke LOUD
  // observations several call sites deliberately pass even on success. Most
  // call sites simply don't pass a detail on success, so this is a no-op for
  // them; the loud ones now actually land in the artifact.
  const assert = (name, ok, detail, opts) => {
    const loadBearing = !opts || opts.loadBearing !== false;
    asserts.push({ name, ok: !!ok, detail: detail || "", loadBearing });
    return !!ok;
  };

  let from_version = null;
  let to_version = null;
  let ran = false;
  let ps_available = null;
  let incomplete = false;
  let incompleteReason = null;

  const beforeSnapshot = snapshotCanonicalState();
  // F6 — capture the pre-existing dirty file set's CONTENT hashes now, before
  // any sandbox I/O, so a compensating control can catch a content change to
  // an already-dirty file that a porcelain-line diff cannot see.
  const dirtyFilesBefore = listDirtyFiles();
  const dirtyHashesBefore = hashDirtyFileSet(REPO_ROOT, dirtyFilesBefore);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpBase = path.join(os.tmpdir(), `mc-gateb-${nonce}`);
  const n1Src = path.join(tmpBase, "n1-src");
  const n1Install = path.join(tmpBase, "n1-install");

  try {
    let proceed = true;

    // Step 0
    let versions = null;
    try {
      versions = resolveVersions();
    } catch (e) {
      assert("n1_resolved", false, `version resolution threw: ${e.message}`);
      proceed = false;
    }
    if (proceed) {
      if (versions.incomplete) {
        // B semantics: no unreleased capsule to upgrade TO. SKIP-LOUD INCOMPLETE
        // — NOT a pass, NOT a RED. The engine sets `incomplete` on the result;
        // the gate renders it manual/degraded (never green, never red). The full
        // apply->conformance path runs at the ceremony when a fresh capsule is cut.
        incomplete = true;
        incompleteReason = versions.reason;
        assert("upgrade_target_available", false, `INCOMPLETE (skip-loud): ${versions.reason}`, { loadBearing: false });
        proceed = false;
      } else {
        to_version = versions.n;
        from_version = versions.n1;
        assert("n1_resolved", true, `N=${to_version} (unreleased cut) N-1=${from_version} (newest shipped)`);
      }
    }

    // Pre-run sandbox guard (BINDING — checked before any sandbox I/O; reuses
    // GATE-A's proven harness rather than reinventing it).
    if (proceed) {
      try {
        assertSandboxTargetSafe(n1Src, { label: "n1-src worktree target" });
        assertSandboxTargetSafe(n1Install, { label: "n1-install sandbox target" });
        assert("sandbox_targets_safe", true, "");
      } catch (e) {
        assert("sandbox_targets_safe", false, e.message);
        proceed = false;
      }
    }

    // Step 1 — materialize a REAL N-1 install: git-tag worktree (the only
    // viable route — sealed capsules always source CURRENT bytes; the
    // synthetic fixture is a 4-file stand-in, not a real install).
    if (proceed) {
      fs.mkdirSync(tmpBase, { recursive: true });
      const tag = `mc@${from_version}`;
      const wtAdd = spawnSync("git", ["worktree", "add", "--detach", n1Src, tag], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (wtAdd.status !== 0) {
        assert("n1_worktree_materialized", false, `git worktree add ${n1Src} ${tag} failed: ${describeSpawnFailure(wtAdd)}`);
        proceed = false;
      } else {
        assert("n1_worktree_materialized", true, "");
      }
    }

    let ps = null;
    if (proceed) {
      ps = findPowershellReal();
      ps_available = !!ps;
      if (!ps) {
        // Skip-loud (R2 lineage): a no-PS host makes the engine INCOMPLETE,
        // never a silent pass.
        assert("ps_available", false, "no PowerShell found on this host — engine INCOMPLETE (skip-loud), not a pass");
        proceed = false;
      }
    }

    if (proceed) {
      const n1InstallPs1 = path.join(n1Src, "install.ps1");
      if (!fs.existsSync(n1InstallPs1)) {
        assert("n1_install_ps1_present", false, `expected ${n1InstallPs1} in the materialized N-1 worktree`);
        proceed = false;
      }
    }

    if (proceed) {
      fs.mkdirSync(n1Install, { recursive: true });
      const installRun = spawnSync(
        ps,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(n1Src, "install.ps1"), "-Target", n1Install, "-SkipPrompt"],
        { cwd: n1Src, encoding: "utf8", timeout: timeoutMs },
      );
      const n1Installed = fs.existsSync(path.join(n1Install, ".claude", "framework-installed.json"));
      const installOk = installRun.status === 0 && n1Installed;
      assert(
        "n1_install_materialized",
        installOk,
        installOk
          ? ""
          : installRun.status !== 0
            ? `install.ps1 -Target ${n1Install} failed: ${describeSpawnFailure(installRun)}`
            : `install.ps1 exited 0 but no .claude/framework-installed.json under ${n1Install} — silent-downgrade class, not a real install`,
      );
      if (!installOk) proceed = false;
    }

    // Step 1.5 — repoint the N-1 install's recorded source to the N source (the
    // canonical repo under test). MODELS THE REAL UPGRADE: the operator installed
    // N-1 from their canonical MC repo, which has since advanced to N, so the
    // install's source hint points at a repo that HAS the N capsule. The preflight
    // `mc-capsule-resolvable` gate searches the TARGET's recorded source
    // (framework-installed.json#source / manifest.mc.source), NOT update.js's
    // --source flag — so without this it looks only at the frozen N-1 tag checkout
    // and can never resolve the N capsule. FINDING (surfaced to beta at
    // gauntlet->release): the preflight gate does not honor --source though its
    // remediation implies it does; out of INC-3 scope to fix in update.js.
    if (proceed) {
      try {
        const installedJsonPath = path.join(n1Install, ".claude", "framework-installed.json");
        const installedJson = JSON.parse(fs.readFileSync(installedJsonPath, "utf8"));
        installedJson.source = REPO_ROOT;
        fs.writeFileSync(installedJsonPath, JSON.stringify(installedJson, null, 2));
        const manifestPath = path.join(n1Install, ".claude", "manifest.json");
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (manifest && manifest.mc) {
            manifest.mc.source = REPO_ROOT;
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          }
        }
        assert("n1_source_repointed_to_N", true, "");
      } catch (e) {
        assert("n1_source_repointed_to_N", false, `could not repoint N-1 install source to N: ${e.message}`);
        proceed = false;
      }
    }

    // Step 2 — real apply via run(), NEVER the --json CLI (which does
    // console.log(JSON.stringify(r)) BEFORE any process.exit, so a Class-C/
    // preflight-block run silent-greens at exit 0 — the exact trap this
    // engine exists to avoid).
    if (proceed) {
      ran = true;
      let r = null;
      try {
        // eslint-disable-next-line global-require
        const { run } = require("./update");
        r = await Promise.race([
          run({ to: to_version, source: REPO_ROOT, target: n1Install, apply: true, allRed: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("apply TIMEOUT (fail-closed backstop)")), timeoutMs)),
        ]);
      } catch (e) {
        assert("apply_committed", false, `run() threw or timed out: ${e.message}`);
        proceed = false;
      }
      if (proceed) {
        // apply_committed is a PRECONDITION assert (did the apply LAND?), NEVER
        // the verdict. It rests on r.committed — NOT r.ok. r.ok folds in the
        // apply's OWN postflight self-report (provider connectivity, missing
        // rollup scripts), which is exactly the self-report the verdict must not
        // rest on (ED-225/227, one level up). 3b (scan:install) + 3c (fresh-N
        // parity) independently judge the RESULT — a committed:true lie fails 3c.
        const pf = (r && r.postflight && (r.postflight.gates || r.postflight.checks)) || [];
        const pfFails = pf
          .filter((x) => x.status && x.status !== "green" && x.status !== "pass")
          .map((x) => `${x.name}:${x.status}(${(x.reason || "").slice(0, 80)})`);
        if (r && r.committed === true) {
          // committedWithWarnings (r.ok:false, r.committed:true) → record the
          // postflight self-report LOUD as detail, but do NOT gate on it.
          assert(
            "apply_committed",
            true,
            r.ok === true
              ? ""
              : `apply COMMITTED with postflight warnings (self-report — NOT gated; 3b/3c judge conformance): ${pfFails.join("; ") || "(no postflight detail)"}`,
          );
          // provider-smoke: ENVIRONMENTAL — RECORD-DON'T-JUDGE (lead steer,
          // β-ratified scope boundary). The sandbox has no provider auth BY
          // DESIGN; runtime connectivity is not upgrade conformance. Named as a
          // non-load-bearing observation so the scope boundary is explicit and
          // never silently swallowed.
          const smoke = pf.find((x) => x.name === "provider-smoke");
          if (smoke && smoke.status !== "green" && smoke.status !== "pass") {
            assert(
              "provider_smoke_ENVIRONMENTAL_OBSERVATION",
              true,
              `OUT OF GATE-B SCOPE (β-ratified): provider-smoke ${smoke.status} (${(smoke.reason || "").slice(0, 80)}). Sandbox has no provider auth by design; runtime connectivity is not upgrade conformance.`,
              { loadBearing: false },
            );
          }
        } else {
          // Apply did NOT commit — a true failure / rollback. LOUD detail: error,
          // then preflight reds, then postflight fails — never "no detail" (the
          // run() committedWithWarnings-no-top-level-error gap is a named update.js
          // finding carried to β, not masked here).
          const preReds = ((r && r.preflight && r.preflight.gates) || [])
            .filter((x) => x.status === "red")
            .map((x) => `${x.name}:${(x.reason || "").slice(0, 80)}`);
          const detail =
            (r && r.error) ||
            (preReds.length ? `PREFLIGHT: ${preReds.join("; ")}` : "") ||
            (pfFails.length ? `POSTFLIGHT (uncommitted): ${pfFails.join("; ")}` : "") ||
            (r && r.outcome ? `outcome=${r.outcome}` : "") ||
            "run() returned committed:false with no error/preflight/postflight detail (update.js loud-fail gap — carried to β)";
          assert("apply_committed", false, detail);
          proceed = false;
        }
      }
    }

    // Step 3a — version sanity, NON-LOAD-BEARING (β#1): reads a field
    // `update.js --apply` writes itself (a settable label, ED-225/227 class).
    // A cheap early signal only; never allowed to gate `ok` alone (loadBearing
    // false below). 3b (scan:install) + 3c (fresh-N oracle parity) — the
    // LOAD-BEARING convergence-to-oracle checks — are what the verdict
    // actually rests on.
    if (proceed) {
      let installedVersion = null;
      try {
        const fi = JSON.parse(fs.readFileSync(path.join(n1Install, ".claude", "framework-installed.json"), "utf8"));
        installedVersion = fi.installedVersion;
      } catch (e) {
        assert(
          "version_sanity_NON_LOAD_BEARING",
          false,
          `could not read upgraded framework-installed.json: ${e.message}`,
          { loadBearing: false },
        );
      }
      if (installedVersion !== null) {
        const r3a = check3aVersionSanity(installedVersion, to_version);
        assert("version_sanity_NON_LOAD_BEARING", r3a.ok, r3a.detail, { loadBearing: false });
      }
    }

    // Step 3b — scan:install GREEN on the UPGRADED tree (LOAD-BEARING): a
    // schema-absolute check independent of anything the apply self-reports.
    if (proceed) {
      const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check", "install.js")], {
        cwd: n1Install,
        encoding: "utf8",
        timeout: SCAN_INSTALL_TIMEOUT_MS,
      });
      const r3b = check3bScanInstall(scan);
      assert("scan_install_green_3b", r3b.ok, r3b.detail);
    }

    // Step 3c — fresh-N oracle parity (LOAD-BEARING, convergence-to-oracle,
    // β#2/#3/#4). The oracle is a REAL fresh-N install produced by GATE-A's
    // own runLeg3 (never the source tree, a fixture, or the apply's own
    // output re-used as its own oracle). `oracleRoot` lives under `tmpBase`
    // so the existing top-level `finally` cleanup below already reclaims it —
    // runLeg3 itself does NOT delete its sandbox.
    if (proceed) {
      const oracleRoot = path.join(tmpBase, "freshN");
      try {
        assertSandboxTargetSafe(oracleRoot, { label: "freshN oracle sandbox target" });
        const leg = runLeg3({ sandboxRoot: oracleRoot, timeoutMs: ORACLE_TIMEOUT_MS });
        const freshNTree = path.join(oracleRoot, "leg3-installps1");

        // runLeg3's OWN "both_path_parity" assertion is N/A here — we
        // deliberately do not pass a `leg2Dir` (there is no GATE-A Leg-2 tree
        // in this engine's flow), so that specific internal comparison
        // assertion always fails and must be excluded when judging whether
        // the ORACLE ITSELF materialized correctly. Every OTHER assertion
        // runLeg3 makes (framework-installed.json present, scan:install
        // GREEN, regenerate --check clean, complete-install path checks)
        // must still have passed.
        const legAsserts = (leg && Array.isArray(leg.asserts)) ? leg.asserts : [];
        const oracleCore = legAsserts.filter((a) => !/both_path_parity/.test(a.name));
        const oracleReady =
          !!leg &&
          leg.ran === true &&
          oracleCore.length > 0 &&
          oracleCore.every((a) => a.status === "pass") &&
          fs.existsSync(path.join(freshNTree, ".claude", "framework-installed.json"));

        if (!oracleReady) {
          const failed = oracleCore.filter((a) => a.status !== "pass").map((a) => a.name);
          assert(
            "fresh_n_oracle_ready_3c",
            false,
            `fresh-N oracle install INCOMPLETE (ps_available=${leg && leg.ps_available} ran=${leg && leg.ran}) — 3c skip-loud, NOT a pass: ${failed.join("; ") || "no oracle asserts produced"}`,
          );
        } else {
          // F4/R3-3 — FULL-TREE, TYPED entries (not the scoped
          // test-install-matrix.js#treeFileList; see fullTreeFileList's own
          // header comment for the exclusion list). Path-set parity is over
          // the KEYS ONLY — type/target/content are judged separately below.
          const upgradedList = fullTreeFileList(n1Install);
          const freshList = fullTreeFileList(freshNTree);
          const upgradedMap = new Map(upgradedList.map((e) => [e.rel, e]));
          const freshMap = new Map(freshList.map((e) => [e.rel, e]));

          const pathParity = parityDiff([...upgradedMap.keys()], [...freshMap.keys()]);
          // ED-263: filter the frozen-accept set (immutable N-1-tag pollution) from onlyInUpgraded. The
          // TOOTH is structural — any onlyInUpgraded path NOT in the accept-set still fails this assert.
          const unacceptedOnlyInA = pathParity.onlyInA.filter((p) => !isFrozenAcceptedOnlyInUpgraded(p));
          assert(
            "fresh_n_parity_pathset_3c",
            unacceptedOnlyInA.length === 0 && pathParity.onlyInB.length === 0,
            `onlyInUpgraded(unaccepted ${unacceptedOnlyInA.length})=${unacceptedOnlyInA.slice(0, 8).join(", ")} | onlyInFreshN(${pathParity.onlyInB.length})=${pathParity.onlyInB.slice(0, 8).join(", ")} | ED-263-accepted=${pathParity.onlyInA.length - unacceptedOnlyInA.length}`,
          );

          // R3-2/R3-3 — for every COMMON key: a type mismatch (file vs
          // symlink) is itself a divergence; a symlink's TARGET is compared
          // as a string (never followed); a file's CONTENT is judged by
          // compareTreeContents (R3-1 named-allowlist-or-byte-exact).
          const typed = compareTypedEntries(upgradedMap, freshMap);
          assert(
            "fresh_n_parity_type_3c",
            typed.typeMismatches.length === 0,
            typed.typeMismatches.length
              ? `${typed.typeMismatches.length} path(s) diverge in entry type (file vs symlink): ${typed.typeMismatches.slice(0, 5).join(", ")}`
              : "",
          );
          assert(
            "fresh_n_parity_symlink_target_3c",
            typed.symlinkTargetMismatches.length === 0,
            typed.symlinkTargetMismatches.length
              ? `${typed.symlinkTargetMismatches.length} symlink(s) diverge in TARGET: ${typed.symlinkTargetMismatches.slice(0, 5).join(", ")}`
              : "",
          );

          // sandboxRoots ORDER MATTERS: freshNTree (the actual oracle leaf
          // target, e.g. embedded in framework-installed.json#target) must be
          // normalized BEFORE its parent oracleRoot — otherwise oracleRoot's
          // literal replace would partially consume the freshNTree match
          // first, leaving an un-normalized "/leg3-installps1" suffix that
          // would false-red the F3 framework-installed.json parity on the
          // `target` field alone (sandbox identity, not upgrade content).
          const ctx = { sandboxRoots: [n1Install, freshNTree, oracleRoot], nonces: [nonce] };
          const contentResult = compareTreeContents(n1Install, freshNTree, typed.commonFileRels, ctx);
          assert(
            "fresh_n_parity_content_3c",
            contentResult.equal,
            contentResult.equal
              ? ""
              : `content diverges outside NORMALIZE_3C in ${contentResult.mismatches.length} file(s): ${contentResult.mismatches
                  .slice(0, 5)
                  .map((m) => `${m.rel} (${m.reason})`)
                  .join(", ")}`,
          );
        }
      } catch (e) {
        assert("fresh_n_oracle_ready_3c", false, `runLeg3/3c threw: ${e.message}`);
      }
    }
  } catch (e) {
    assert("engine_uncaught_exception", false, e.message);
  } finally {
    // Clean ALL sandboxes here — pass AND fail.
    try {
      spawnSync("git", ["worktree", "remove", "--force", n1Src], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
    } catch {
      /* best-effort */
    }
    try {
      spawnSync("git", ["worktree", "prune"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
    } catch {
      /* best-effort */
    }
    try {
      // MC_GATEB_KEEP=1 preserves the sandbox trees (n1-install + freshN oracle) for post-mortem
      // 3c-parity field diffs — the cleanup is otherwise a hard rmSync in this finally.
      if (!mcEnv.readEnv("GATEB_KEEP")) fs.rmSync(tmpBase, { recursive: true, force: true });
      else process.stderr.write(`[MC_GATEB_KEEP] preserved sandbox: ${tmpBase}\n`);
    } catch {
      /* best-effort */
    }
  }

  const afterSnapshot = snapshotCanonicalState();
  const delta = noDeltaCheck(beforeSnapshot, afterSnapshot);
  // F6 — dirty-set content-hash compensating control: re-hash the SAME
  // pre-existing dirty files and compare. Recorded as a LOAD-BEARING assert
  // (`dirty_set_content_unchanged`) alongside the porcelain-line no-delta
  // check, since it covers exactly the gap that check cannot see.
  const dirtyHashesAfter = hashDirtyFileSet(REPO_ROOT, dirtyFilesBefore);
  const dirtyContentCheck = dirtySetUnchanged(dirtyHashesBefore, dirtyHashesAfter);
  assert(
    "dirty_set_content_unchanged",
    dirtyContentCheck.equal,
    dirtyContentCheck.equal
      ? ""
      : `already-dirty file(s) changed CONTENT during the run even though a porcelain status-line diff would not catch it: ${dirtyContentCheck.changed.slice(0, 8).join(", ")}`,
  );

  // Isolation is checked FIRST, unconditionally — a no-delta violation (either
  // form: porcelain-line delta OR the F6 dirty-set content-hash control)
  // blocks the verdict before any green, regardless of what the other asserts
  // say.
  // Verdict wiring (β trust model, DECIDE B/0.89): `ok` rests on isolation AND
  // every LOAD-BEARING assert (which includes 3b + 3c, plus every required
  // precondition step). 3a (version_sanity_NON_LOAD_BEARING) is excluded on
  // purpose — it can appear in `asserts` but must never flip `ok` alone.
  const loadBearingAsserts = asserts.filter((a) => a.loadBearing !== false);
  const assertsOk = loadBearingAsserts.length > 0 && loadBearingAsserts.every((a) => a.ok);
  // (F2 — qa FUNC-PAYLOAD-TRUST) `ok` must require the NAMED load-bearing
  // evidence to be PRESENT and green — not merely "the set of load-bearing
  // asserts happened to be non-empty and all pass" (a payload missing 3b/3c
  // entirely, e.g. only n1_resolved ran, would otherwise vacuously satisfy
  // assertsOk). Mirrored in release-gates.js's GATE-B green branch.
  const REQUIRED_NAMED_LOAD_BEARING_ASSERTS = [
    "scan_install_green_3b",
    "fresh_n_parity_pathset_3c",
    "fresh_n_parity_type_3c",
    "fresh_n_parity_symlink_target_3c",
    "fresh_n_parity_content_3c",
  ];
  const requiredNamedEvidencePresent = REQUIRED_NAMED_LOAD_BEARING_ASSERTS.every((name) => {
    const a = asserts.find((x) => x.name === name);
    return !!a && a.ok === true;
  });
  // INCOMPLETE (B skip-loud: no unreleased capsule to upgrade to) is NEITHER a
  // pass NOR a fail — ok is null and the gate renders it manual/degraded. Only a
  // genuine run computes ok from isolation + load-bearing asserts + named evidence.
  const ok = incomplete ? null : delta.equal && dirtyContentCheck.equal && assertsOk && requiredNamedEvidencePresent;

  return {
    ok,
    incomplete,
    incomplete_reason: incompleteReason,
    from_version,
    to_version,
    ran,
    ps_available,
    asserts,
    sandbox_isolation: {
      no_delta: delta.equal,
      onlyBefore: delta.onlyBefore,
      onlyAfter: delta.onlyAfter,
      // F6 compensating control — see dirtySetUnchanged above.
      dirty_set_content_unchanged: dirtyContentCheck.equal,
      dirty_set_changed_files: dirtyContentCheck.changed,
    },
  };
}

// ── Self-test — SYNTHETIC negative teeth (chunk 2, AP-8 reachability) ───────
// Fast, no real installs. Each tooth fails for its OWN reason (mirrors
// test-scaffold-all-ways.js's t()/selfTest() pattern).
function selfTest() {
  const results = [];
  const t = (name, fn) => {
    try {
      const r = fn();
      results.push({ name, status: r === false ? "fail" : "pass", detail: r === false ? "" : undefined });
    } catch (e) {
      results.push({ name, status: "fail", detail: e.message });
    }
  };

  // ── F1 tooth (tagExists fail-closed + resolveVersions error propagation) ──
  t("F1: tagExists THROWS on a git ERROR (non-zero exit) — never silently folded into tag-absence", () => {
    let threw = false;
    try {
      tagExists("0.17.0", () => ({ status: 128, stdout: "", stderr: "fatal: synthetic git error", error: null, signal: null }));
    } catch (e) {
      threw = /git tag -l exited non-zero/.test(e.message);
    }
    return threw === true;
  });
  t("F1: tagExists THROWS on a spawn error (e.g. git binary missing)", () => {
    let threw = false;
    try {
      tagExists("0.17.0", () => ({ error: new Error("ENOENT: spawn git"), status: null, stdout: "", stderr: "" }));
    } catch (e) {
      threw = /spawn error/.test(e.message);
    }
    return threw === true;
  });
  t("F1: tagExists positive control — a CLEAN exit-0 no-match result returns false (real tag-absence, not an error)", () => {
    return tagExists("0.17.0", () => ({ status: 0, stdout: "", stderr: "", error: null, signal: null })) === false;
  });
  t("F1: tagExists positive control — a CLEAN exit-0 matching result returns true", () => {
    return tagExists("0.17.0", () => ({ status: 0, stdout: "mc@0.17.0\n", stderr: "", error: null, signal: null })) === true;
  });
  t("F1: resolveVersions PROPAGATES a mocked git-tag error as a THROW (NOT folded into ordinary incomplete:true) — qa FUNC-INCOMPLETE-FAILOPEN", () => {
    let threw = false;
    let becameIncomplete = false;
    try {
      const r = resolveVersions({
        tagExistsFn: () => {
          throw new Error("SYNTHETIC git-tag ERROR (mocked)");
        },
      });
      becameIncomplete = !!(r && r.incomplete === true);
    } catch (e) {
      threw = /SYNTHETIC git-tag ERROR/.test(e.message);
    }
    return threw === true && becameIncomplete === false;
  });
  t("F1: identity bind — an untagged capsule whose version != version.json is REJECTED (fail-closed, never a phantom N)", () => {
    let threw = false;
    try {
      checkUnreleasedCutIdentity("0.16.0", "0.17.0");
    } catch (e) {
      threw = /identity mismatch/.test(e.message) && /phantom N/.test(e.message);
    }
    return threw === true;
  });
  t("F1: identity bind positive control — unreleasedCut === version.json's version is ACCEPTED", () => {
    return checkUnreleasedCutIdentity("0.17.0", "0.17.0") === true;
  });

  // ── 3a tooth ──
  t("3a REDs on a synthetic upgraded install whose framework-installed.json still says N-1 (non-advancing version, NOT a correctness proof)", () => {
    return check3aVersionSanity("0.16.0", "0.17.0").ok === false;
  });
  t("3a positive control: installedVersion === N GREENs", () => {
    return check3aVersionSanity("0.17.0", "0.17.0").ok === true;
  });

  // ── 3b tooth ──
  t("3b REDs when scan:install exits non-zero (synthetic failing status)", () => {
    return check3bScanInstall({ status: 1, stdout: "", stderr: "synthetic scan:install failure" }).ok === false;
  });
  t("3b positive control: scan:install status 0 GREENs", () => {
    return check3bScanInstall({ status: 0, stdout: "", stderr: "" }).ok === true;
  });

  // ── ED-262 tooth: describeSpawnFailure NAMES the failing check, never a blind byte-tail ──
  t("ED-262 REGRESSION-DETECTING: a scan failure whose FAIL line sits >400 chars from the END is still NAMED (the old slice(-400) tail-truncation MASKED it as an adjacent OK line — the whole 'president-missing' triage detour)", () => {
    const failLine = "FAIL  manifest.mc.version matches version.json  (manifest=0.17.0 version.json=1.0.0)";
    const trailingOk = Array.from({ length: 12 }, (_, i) => `OK    trailing check ${i} padding padding padding padding`).join("\n");
    // FAIL line FIRST, then >400 chars of OK trailer → a slice(-400) tail would drop the FAIL entirely.
    const stdout = `${failLine}\n${trailingOk}\n# 17/18 passed`;
    if (stdout.slice(-400).includes(failLine)) return false; // guard: prove the FAIL is beyond the 400-tail
    const desc = describeSpawnFailure({ status: 1, stdout, stderr: "" });
    return desc.includes("manifest.mc.version matches version.json") && desc.startsWith("code=1 FAILING:");
  });
  t("ED-262 positive control: a non-check spawn failure (no FAIL marker) still falls back to the byte-tail", () => {
    const desc = describeSpawnFailure({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
    return desc.includes("not a git repository") && desc.startsWith("code=128 ");
  });

  // ── 3c tooth (β#3 — the important one) ──
  // R3-1: NORMALIZE_3C is only ever consulted for a NAMED-allowlisted rel
  // path — these teeth use ".claude/paths.json" (a real member of
  // NORMALIZE_ALLOWED_RELPATHS; framework-installed.json / _mc/MANIFEST.json
  // moved to the structured comparators per the β (a) ruling) so they exercise
  // the ACTUAL normalization rule set through the real gate, not a generic
  // "file.json" that would now byte-exact-RED regardless of NORMALIZE_3C's precision.
  t("3c content-parity REDs on divergence in a NORMALIZATION-EXCLUDED content region (not a timestamp/nonce/path/txn-id) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:00.000Z","transactionId":"txn-aaa111","featureFlag":"on"}',
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:01.000Z","transactionId":"txn-bbb222","featureFlag":"off"}',
      );
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      // featureFlag on->off is real content drift outside NORMALIZE_3C — must
      // RED even though this IS a named-allowlisted file.
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("3c positive control: two trees differing ONLY in normalized volatile fields (timestamp + txn id) parity EQUAL (normalization works and isn't too narrow) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:00:00.000Z","transactionId":"txn-aaa111","featureFlag":"on"}',
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        '{"generatedAt":"2026-07-21T00:05:32.114Z","transactionId":"txn-bbb222","featureFlag":"on"}',
      );
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("3c positive control: absolute sandbox-root paths embedded in content are normalized away (sandbox identity, not upgrade content) — inside a NAMED allowlisted file", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-path-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-3c-path-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), JSON.stringify({ installedFrom: dirA }));
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), JSON.stringify({ installedFrom: dirB }));
      const ctx = { sandboxRoots: [dirA, dirB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── Round-2 tooth (NEW-FUNC-3C-BINARY-UTF8-FALSE-GREEN) — byte-exact
  // default (R3-1 superseded the UTF-8-round-trip gate with a NAMED
  // allowlist — "blob.bin" is not named, so it is byte-exact regardless) ──
  t("R2: two binary files differing ONLY in an invalid-UTF-8 byte (0xFF vs 0xFE) RED byte-exact (not in the named normalization allowlist)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-bin-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-bin-b-"));
    try {
      fs.writeFileSync(path.join(dirA, "blob.bin"), Buffer.from([0x00, 0xff, 0x01]));
      fs.writeFileSync(path.join(dirB, "blob.bin"), Buffer.from([0x00, 0xfe, 0x01]));
      const result = compareTreeContents(dirA, dirB, ["blob.bin"], { sandboxRoots: [dirA, dirB] });
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── R3-1 tooth (named-set normalization ONLY; byte-exact default — qa
  // 7C-003 / FUNC-3C-NORMALIZE-OVERBROAD) ──
  t("R3-1 (REGRESSION-DETECTING, qa NEW-TEST-R3-1-NONTOOTH): a NON-named file whose ONLY difference is a NORMALIZE_3C-matching TIMESTAMP value REDs byte-exact — the OLD normalize-any-round-trip-UTF-8 impl would have normalized both timestamps to EQUAL (false-green); the named-set fix REDs it because the file is not allowlisted", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-r31-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-r31-red-b-"));
    try {
      // The two files differ ONLY in an ISO-timestamp substring (a NORMALIZE_3C
      // rule target). Under the OLD "normalize any UTF-8-round-trip file" impl
      // both would collapse to <NORMALIZED-TS> and false-GREEN. "not-named.bin"
      // is NOT in NORMALIZE_ALLOWED_RELPATHS, so the named-set fix compares it
      // byte-exact -> RED. This is the case that DISTINGUISHES the fix from the
      // regression (a trailing A/B byte with an identical timestamp — the old
      // tooth — would RED under BOTH impls and prove nothing).
      fs.writeFileSync(path.join(dirA, "not-named.bin"), "payload-2020-01-01T00:00:00.000Z-end");
      fs.writeFileSync(path.join(dirB, "not-named.bin"), "payload-2026-07-21T09:12:30.500Z-end");
      const result = compareTreeContents(dirA, dirB, ["not-named.bin"], { sandboxRoots: [dirA, dirB] });
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("R3-1 positive control: a REAL timestamp divergence IN a NAMED allowlisted file (.claude/paths.json) still normalizes to EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-r31-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-r31-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "paths.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:00:00.000Z" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "paths.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:09:12.500Z" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── F3 tooth (3a-defeat via 3c — qa FUNC-3A-NOT-DEFEATED) ──
  // framework-installed.json is now IN-SCOPE for 3c's content parity (no
  // longer excluded); a wrong installedVersion must RED the LOAD-BEARING 3c,
  // not just the non-load-bearing 3a.
  t("F3: a synthetic upgraded tree whose framework-installed.json installedVersion != the oracle's REDs 3c (defeats the 3a-only settable-label case)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f3-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f3-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.16.0", installedAt: "2026-07-21T00:00:00.000Z", source: "/repo" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:05:00.000Z", source: "/repo" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx);
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("F3 positive control: two framework-installed.json trees differing ONLY in installedAt timestamp (same installedVersion) parity EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f3-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f3-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(dirA, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:00:00.000Z", source: "/repo" }),
      );
      fs.writeFileSync(
        path.join(dirB, ".claude", "framework-installed.json"),
        JSON.stringify({ installedVersion: "0.17.0", installedAt: "2026-07-21T00:09:12.500Z", source: "/repo" }),
      );
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      const result = compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── F4 tooth (full-tree 3c scope — qa FUNC-3C-SCOPE / INT-OVERCLAIM-FULL-TREE) ──
  // R3-3: fullTreeFileList now returns TYPED entries ({rel, type, target?}),
  // never plain path strings — teeth below assert on `.rel`/`.type`.
  t("F4: fullTreeFileList walks a path the OLD scoped treeFileList would have excluded (e.g. scripts/…), so a divergence there is now visible to 3c", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f4-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts", "mc"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "mc", "update.js"), "// out-of-scope-for-the-old-scoped-list\n");
      fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".claude", "framework-installed.json"), "{}");
      const list = fullTreeFileList(dir);
      const rels = list.map((e) => e.rel);
      return (
        rels.includes("scripts/mc/update.js") &&
        rels.includes(".claude/framework-installed.json") &&
        list.every((e) => e.type === "file")
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  t("F4: fullTreeFileList still excludes the short enumerated volatile set (.git, .mc, .claude/runtime, .claude/project/events, .claude/project/memory)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f4-excl-"));
    try {
      for (const rel of [
        ".git/HEAD",
        ".mc/transactions/tx-1/backup.json",
        ".claude/runtime/events.log",
        ".claude/project/events/e.jsonl",
        ".claude/project/memory/MEMORY.md",
      ]) {
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), "x");
      }
      fs.writeFileSync(path.join(dir, "ROADMAP.md"), "x");
      const list = fullTreeFileList(dir);
      return list.length === 1 && list[0].rel === "ROADMAP.md" && list[0].type === "file";
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── R3-2 tooth (symlink TARGET compare, never followed — qa 7C-004) ──
  t("R3-2: two symlink entries at the SAME rel path but DIFFERENT targets is a MISMATCH (not silently skipped by presence-only parity)", () => {
    const mapA = new Map([["link", { rel: "link", type: "symlink", target: "../a-target" }]]);
    const mapB = new Map([["link", { rel: "link", type: "symlink", target: "../b-target" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.symlinkTargetMismatches.length === 1 && r.typeMismatches.length === 0 && r.commonFileRels.length === 0;
  });
  t("R3-2 positive control: two symlink entries pointing at the SAME target are NOT a mismatch", () => {
    const mapA = new Map([["link", { rel: "link", type: "symlink", target: "../same-target" }]]);
    const mapB = new Map([["link", { rel: "link", type: "symlink", target: "../same-target" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.symlinkTargetMismatches.length === 0 && r.typeMismatches.length === 0;
  });
  t("R3-2 (integration): fullTreeFileList records a REAL symlink's readlinkSync TARGET, never follows it — skips gracefully (not a fail) if the platform disallows symlink creation (Windows Developer Mode/admin)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-r32-"));
    try {
      fs.writeFileSync(path.join(dir, "real-target.txt"), "x");
      try {
        fs.symlinkSync("real-target.txt", path.join(dir, "the-link"));
      } catch {
        return true; // platform/privilege disallows symlinks here — not this tooth's concern
      }
      const list = fullTreeFileList(dir);
      const linkEntry = list.find((e) => e.rel === "the-link");
      return !!linkEntry && linkEntry.type === "symlink" && linkEntry.target === "real-target.txt";
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  // ── TERMINAL tooth (qa/backend 7C-004 — readlink fail-closed) ──
  t("TERMINAL: a readlinkSync FAILURE makes fullTreeFileList THROW (full-tree uncertifiable) — never a comparable <UNREADABLE> sentinel that two unreadable links could match on to false-green", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-readlink-throw-"));
    const realReadlink = fs.readlinkSync;
    try {
      fs.writeFileSync(path.join(dir, "real-target.txt"), "x");
      try {
        fs.symlinkSync("real-target.txt", path.join(dir, "the-link"));
      } catch {
        return true; // platform/privilege disallows symlinks — not this tooth's concern
      }
      // Force readlinkSync to fail (permission/IO error class). Fail-closed
      // requires a THROW, not a sentinel.
      fs.readlinkSync = () => {
        const e = new Error("simulated readlink EACCES");
        e.code = "EACCES";
        throw e;
      };
      let threw = false;
      try {
        fullTreeFileList(dir);
      } catch {
        threw = true;
      }
      return threw === true;
    } finally {
      fs.readlinkSync = realReadlink;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── R3-3 tooth (TYPED entries, no in-band string marker — qa 7C-005 /
  // FUNC-3C-SYMLINK-MARKER-COLLISION) ──
  t("R3-3: a rel path CONTAINING the OLD string-marker literal ('\\t<SYMLINK>') is judged SOLELY by its typed `type` field — a FILE entry at such a path is treated as a normal file, NOT silently skipped the way the old `rel.includes(\"\\t<SYMLINK>\")` check would", () => {
    const trickyRel = "some/real/path.txt\t<SYMLINK>";
    const mapA = new Map([[trickyRel, { rel: trickyRel, type: "file" }]]);
    const mapB = new Map([[trickyRel, { rel: trickyRel, type: "file" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.commonFileRels.includes(trickyRel) && r.typeMismatches.length === 0;
  });
  t("R3-3 positive control: a rel path present as a FILE in one tree and a SYMLINK in the other (same rel) is a TYPE mismatch, never silently merged/skipped", () => {
    const mapA = new Map([["path/x", { rel: "path/x", type: "file" }]]);
    const mapB = new Map([["path/x", { rel: "path/x", type: "symlink", target: "somewhere" }]]);
    const r = compareTypedEntries(mapA, mapB);
    return r.typeMismatches.length === 1 && r.commonFileRels.length === 0 && r.symlinkTargetMismatches.length === 0;
  });

  // ── F5 tooth (nonce normalization: LITERAL, not a generic pattern — qa
  // FUNC-NORMALIZATION-OVERBROAD / backend 7G-001) ──
  // R3-1: exercised inside a NAMED allowlisted file (.claude/paths.json)
  // so these teeth probe NORMALIZE_3C's actual precision, not just gate
  // membership (a non-named path would now byte-exact-RED unconditionally).
  t("F5: nonce-SHAPED real content drift ('release-alpha' vs 'release-bravo') is NOT swallowed by normalization — REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f5-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f5-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const mintedNonce = "abc123x-yz98";
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), `tmpdir-id=${mintedNonce} releaseTag=release-alpha`);
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), `tmpdir-id=${mintedNonce} releaseTag=release-bravo`);
      const ctx = { sandboxRoots: [], nonces: [mintedNonce] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("F5 positive control: two trees differing ONLY in their own actual minted nonce literals (passed via ctx.nonces) parity EQUAL", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f5-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-f5-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const nonceA = "abc123x-yz98";
      const nonceB = "def456y-wq12";
      fs.writeFileSync(path.join(dirA, ".claude", "paths.json"), `tmpdir-id=${nonceA} featureFlag=on`);
      fs.writeFileSync(path.join(dirB, ".claude", "paths.json"), `tmpdir-id=${nonceB} featureFlag=on`);
      const ctx = { sandboxRoots: [], nonces: [nonceA, nonceB] };
      const result = compareTreeContents(dirA, dirB, [".claude/paths.json"], ctx);
      return result.equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── β (a) structured-comparator positive controls (msg beta-ceremony-inventory-aware-go-b090,
  //    condition 2): an UNDISPOSITIONED divergent FRAMEWORK field/entry must FAIL the compare; a
  //    field/entry covered by an EXISTING ruled disposition is filtered (EQUAL). Negative space
  //    (condition 3): nothing framework-owned escapes byte-identical except via those dispositions. ──
  t("β(a) framework-installed structured: an UNDISPOSITIONED framework field (pathRegistryVersion) divergence REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-owned-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-owned-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dirA, ".claude", "framework-installed.json"), JSON.stringify({ installedVersion: "1.0.0", pathRegistryVersion: "v5", installedAt: "2026-07-21T00:00:00.000Z" }));
      fs.writeFileSync(path.join(dirB, ".claude", "framework-installed.json"), JSON.stringify({ installedVersion: "1.0.0", pathRegistryVersion: "v4", installedAt: "2026-07-21T00:09:00.000Z" }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("β(a) framework-installed structured: per-install fields (source/installedCommit/assets) differ but framework-owned fields match → EQUAL (filtered, NOT an escape of a framework field)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-perinstall-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-fi-perinstall-b-"));
    try {
      fs.mkdirSync(path.join(dirA, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".claude"), { recursive: true });
      const owned = { $schema: "mc/framework-installed/v2", installedVersion: "1.0.0", pathRegistryVersion: "v5", manifestSchema: "mc/framework-manifest/v2", generated: [".claude/paths.json"] };
      fs.writeFileSync(path.join(dirA, ".claude", "framework-installed.json"), JSON.stringify({ ...owned, source: "/repoA", installedCommit: "aaa", assets: [{ id: "x", installedHash: "h1" }] }));
      fs.writeFileSync(path.join(dirB, ".claude", "framework-installed.json"), JSON.stringify({ ...owned, source: "/repoB", installedCommit: "bbb", assets: [{ id: "x", installedHash: "h2" }] }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, [".claude/framework-installed.json"], ctx).equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("β(a) _mc/MANIFEST inventory structured: an UNDISPOSITIONED framework inventory entry (scripts/foo.js) with a divergent sha REDs", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-red-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-red-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      const base = { $schema: "mc/manifest/v1", mcVersion: "1.0.0" };
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:00:00.000Z", paths: { "scripts/foo.js": { owner: "framework", sha256: "AAA" } } }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:09:00.000Z", paths: { "scripts/foo.js": { owner: "framework", sha256: "BBB" } } }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("β(a) _mc/MANIFEST inventory structured: DISPOSITIONED entries (a frozen-accept key + a runtime events key) diverge but are FILTERED → EQUAL (generatedAt dropped)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-green-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-green-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      const base = { $schema: "mc/manifest/v1", mcVersion: "1.0.0" };
      // .claude/.last-checkpoint = ACCEPT_ONLY_IN_UPGRADED (frozen); .claude/project/events/events.jsonl =
      // isFullTreeExcluded (runtime). Both diverge here but are dispositioned → filtered by IMPORTED predicates.
      const pa = { ".claude/.last-checkpoint": { owner: "runtime", sha256: "AAA" }, ".claude/project/events/events.jsonl": { owner: "runtime", sha256: "AAA" } };
      const pb = { ".claude/.last-checkpoint": { owner: "runtime", sha256: "ZZZ" }, ".claude/project/events/events.jsonl": { owner: "runtime", sha256: "ZZZ" } };
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:00:00.000Z", paths: pa }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ ...base, generatedAt: "2026-07-21T00:09:00.000Z", paths: pb }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === true;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
  t("β(a) _mc/MANIFEST inventory structured: a top-level framework field (mcVersion) divergence REDs (not filtered)", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-top-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-wm-top-b-"));
    try {
      fs.mkdirSync(path.join(dirA, "_mc"), { recursive: true });
      fs.mkdirSync(path.join(dirB, "_mc"), { recursive: true });
      fs.writeFileSync(path.join(dirA, "_mc", "MANIFEST.json"), JSON.stringify({ $schema: "mc/manifest/v1", mcVersion: "1.0.0", generatedAt: "2026-07-21T00:00:00.000Z", paths: {} }));
      fs.writeFileSync(path.join(dirB, "_mc", "MANIFEST.json"), JSON.stringify({ $schema: "mc/manifest/v1", mcVersion: "0.17.0", generatedAt: "2026-07-21T00:09:00.000Z", paths: {} }));
      const ctx = { sandboxRoots: [dirA, dirB], nonces: [] };
      return compareTreeContents(dirA, dirB, ["_mc/MANIFEST.json"], ctx).equal === false;
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  // ── isolation tooth ──
  t("isolation tooth: noDeltaCheck REDs on a simulated delta (mirrors GATE-A's proven vector)", () => {
    const before = "a\nb\nc";
    const after = "a\nb\nc\nSIMULATED-DELTA-LINE";
    return noDeltaCheck(before, after).equal === false;
  });
  t("isolation tooth positive control: identical snapshots are equal", () => {
    const snap = "a\nb\nc";
    return noDeltaCheck(snap, snap).equal === true;
  });

  // ── F6 tooth (dirty-set content-hash compensating control — qa
  // FUNC-ISOLATION-FALSE-GREEN) ──
  t("F6: a simulated content change to an already-dirty file (SAME porcelain status line before/after) is CAUGHT by the content-hash control", () => {
    const before = { "scripts/foo.js": "sha256-AAA" };
    const after = { "scripts/foo.js": "sha256-BBB" }; // same path (same porcelain "M scripts/foo.js" line either way) — content mutated
    return dirtySetUnchanged(before, after).equal === false;
  });
  t("F6 positive control: identical hashes across the dirty set are equal", () => {
    const same = { "scripts/foo.js": "sha256-AAA", "framework/releases/0.17.0/release.json": "sha256-CCC" };
    return dirtySetUnchanged(same, same).equal === true;
  });
  t("F6 (integration): hashDirtyFileSet re-hash of a MUTATED file differs, even though the mutation would leave its git porcelain status line identical", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-dirtyset-"));
    try {
      const rel = "already-dirty.txt";
      fs.writeFileSync(path.join(dir, rel), "original content (already dirty before the run)");
      const before = hashDirtyFileSet(dir, [rel]);
      fs.writeFileSync(path.join(dir, rel), "MUTATED content — porcelain status line for this path is unchanged (still just 'M'), only bytes changed");
      const after = hashDirtyFileSet(dir, [rel]);
      return dirtySetUnchanged(before, after).equal === false;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  t("F6 (integration) positive control: an UNCHANGED already-dirty file re-hashes identically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateb-selftest-dirtyset-unchanged-"));
    try {
      const rel = "already-dirty.txt";
      fs.writeFileSync(path.join(dir, rel), "content that never changes during the run");
      const before = hashDirtyFileSet(dir, [rel]);
      const after = hashDirtyFileSet(dir, [rel]);
      return dirtySetUnchanged(before, after).equal === true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.length - pass;
  return { ok: fail === 0, pass, fail, results };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { help: false, json: false, selfTest: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--selftest" || a === "--self-test") out.selfTest = true;
    else if (a === "--timeout-ms") out.timeoutMs = parseInt(argv[++i], 10) || DEFAULT_TIMEOUT_MS;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    `Usage: node scripts/mc/test-upgrade-current-to-new.js [--json] [--timeout-ms <n>] [--selftest] [--help]\n\n` +
      `Runs the GATE-B upgrade_current_to_new engine: materializes a real N-1\n` +
      `install (git-tag worktree + its own install.ps1), runs the real\n` +
      `update.js --apply against it, and proves canonical was never touched.\n\n` +
      `--selftest   run the SYNTHETIC negative-tooth reachability suite (fast,\n` +
      `             no real installs) instead of the real 2-install engine.\n`,
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (opts.selfTest) {
    const st = selfTest();
    for (const r of st.results) {
      process.stdout.write(`[${r.status === "pass" ? "ok  " : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}\n`);
    }
    process.stdout.write(`selftest: pass=${st.pass} fail=${st.fail} overall=${st.ok ? "PASS" : "FAIL"}\n`);
    return st.ok ? 0 : 1;
  }

  // Artifact hygiene: run()'s in-process console.log (e.g. "FRAMEWORK SOURCE
  // MIRROR (_mc/)") would land in the --json stdout artifact and corrupt it
  // (non-machine-parseable). In --json mode, route ALL stdout produced DURING
  // the engine run to stderr, then emit ONLY the final JSON to the real stdout.
  let result;
  if (opts.json) {
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => process.stderr.write(...args);
    try {
      result = await runEngine({ timeoutMs: opts.timeoutMs });
    } finally {
      process.stdout.write = realWrite;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    result = await runEngine({ timeoutMs: opts.timeoutMs });
    process.stdout.write(`from_version=${result.from_version} to_version=${result.to_version} ran=${result.ran} ps_available=${result.ps_available}\n`);
    for (const a of result.asserts) {
      process.stdout.write(`[${a.ok ? "ok  " : "FAIL"}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}\n`);
    }
    process.stdout.write(
      `sandbox-isolation no-delta: ${result.sandbox_isolation.no_delta ? "HELD" : "VIOLATED"}\n` +
        `overall=${result.incomplete ? "INCOMPLETE (skip-loud): " + result.incomplete_reason : result.ok ? "PASS" : "FAIL"}\n`,
    );
  }
  // INCOMPLETE exits 0 (not a failure) — the gate reads payload.incomplete and
  // renders manual/degraded, never green, never red.
  return result.incomplete ? 0 : result.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`FATAL: ${(e && e.stack) || e}\n`);
      process.exit(2);
    });
}

module.exports = {
  REPO_ROOT,
  resolveVersions,
  runEngine,
  selfTest,
  check3aVersionSanity,
  check3bScanInstall,
  compareTreeContents,
  normalizeContent3c,
  NORMALIZE_3C,
  // F1
  tagExists,
  readCurrentVersion,
  checkUnreleasedCutIdentity,
  // F4 / R3-2 / R3-3
  fullTreeFileList,
  compareTypedEntries,
  NORMALIZE_ALLOWED_RELPATHS,
  // F6
  listDirtyFiles,
  hashDirtyFileSet,
  dirtySetUnchanged,
};
