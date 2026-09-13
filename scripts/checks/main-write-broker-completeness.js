#!/usr/bin/env node
"use strict";
/**
 * main-write-broker-completeness.js — the MECHANIZED FLIP-TRIGGER for the Seam E fence
 * (SP-20260721-001 D-4 INC-1, unit SEC-1; β R2 = R3's named enforcer).
 *
 * WHAT IT ASSERTS: a STATIC scan over `scripts/**` + `.claude/commands/**` enumerating LOCAL main-write
 * call-sites, asserting ZERO un-brokered. Every recognized main-writer must be exactly one of:
 *   (a) A BROKER — the transport mechanism itself (trusted-controller.js's fencedRefUpdate choke-point +
 *       the 2 entrypoints, the unit-path CAS in acceptance-record.js, the fence hook).
 *   (b) MIGRATED — the file routes its main-write through a brokered entrypoint
 *       (integrateBranchMerge / integrateReleaseCommit / fencedRefUpdate) and retains NO raw write site.
 *   (c) ALLOWLISTED — an explicitly-named α-hand / holds-lease / scratch-repo writer, WITH a reason,
 *       reviewed as code (see ALLOWLIST below — a frozen in-code table, never a settable per-file pragma).
 * Anything else is an UN-BROKERED main-writer and REDs this enforcer.
 *
 * THE FLIP-TRIGGER: this enforcer going green for the FIRST time is the named, mechanical trigger for
 * installing/arming the Seam E `reference-transaction` hook (deferred to the release ceremony, task #3).
 * The trigger is THIS enforcer — never "dogfood feels sufficient" (dogfood mileage is corroborating
 * de-risking evidence, never the gate).
 *
 * DISTINCT FROM `write-surface-delegation-completeness.falsifier` — that proves the MECHANISM refuses
 * un-brokered writes on scratch repos (does the fence work?). THIS proves the REAL CALLERS are migrated
 * (is anything still going around the fence?). Mechanism vs caller: both are needed, neither substitutes.
 *
 * ── FOLD 1 — THE RECOGNIZER CONTRACT (β design→build fold; the subtlest part) ──────────────────────────
 * Grounded in the real shape of `.claude/commands/commit/land.md` Step 4: a MARKDOWN numbered-list step
 * whose write lives in an INLINE-CODE span (`git merge --no-ff $BRANCH`), targeting a VARIABLE ref, with
 * the target set by a PRIOR `git checkout $DEFAULT`. A naive recognizer keyed on JS call-sites, on fenced
 * bash blocks only, or on a literal `refs/heads/main` token returns ZERO matches there — a FALSE GREEN on
 * the two flagship deferred writers (#4 commit/land.md and #2 warp/release.md). So the recognizer:
 *   (i)   is MARKDOWN-AWARE — it scans every line of a skill's markdown (inline-code spans and numbered
 *         list steps included), not just fenced blocks and not just JS;
 *   (ii)  is VARIABLE-REF-AWARE — `$DEFAULT`, `$DEFAULT_BRANCH`, `$DEFAULT_MAIN`, `${DEFAULT}`, `main`,
 *         `master`, `origin/main`, `HEAD:main` and `refs/heads/main` all count as "main";
 *   (iii) is CONSERVATIVE rather than checkout-flow-precise — it flags ANY file that SELECTS main-ish
 *         AND performs a merge / commit / update-ref, WITHOUT requiring a literal main token on the write
 *         LINE itself (the land.md shape has none).
 * CONSERVATIVE-BY-CONSTRUCTION: a false POSITIVE (flag → review → allowlist with a reason) is always
 * preferred over a false NEGATIVE (miss a writer). Being flagged is cheap; being missed is the bug class.
 *
 * ── FOLD 2 — THE STATIC-SCAN CEILING, NAMED (β design→build fold) ─────────────────────────────────────
 * A static scan CANNOT provably enumerate every main-write. FOLD 1 shrinks the false-negative surface; it
 * does not eliminate it. Known, ACCEPTED blind spots: a ref assembled at runtime from concatenated or
 * computed parts; a write spread across lines a line-oriented scan cannot join; a write issued by a
 * spawned tool or a config-driven indirection; prose that describes a write without a recognizable git
 * idiom; anything outside the two scanned roots.
 *
 * THEREFORE, THE DIVISION OF LABOR (stated explicitly so the flip decision is not made on an over-read
 * green):
 *   • STATIC SCAN (this enforcer) = PRE-FLIP BREAKAGE-PREVENTION. Its green means "no KNOWN un-brokered
 *     writer remains" — NOT "provably every writer migrated". That weaker claim is the honest one, and it
 *     is exactly what the flip needs: confidence that arming the fence will not break a known caller.
 *   • THE LIVE `reference-transaction` HOOK = THE RUNTIME SECURITY BOUNDARY. It refuses ANY un-brokered
 *     main-write at runtime, whether or not this scan ever saw it.
 * CONSEQUENCE OF A SCAN MISS: post-flip, that writer BREAKS at its first use — loudly, fail-closed, and
 * discoverable. It NEVER becomes a silent un-brokered land. That asymmetry is the whole design: the scan
 * buys smooth arming, the hook buys the guarantee.
 *
 * NON-ROTTING: a future skill or script that adds ANY un-brokered main-write — a raw main commit OR a
 * `$DEFAULT`-variable markdown merge — REDs this enforcer. Both shapes are pinned in its own bite-test
 * (main-write-broker-completeness.test.js).
 *
 * USAGE: node scripts/checks/main-write-broker-completeness.js [--json] [--verbose]
 * EXIT:  0 = zero un-brokered main-writers (FLIP-TRIGGER GREEN)
 *        1 = at least one un-brokered main-writer (findings printed)
 *        2 = usage / internal error — FAIL-CLOSED (a scan that could not run is NEVER green)
 */
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  return process.env.CLAUDE_PROJECT_DIR || anchor;
}
const ROOT = resolveRoot();

