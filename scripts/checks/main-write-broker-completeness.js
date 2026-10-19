#!/usr/bin/env node
"use strict";
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
      "self-brokering: calls integrateBranchMerge. The α-merge dogfood helper — builds the merge object with commit-tree (moves NO ref), holds the conductor lease, and hands the object to the broker, which owns the only CAS. Its ordinary-route lines are the PRE-FLIP fallback, reachable only through broker-dogfood.js#attemptFallback: operational-only, refused on any security verdict, and never performed unless a ledger record was written first.",
  },
  "scripts/dispatch/broker-release-commit.js": {
    kind: "alpha-hand",
    reason:
      "self-brokering: calls integrateReleaseCommit. The regen/bookkeeping commit route — same shape as broker-merge.js: single-parent commit built with commit-tree (moves NO ref), brokered CAS, audited pre-flip fallback.",
  },
  "scripts/dispatch/broker-dogfood.js": {
    kind: "alpha-hand",
    reason:
      "self-brokering support layer for the two helpers above. Owns `ordinaryLand` — the ONLY un-brokered write in the dogfood path — behind the `attemptFallback` gate that classifies the broker's refusal (security/usage ⇒ never fall back) and refuses to write at all unless the fallback was LOGGED + COUNTED first. Post-flip the Seam E hook refuses this route outright, which is what ends the dogfood period.",
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
      "One-off smoke script. Creates its OWN throwaway repo (mkdtempSync -> `git init -b main`) and commits there; it never touches this repository's main.",
  },
  ".claude/commands/karpathy/integrate.md": {
    kind: "non-main",
    reason:
      "Integrates a karpathy winner onto a NORMAL FEATURE BRANCH off main (the skill's own words), never onto main directly; flagged only because its description sentence names main.",
  },
  ".claude/commands/karpathy/run.md": {
    kind: "doc-prose",
    reason:
      "Matches only on lines that DENY a main-write (\"Nothing merges into `main` from this skill\", \"Never touch the main checkout\") and on a cross-reference to /karpathy:integrate. All mutation is inside the run worktree.",
  },
  ".claude/commands/session/dump.md": {
    kind: "doc-prose",
    reason:
      'Matches a WRITING-STYLE example sentence ("do NOT merge SP-X to main until <condition> PASSes") illustrating how to phrase a handoff imperative. /session:dump writes a handoff document; it performs no git write.',
  },
  ".claude/commands/oneshot/preflight.md": {
    kind: "non-main",
    reason:
      "Commits on the freshly-created skeleton branch (Step 2.3 branches off CURRENT and explicitly warns when on master/main); no default-branch write.",
  },
  ".claude/commands/commit/land.md": {
    kind: "doc-prose",
    reason:
      "Skill GUIDANCE a human/agent follows, not an executable call-site. Step 4 routes the merge through scripts/dispatch/broker-merge.js and names a raw `git merge $BRANCH` only as REFUSED; the conservative recognizer flags those lines. Allowlisted.",
  },
  ".claude/commands/session/end.md": {
    kind: "doc-prose",
    reason:
      "Guidance doc, not an executable call-site; Phase 7 — Land delegates the merge to /commit:land, which brokers it through scripts/dispatch/broker-merge.js. Allowlisted.",
  },
  ".claude/commands/session/turbo.md": {
    kind: "doc-prose",
    reason:
      "Guidance doc describing turbo-close ff-merge + a push-to-main opt-in; not an executable call-site. Allowlisted.",
  },
  ".claude/commands/mc/release.md": {
    kind: "doc-prose",
    reason:
      "Guidance doc describing the release ceremony stages that release-canonical.js IMPLEMENTS. Allowlisted.",
  },
  "scripts/dispatch/falsifiers/broker-acceptance.falsifier.test.js": {
    kind: "scratch",
    reason:
      "Falsifier test: intentionally contains a NON-brokered git merge/commit/update-ref as the NEGATIVE case the fence must REFUSE, on a SCRATCH repo with the real hook. Never touches canonical main — pure conservative-recognizer over-flag.",
  },
  "scripts/dispatch/falsifiers/release-index-feature-snapshot-excluded.falsifier.test.js": {
    kind: "scratch",
    reason:
      "Falsifier test for brokerReleaseCommit on a transport fixture; the non-brokered pattern IS the test subject, on a scratch-repo, not real main.",
  },
  "scripts/public-repo/generate.js": {
    kind: "scratch",
    reason:
      "Public-repo generator: git-init's and commits ONLY in fresh temp dirs / the caller's --out (never this repository); its 'main' is the new output repo's own branch.",
  },
  "scripts/sprint/test-sprint-full.js": {
    kind: "scratch",
    reason:
      "test-only: commits land in mkdtemp scratch repos, never a real main.",
  },
});

const MAIN_REF_PATTERNS = [
  /\$\{?DEFAULT(?:_BRANCH|_MAIN)?\}?/,
  /refs\/heads\/(?:main|master)\b/,
  /\borigin\/(?:main|master)\b/,
  /\bHEAD:(?:main|master)\b/,
  /\b(?:checkout|switch)\s+(?:-[A-Za-z-]+\s+)*(?:main|master)\b/,
  /\bdefault[\s_-]?branch\b/i,
];
const BARE_MAIN = /["'`\s(\[,]\s*(?:main|master)\s*["'`\s)\],]/;
const GIT_CONTEXT = /\bgit\b|\bbranch\b|\bref(?:s|spec)?\b|\bcheckout\b|\bmerge\b|\bHEAD\b|\bupstream\b/i;

function selectsMain(line) {
  if (MAIN_REF_PATTERNS.some((re) => re.test(line))) return true;
  if (BARE_MAIN.test(line) && GIT_CONTEXT.test(line)) return true;
  return false;
}

const WRITE_VERB = "merge|commit|update-ref";
const LOCAL_WRITE_TIER_A = [
  new RegExp(String.raw`(?:^|[\s"'\`(\[,;&|])git(?:\s+(?:-C\s+\S+|-c\s+\S+|--[A-Za-z-]+(?:=\S+)?|-[A-Za-z]))*\s+(?:${WRITE_VERB})\b`, "i"),
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
  if (isMarkdown && LOCAL_WRITE_TIER_B_PROSE.some((re) => re.test(line))) return true;
  return false;
}

const BROKER_CALL = /integrateBranchMerge|integrateReleaseCommit|fencedRefUpdate|brokeredMerge|brokered-merge/;

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

function classifyFile(absPath, root) {
  const rel = toPosix(path.relative(root, absPath));
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (e) {
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

  if (writes.length === 0 || mainLines.length === 0) return { rel, status: "clean", writes, mainLines };

  const al = ALLOWLIST[rel];
  if (al) return { rel, status: al.kind, writes, mainLines, reason: al.reason };

  if (TESTISH.test(rel) && SCRATCH_MARKER.test(content)) {
    return { rel, status: "scratch", writes, mainLines, reason: "operates on a throwaway scratch repo (mkdtemp/makeScratchRepo), never this repo's main" };
  }

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