const SCAN_ROOTS = ["scripts", path.join(".claude", "commands")];
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".sh", ".md"]);

/**
 * ALLOWLIST — the ONLY sanctioned un-brokered/self-brokering main-writers, each with a REASON, frozen in
 * code (a reviewed diff), never a settable in-file pragma. Keys are repo-relative POSIX paths.
 *
 * `kind`:
 *   "broker"     — this file IS the transport/fence mechanism.
 *   "alpha-hand" — a writer that legitimately holds the lease / is α's own hand, reasoned below.
 *   "non-main"   — a recognized write that targets a NON-default branch by construction (the conservative
 *                  recognizer flags it because the file also selects main somewhere; reviewed + reasoned).
 *   "scratch"    — writes only to a throwaway repo the file itself creates (mkdtemp), never this repo.
 */
const ALLOWLIST = Object.freeze({
  "scripts/dispatch/trusted-controller.js": {
    kind: "broker",
    reason:
      "THE broker. Owns the single fenced-CAS choke-point (fencedRefUpdate) + the 2 brokered entrypoints; its main-write IS the brokered route.",
  },
  "scripts/dispatch/acceptance-record.js": {
    kind: "broker",
    reason:
      "The unit-path CAS (commitIntegration) — the OTHER sanctioned mutating write, fenced + acceptance-bound. A merge/release write has no AcceptanceRecord, which is why the transport CAS is a separate site.",
  },
  "scripts/dispatch/broker-merge.js": {
    kind: "alpha-hand",
    reason:
      "self-brokering: calls integrateBranchMerge. #5, the α-merge dogfood helper (D-4 INC-1 MIG) — builds the merge object with commit-tree (moves NO ref), holds the conductor lease, and hands the object to the broker, which owns the only CAS. Its ordinary-route lines are the PRE-FLIP fallback, reachable only through broker-dogfood.js#attemptFallback: operational-only, refused on any security verdict, and never performed unless a ledger record was written first.",
  },
  "scripts/dispatch/broker-release-commit.js": {
    kind: "alpha-hand",
    reason:
      "self-brokering: calls integrateReleaseCommit. #6, the regen/bookkeeping commit route (D-4 INC-1 MIG) — same shape as broker-merge.js: single-parent commit built with commit-tree (moves NO ref), brokered CAS, audited pre-flip fallback.",
  },
  "scripts/dispatch/broker-dogfood.js": {
    kind: "alpha-hand",
    reason:
      "self-brokering support layer for the two helpers above (D-4 INC-1 MIG). Owns `ordinaryLand` — the ONLY un-brokered write in the dogfood path — behind the `attemptFallback` gate that classifies the broker's refusal (security/usage ⇒ never fall back) and refuses to write at all unless the fallback was LOGGED + COUNTED first. Post-flip the Seam E hook refuses this route outright, which is what ends the dogfood period.",
  },
  "scripts/hooks/protected-ref-transaction.js": {
    kind: "broker",
    reason: "The Seam E reference-transaction hook itself — the runtime fence that refuses un-brokered writes.",
  },
  "scripts/checks/main-write-broker-completeness.js": {
    kind: "broker",
    reason: "This enforcer. It NAMES the write idioms it hunts for; matching itself would be self-reference, not a write.",
  },
  "scripts/install-git-hooks.sh": {
    kind: "broker",
    reason:
      "The Seam E fence INSTALLER. Its recognized lines are the documented write-surface enumeration the reference-transaction hook covers (commit/update-ref/fast-forward/non-ff merge) — surfaces it fences, not writes it performs.",
  },
  "scripts/one-off/smoke-status.js": {
    kind: "scratch",
    reason:
      "One-off smoke script. Creates its OWN throwaway repo (mkdtempSync -> `git init -b main`) and commits there; it never touches this repository's main. Verified 2026-07-21 (D-4 INC-1 census).",
  },
  ".claude/commands/karpathy/integrate.md": {
    kind: "non-main",
    reason:
      "Integrates a karpathy winner onto a NORMAL FEATURE BRANCH off main (the skill's own words), never onto main directly; flagged only because its description sentence names main. Verified 2026-07-21 (D-4 INC-1 census).",
  },
  ".claude/commands/karpathy/run.md": {
    kind: "doc-prose",
    reason:
      "Matches only on lines that DENY a main-write (\"Nothing merges into `main` from this skill\", \"Never touch the main checkout\") and on a cross-reference to /karpathy:integrate. All mutation is inside the run worktree. Verified 2026-07-21 (D-4 INC-1 census).",
  },
  ".claude/commands/session/dump.md": {
    kind: "doc-prose",
    reason:
      'Matches a WRITING-STYLE example sentence ("do NOT merge SP-X to main until <condition> PASSes") illustrating how to phrase a handoff imperative. /session:dump writes a handoff document; it performs no git write. Verified 2026-07-21 (D-4 INC-1 census).',
  },
  ".claude/commands/oneshot/preflight.md": {
    kind: "non-main",
    reason:
      "Commits on the freshly-created skeleton branch (Step 2.3 branches off CURRENT and explicitly warns when on master/main); no default-branch write. Verified 2026-07-21 (D-4 INC-1 census).",
  },
  // ── ceremony step 1 (SP-20260721-001 D-4 INC-1, MIG flip-trigger) — the 4 deferred guidance docs + 2 ──
  // scratch-repo falsifiers named in the ceremony brief. release-canonical.js itself is MIGRATED, not
  // allowlisted — see its own header comment for the brokered-transport routing.
  ".claude/commands/commit/land.md": {
    kind: "doc-prose",
    reason:
      "Skill GUIDANCE a human/agent follows, not an executable call-site (the Step-4 raw `git merge --no-ff $BRANCH` teaches the land flow). Allowlisted; its brokered-aware guidance rewrite is a NAMED ceremony follow-up, not this step.",
  },
  ".claude/commands/session/end.md": {
    kind: "doc-prose",
    reason: "Guidance doc; Step-7 Land delegates to the land flow. Allowlisted; brokered-aware rewrite is a named follow-up.",
  },
  ".claude/commands/session/turbo.md": {
    kind: "doc-prose",
    reason:
      "Guidance doc describing turbo-close ff-merge + a push-to-main opt-in; not an executable call-site. Allowlisted; brokered-aware rewrite is a named follow-up.",
  },
  ".claude/commands/mc/release.md": {
    kind: "doc-prose",
    reason:
      "Guidance doc describing the release ceremony stages that release-canonical.js IMPLEMENTS. Allowlisted; once #1 is migrated its stage-9 description rewrite is a named follow-up.",
  },
  "scripts/dispatch/falsifiers/broker-acceptance.falsifier.test.js": {
    kind: "scratch",
    reason:
      "Falsifier test: intentionally contains a NON-brokered git merge/commit/update-ref as the NEGATIVE case the fence must REFUSE, on a SCRATCH repo with the real hook. Never touches canonical main — pure conservative-recognizer over-flag.",
  },
  "scripts/dispatch/falsifiers/release-index-feature-snapshot-excluded.falsifier.test.js": {
    kind: "scratch",
    reason:
      "Falsifier test (GF-2 teeth) for brokerReleaseCommit on a transport fixture; the non-brokered pattern IS the test subject, on a scratch-repo, not real main.",
  },
});

// ── FOLD 1 recognizer ────────────────────────────────────────────────────────────────────────────────

/**
 * MAIN_REF — "this line selects/names the default branch". VARIABLE-REF-AWARE (β FOLD 1 ii): the
 * `$DEFAULT` family is first-class, because the flagship deferred writer (commit/land.md) never writes a
 * literal `main` anywhere near its merge.
 */
const MAIN_REF_PATTERNS = [
  /\$\{?DEFAULT(?:_BRANCH|_MAIN)?\}?/, // $DEFAULT / ${DEFAULT} / $DEFAULT_BRANCH / $DEFAULT_MAIN
  /refs\/heads\/(?:main|master)\b/,
  /\borigin\/(?:main|master)\b/,
  /\bHEAD:(?:main|master)\b/,
  /\b(?:checkout|switch)\s+(?:-[A-Za-z-]+\s+)*(?:main|master)\b/,
  /\bdefault[\s_-]?branch\b/i,
];
// A BARE `main`/`master` token counts only in a git-ish context — otherwise "main" matches domains,
// `main()`, `main.js`, entry points, and the scan drowns. Conservative but not useless.
const BARE_MAIN = /["'`\s(\[,]\s*(?:main|master)\s*["'`\s)\],]/;
const GIT_CONTEXT = /\bgit\b|\bbranch\b|\bref(?:s|spec)?\b|\bcheckout\b|\bmerge\b|\bHEAD\b|\bupstream\b/i;

function selectsMain(line) {
  if (MAIN_REF_PATTERNS.some((re) => re.test(line))) return true;
  if (BARE_MAIN.test(line) && GIT_CONTEXT.test(line)) return true;
  return false;
}

/**
 * LOCAL_WRITE — a LOCAL ref-moving git action: merge (ff or --no-ff), commit, update-ref. Deliberately
 * EXCLUDED: `git push` (a REMOTE write — a different surface; the #7 census VERIFIED scripts/turbo/apply.js
 * is push-only [`git push origin main` as an opt-in permission SCOPE] and performs no local main-write —
 * its only "merge" is a settings.json permission merge), and the read-only `merge-base` / `merge-tree` /
 * `commit-tree` (object plumbing, no ref moves).
 *
 * TWO TIERS, because the two flagship deferred writers take DIFFERENT shapes and a single pattern
 * false-negatives one of them (the FOLD-1 trap):
 *   TIER A — COMMAND SHAPE: `git [-C <dir>|-c k=v|--flag|-x]* <merge|commit|update-ref>`, plus the
 *            args-ARRAY form (`gitC(canonical, ["merge", "--ff-only", branch])`, `spawnSync("git",
 *            ["update-ref", ...])`). Adjacency-bounded, so PROSE that merely contains the words "git"
 *            and "commit" in a sentence ("resolve the current commit SHA") does NOT match.
 *   TIER B — PROSE SHAPE (markdown only): a main-write described in English without a runnable git
 *            idiom — `ff-merge to main`, `merge-to-main`, `merges X into main`. REQUIRED because
 *            warp/release.md's stage-9 row ("| 9 | merge-to-main-and-push | ff-merge to main + push
 *            origin main |") contains NO `git` token at all; a TIER-A-only recognizer reads it GREEN,
 *            which is precisely the false-green on a flagship writer this enforcer exists to prevent.
 */
const WRITE_VERB = "merge|commit|update-ref";
const LOCAL_WRITE_TIER_A = [
  // `git`, then only option-ish tokens, then the write verb.
  new RegExp(String.raw`(?:^|[\s"'\`(\[,;&|])git(?:\s+(?:-C\s+\S+|-c\s+\S+|--[A-Za-z-]+(?:=\S+)?|-[A-Za-z]))*\s+(?:${WRITE_VERB})\b`, "i"),
  // args-array form: ["merge", ...] / ['update-ref', ...] / , "commit",
  new RegExp(String.raw`\[\s*["'\`](?:${WRITE_VERB})["'\`]`, "i"),
  new RegExp(String.raw`["'\`]update-ref["'\`]`, "i"),
];
const LOCAL_WRITE_TIER_B_PROSE = [
  /\bff-merge\b/i,
  /\bmerge-to-main\b/i,
  new RegExp(String.raw`\bmerg(?:e|es|ed|ing)\b[^\n]{0,60}?\b(?:in)?to\s+["'\`]?(?:main|master|\$\{?DEFAULT)`, "i"),
];
const WRITE_FALSE_FRIENDS = /merge-base|merge-tree|commit-tree|commit-graph|--no-commit|merge-guard|mergeable|merge conflict/i;

function isLocalWrite(line, isMarkdown = true) {
  if (WRITE_FALSE_FRIENDS.test(line)) return false;
  if (LOCAL_WRITE_TIER_A.some((re) => re.test(line))) return true;
  // TIER B is markdown-only: in JS/sh, English prose about merging is a comment, and TIER A already
  // catches every runnable form. In a SKILL, the English prose IS the instruction.
  if (isMarkdown && LOCAL_WRITE_TIER_B_PROSE.some((re) => re.test(line))) return true;
  return false;
}

/** A reference to a BROKERED entrypoint — evidence the file was migrated. */
const BROKER_CALL = /integrateBranchMerge|integrateReleaseCommit|fencedRefUpdate|brokeredMerge|brokered-merge/;

/**
 * SCRATCH-REPO evidence. Tests + falsifiers legitimately drive `git merge/commit/update-ref` against a
 * THROWAWAY repo (mkdtemp / makeScratchRepo), never this repo's main. They are excluded ONLY on that
 * positive evidence — never merely for being named `*.test.js` (a test file with no scratch marker IS
 * scanned, so a real writer cannot hide behind a `.test.js` suffix).
 */
const SCRATCH_MARKER = /mkdtempSync|makeScratchRepo|makeBareRemote|os\.tmpdir\(\)|tmpdir\(\)/;
const TESTISH = /(?:\.test\.js|\.falsifier\.test\.js|\.positive\.test\.js)$|[\\/]falsifiers[\\/]|[\\/]_lib[\\/]|[\\/]fixtures?[\\/]/;

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(full, out);
    } else if (e.isFile() && SCAN_EXTS.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * classifyFile(absPath, root) -> {rel, status, writes:[{line,text}], mainLines:[{line,text}], reason?}
 * status ∈ {"clean","broker","alpha-hand","scratch","migrated","UNBROKERED"}.
 */
function classifyFile(absPath, root) {
  const rel = toPosix(path.relative(root, absPath));
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (e) {
    // FAIL-CLOSED: an unreadable in-scope file is not silently "clean".
    return { rel, status: "UNBROKERED", writes: [], mainLines: [], reason: `unreadable: ${e.message}` };
  }
  const lines = content.split(/\r?\n/);
  const isMarkdown = path.extname(absPath).toLowerCase() === ".md";

  const writes = [];
  const mainLines = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!text) continue;
    if (isLocalWrite(text, isMarkdown)) writes.push({ line: i + 1, text: text.trim().slice(0, 180) });
    if (selectsMain(text)) mainLines.push({ line: i + 1, text: text.trim().slice(0, 180) });
  }

  // Not a candidate at all: no local write, or nothing anywhere in the file selects main.
  // (β FOLD 1 iii — CONSERVATIVE: the main-selection may be ANYWHERE in the file, not on the write line.)
  if (writes.length === 0 || mainLines.length === 0) return { rel, status: "clean", writes, mainLines };

  const al = ALLOWLIST[rel];
  if (al) return { rel, status: al.kind, writes, mainLines, reason: al.reason };

  if (TESTISH.test(rel) && SCRATCH_MARKER.test(content)) {
    return { rel, status: "scratch", writes, mainLines, reason: "operates on a throwaway scratch repo (mkdtemp/makeScratchRepo), never this repo's main" };
  }

  // MIGRATED requires BOTH: the file routes through a brokered entrypoint AND retains no raw write site.
  // A file that calls the broker but still has a raw `git merge` is NOT migrated — it is a partial
  // migration, which is precisely the state that must stay RED.
  if (BROKER_CALL.test(content) && writes.length === 0) return { rel, status: "migrated", writes, mainLines };

  return { rel, status: "UNBROKERED", writes, mainLines };
}

function scan(root = ROOT) {
  const files = [];
  for (const r of SCAN_ROOTS) {
    const abs = path.join(root, r);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  const classified = files.map((f) => classifyFile(f, root)).filter((c) => c.status !== "clean");
  const violations = classified.filter((c) => c.status === "UNBROKERED");
  return {
    ok: violations.length === 0,
    scannedFiles: files.length,
    violations,
    allowlisted: classified.filter((c) => ALLOWLIST[c.rel] !== undefined),
    scratch: classified.filter((c) => c.status === "scratch"),
    migrated: classified.filter((c) => c.status === "migrated"),
  };
}

function main(argv) {
  const json = argv.includes("--json");
  const verbose = argv.includes("--verbose");
  let res;
  try {
    res = scan(ROOT);
  } catch (e) {
    // FAIL-CLOSED (BC-16): a scan that crashed is exit 2, never a green.
    if (json) console.log(JSON.stringify({ ok: false, error: e.message, exit: 2 }, null, 2));
    else console.error(`main-write-broker-completeness: INTERNAL ERROR — ${e.message}`);
    return 2;
  }

  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }

  console.log(`main-write-broker-completeness — scanned ${res.scannedFiles} files under ${SCAN_ROOTS.join(", ")}`);
  console.log(
    `  brokers/alpha-hand allowlisted: ${res.allowlisted.length} · scratch-repo (tests/falsifiers): ${res.scratch.length} · migrated: ${res.migrated.length}`,
  );
  if (verbose) {
    for (const a of res.allowlisted) console.log(`  [allow ${a.status}] ${a.rel} — ${a.reason}`);
  }

  if (res.ok) {
    console.log("\nOK — ZERO un-brokered local main-write call-sites (FLIP-TRIGGER GREEN).");
    console.log(
      "NOTE (static-scan ceiling): green = no KNOWN un-brokered writer remains (pre-flip breakage-prevention),\n" +
        "NOT proof that every writer is migrated. The live reference-transaction hook is the runtime backstop;\n" +
        "a scan miss breaks fail-closed at first post-flip use, never a silent un-brokered land.",
    );
    return 0;
  }

  console.error(`\nFAIL — ${res.violations.length} un-brokered local main-write call-site file(s):\n`);
  for (const v of res.violations) {
    console.error(`  ${v.rel}${v.reason ? ` (${v.reason})` : ""}`);
    for (const w of v.writes.slice(0, 4)) console.error(`      write  L${w.line}: ${w.text}`);
    for (const m of v.mainLines.slice(0, 2)) console.error(`      main-> L${m.line}: ${m.text}`);
  }
  console.error(
    "\nEach must become exactly one of: a brokered entrypoint · a caller migrated to integrateBranchMerge/\n" +
      "integrateReleaseCommit · an ALLOWLIST entry (in-code, with a reason). This enforcer's FIRST green is\n" +
      "the named flip-trigger for arming the Seam E fence.",
  );
  return 1;
}

module.exports = { scan, classifyFile, selectsMain, isLocalWrite, ALLOWLIST, SCAN_ROOTS };

if (require.main === module) process.exit(main(process.argv.slice(2)));
