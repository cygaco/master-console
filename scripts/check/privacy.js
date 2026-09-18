#!/usr/bin/env node
/**
 * scripts/check/privacy.js — Pre-publish scan for personal data leaks.
 * FAIL-CLOSED by default since S-OS-04 (ED-417): any HIGH or MED finding exits 1.
 *
 * Patterns enumerated explicitly (NOT a hand-wave "scan for personal data"):
 *   1. Emails (RFC-5322 simplified) — MED, minus the placeholder allowlist in
 *      scripts/check/privacy.allowlist.json (example.com, *.local, git@github.com …)
 *   2. Names from .claude/project/memory/known-names.json (project-specific) — MED
 *   3. Credential markers (sk-*, ghp_*, glpat-*, AKIA*, BEGIN PRIVATE KEY) — HIGH
 *   4. Absolute paths under user homedirs (/Users/, /home/, C:\Users\) — LOW
 *      (report-only: the operator is a public figure and old paths inside docs and
 *      logs are fine; hardcoded paths in EXECUTABLES are a hard finding of
 *      scripts/checks/framework-purity.js, not of this scan)
 *   5. Any file under paths.runtime, paths.events, paths.memory tracked by git — HIGH
 *
 * Usage:
 *   node scripts/check/privacy.js                  scan every tracked file
 *   node scripts/check/privacy.js --files <a,b>    scan specific files
 *   node scripts/check/privacy.js --json           JSON output
 *   node scripts/check/privacy.js --strict         exit 1 on ANY finding (LOW included)
 *   node scripts/check/privacy.js --advisory       pre-S-OS-04 behaviour: exit 1 only on HIGH
 *   node scripts/check/privacy.js --no-name-check  known-names.json absent is expected (it's
 *                                                   gitignored); proceed instead of refusing
 *
 * Exit:
 *   0 — no failing findings for the chosen mode
 *   1 — default: any HIGH or MED · --strict: any finding · --advisory: any HIGH
 *   2 — usage error, unreadable/truncated tree, or an INACTIVE known-name check without
 *       --no-name-check
 *
 * Enforcer of its own contract: scripts/check/privacy.test.js (planted email +
 * credential fixtures must exit 1; allowlisted placeholder must not; the live
 * tracked tree must exit 0).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// S-OS-06 (β `4f81c60d`): the legacy lab is a DETECTOR TERM — this scanner must recognise a legacy
// release tag (`<legacy>@0.1.0`) so it does not report it as personal data. It is a still-valid use,
// not a retired brand occurrence, so it is neither removed (that would make the gate false-flag the
// tags) nor warranted (a warrant excuses a violation; this is not one). It is DERIVED.
//
// Source is `partition-loader#LEGACY_LAB`, which reads the evidence-tag RULE's own pinned literal —
// the same technique partition-loader.js:119 uses so that module carries ONE legacy literal. That rule
// is permanent ("kept forever, never rewritten"), so the detector never expires.
//
// NOT derived from `hooks/lib/mc-env#LEGACY_SLUG`: that one is dispositioned `compat` with
// `REMOVED_IN = "mc@2.1.0"`. Deriving from it would import that expiry transitively, and at 2.1.0 this
// scanner would silently stop matching the very tags the epic preserved and start reporting them as
// PII. An expiry on a permanent need is a scheduled defect.
const { LEGACY_LAB } = require("../open-source/partition-loader.js");

const PATTERNS = [
  {
    id: "credential-sk",
    severity: "HIGH",
    re: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/,
  },
  {
    id: "credential-pem",
    severity: "HIGH",
    re: /-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/,
  },
  {
    id: "email",
    severity: "MED",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  {
    id: "homedir-mac-linux",
    severity: "LOW",
    re: /\b\/(?:Users|home)\/[A-Za-z0-9._-]+\b/,
  },
  {
    id: "homedir-windows",
    severity: "LOW",
    re: /\bC:[\\/]+Users[\\/]+[A-Za-z0-9._-]+/,
  },
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "out",
  ".mc",
]);

const SKIP_FILES = [
  // Skill body itself enumerates the patterns by design — false-positive site
  "scripts/check/privacy.js",
  ".claude/commands/scan/privacy.md",
  "tests/transcripts/check-privacy.md",
];

const ALLOWLIST_FILE = path.join(__dirname, "privacy.allowlist.json");

function loadAllowlist() {
  try {
    const j = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"));
    return {
      emails: new Set((j.emails || []).map((s) => s.toLowerCase())),
      emailDomains: new Set((j.emailDomains || []).map((s) => s.toLowerCase())),
      emailDomainSuffixes: (j.emailDomainSuffixes || []).map((s) => s.toLowerCase()),
    };
  } catch {
    // A missing/unreadable allowlist is NOT a reason to fail-open the scan: with
    // no allowlist every email is a finding (fail-closed).
    return { emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] };
  }
}

// The release-tag / compare-range predicate, built from the DERIVED legacy lab plus the current lab.
// Anchored at BOTH ends and matched positionally on the lab prefix: the version must be the WHOLE
// remainder, never "contains a version somewhere", or real addresses with version-shaped domains would
// be allowlisted as non-personal. `mc` is the current brand and is not a legacy occurrence.
const RELEASE_TAG_RE = new RegExp(
  `^(?:${LEGACY_LAB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|mc)@v?\\d+(?:\\.\\d+)*(?:\\.\\.\\.[A-Za-z0-9._/-]+)?$`,
);

// true ⇒ this email is a documented placeholder / bot address, not personal data.
function isAllowlistedEmail(email, allow) {
  const e = email.toLowerCase();
  if (allow.emails.has(e)) return true;
  // `<legacy-lab>@1.2.3` / `mc@1.2.3...main` is a release tag or a GitHub compare
  // range, not an address: matched POSITIONALLY on the lab prefix + a bare
  // version, never a loose "contains N.N.N somewhere" — an IP-literal domain
  // (`user@10.0.0.1`) or a version-shaped subdomain (`hacker@1.2.3.com`,
  // `victim@1.2.3.evil.co.uk`) is genuinely personal data and must NOT match.
  if (RELEASE_TAG_RE.test(e)) return true;
  const at = e.lastIndexOf("@");
  if (at === -1) return false;
  const domain = e.slice(at + 1);
  if (allow.emailDomains.has(domain)) return true;
  // A suffix entry must be a REAL label-boundary suffix. Guarded at the MATCH site, not only at load,
  // so the property holds however the allow object was built (the loader is not the only caller).
  // Two fail-OPEN shapes are rejected, both measured: "" matches every domain (`endsWith("")` is always
  // true, so one stray entry allowlists the whole world), and a dotless entry like "com" matches an
  // entire TLD. Both would silently turn real personal data into "not personal data" in a fail-closed gate.
  return allow.emailDomainSuffixes.some((suf) => {
    const s = String(suf);
    if (s.length < 2 || !s.startsWith(".")) return false;
    return domain.endsWith(s);
  });
}

// H2 (r6): returns null on a git-listing failure (never []) — a caller must be able to tell
// "git couldn't be asked" apart from "git said zero files", or a failure silently reads as a
// clean, fully-scanned tree. See main()'s refusal on null / below-floor counts.
function trackedFiles() {
  try {
    return execSync("git ls-files", {
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

// H2 (r6): a committed minimum-file floor, independent of the git-listing-failure check above.
// Measured: `node scripts/check/privacy.js` at 7a68bd48 (S-OS-06 r6 base) reports
// "scanned 4610 file(s)" post-filter. Picked well below that so ordinary variance (files added
// or removed over time) never trips it — only a scan that sees implausibly few files (wrong cwd,
// truncated listing, near-empty/corrupt checkout) does.
const MIN_TRACKED_FILES_FLOOR = 1000;

// H1B (r7): `git ls-files` succeeding is not the same as the LISTED paths being readable from
// cwd. A small number of listed-but-missing files is ordinary variance (a rename/delete racing
// the scan); anything past this is the signature of a systematically unreadable or wrong-cwd
// tree — the exact shape the r6 floor was supposed to catch but didn't, because it floored the
// LISTING (`files.length`) instead of what was actually read.
const UNREADABLE_TOLERANCE = 20;

// H3 (r6): resolved from the REPO ROOT (not cwd) — a cwd-relative path silently resolves to
// nothing whenever this script is invoked from anywhere but the repo root. Returns a status
// object (not a bare array) so main() can tell "no names configured because none matched" apart
// from "the known-name pattern never ran" and refuse accordingly.
function loadKnownNames() {
  const f = path.join(__dirname, "..", "..", ".claude", "project", "memory", "known-names.json");
  if (!fs.existsSync(f)) return { names: [], active: false, path: f };
  try {
    const names = JSON.parse(fs.readFileSync(f, "utf8")).names || [];
    return { names, active: true, path: f };
  } catch {
    return { names: [], active: false, path: f };
  }
}

function loadRuntimeRoots() {
  try {
    const PATHS = require("../hooks/lib/paths").PATHS;
    return [PATHS.runtime, PATHS.events, PATHS.memory].filter(Boolean);
  } catch {
    return [
      ".claude/runtime",
      ".claude/project/events",
      ".claude/project/memory",
    ];
  }
}

function scanFile(file, ctx) {
  const knownNames = (ctx && ctx.knownNames) || [];
  const allow = (ctx && ctx.allow) || loadAllowlist();
  // H1B (r7): an optional shared counter so callers can tell "how many of the files we were
  // asked to scan did we actually READ" apart from "how many were merely listed" — see main().
  const stats = ctx && ctx.stats;
  const findings = [];
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    if (stats) stats.unreadable++;
    return findings;
  }
  if (stats) stats.read++;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      // H1 (r6): scan EVERY match on the line, not just the first — a bare `line.match(p.re)`
      // without the /g flag returns only the first hit, and (for the email pattern) an
      // allowlisted first match used to `continue` the WHOLE line, silently skipping any
      // real address that followed it on the same line. A fresh /g-flagged RegExp per
      // pattern keeps lastIndex from leaking across lines/files.
      const globalRe = new RegExp(
        p.re.source,
        p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g",
      );
      let m;
      while ((m = globalRe.exec(line)) !== null) {
        if (p.id === "email" && isAllowlistedEmail(m[0], allow)) {
          if (m.index === globalRe.lastIndex) globalRe.lastIndex++;
          continue;
        }
        findings.push({
          file,
          line: i + 1,
          pattern: p.id,
          severity: p.severity,
          match: m[0].slice(0, 80),
        });
        if (m.index === globalRe.lastIndex) globalRe.lastIndex++;
      }
    }
    for (const name of knownNames) {
      if (line.includes(name)) {
        findings.push({
          file,
          line: i + 1,
          pattern: "known-name",
          severity: "MED",
          match: name,
        });
      }
    }
  }
  return findings;
}

// mode: "default" (HIGH+MED fail) | "strict" (any) | "advisory" (HIGH only)
function shouldFail(findings, mode) {
  if (mode === "strict") return findings.length > 0;
  if (mode === "advisory") return findings.some((f) => f.severity === "HIGH");
  return findings.some((f) => f.severity === "HIGH" || f.severity === "MED");
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const mode = args.includes("--strict")
    ? "strict"
    : args.includes("--advisory")
      ? "advisory"
      : "default";
  const fi = args.indexOf("--files");
  if (fi !== -1 && !args[fi + 1]) {
    process.stderr.write("usage: --files <a,b,c>\n");
    process.exit(2);
  }
  const explicit = fi !== -1 ? args[fi + 1].split(",") : null;

  let files;
  if (explicit) {
    files = explicit;
  } else {
    const tracked = trackedFiles();
    if (tracked === null) {
      process.stderr.write(
        "privacy: git file listing failed — refusing to read green on an unreadable tree\n",
      );
      process.exit(2);
    }
    files = tracked.filter((f) => {
      if (SKIP_FILES.includes(f)) return false;
      const top = f.split("/")[0];
      if (SKIP_DIRS.has(top)) return false;
      // Skip binary-ish extensions
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|gz|tar)$/i.test(f))
        return false;
      return true;
    });
    // H1B (r7): the floor used to gate `files.length` — the LISTING — here. That measures
    // "git ls-files worked", not "we could read what it listed": a listed-but-unreadable tree
    // (wrong cwd, files gone missing from disk while still in the index, etc.) sailed through
    // this check with the full listed count and then read nothing. The real floor/tolerance
    // check now runs AFTER the scan loop below, against what was actually read.
  }

  // Runtime tracked check
  const runtimeRoots = loadRuntimeRoots();
  const runtimeTracked = files.filter((f) =>
    runtimeRoots.some((r) => f.startsWith(r + "/") || f === r),
  );

  // H3 (r6): the known-name pattern is INACTIVE by construction in CI — its store is
  // gitignored (.gitignore, `.claude/project/memory/`). A vacuous pattern that fires no
  // findings must not silently masquerade as "checked and clean"; refuse unless the caller
  // explicitly opts in with --no-name-check (leak-gate.js does, for exactly this reason).
  const noNameCheck = args.includes("--no-name-check");
  const knownNamesResult = loadKnownNames();
  if (!knownNamesResult.active) {
    const inactiveMsg = `known-names: INACTIVE (${knownNamesResult.path} absent)\n`;
    process.stderr.write(inactiveMsg);
    if (!noNameCheck) {
      process.stderr.write(
        "privacy: known-name pattern is INACTIVE — pass --no-name-check to proceed anyway, or provide the file\n",
      );
      process.exit(2);
    }
  }
  // H1B (r7): `stats` counts what was actually READ, independent of `files.length` (the listing).
  const stats = { read: 0, unreadable: 0 };
  const ctx = { knownNames: knownNamesResult.names, allow: loadAllowlist(), stats };
  let allFindings = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      stats.unreadable++;
      continue;
    }
    allFindings = allFindings.concat(scanFile(f, ctx));
  }

  // H1B (r7): the real floor/tolerance check — on files actually READ, not merely listed.
  // Skipped for `--files`/explicit mode: a deliberate single- or few-file scan must not trip a
  // floor sized for the whole tracked tree (unchanged historical behaviour for that mode).
  if (!explicit) {
    if (stats.read < MIN_TRACKED_FILES_FLOOR) {
      process.stderr.write(
        `privacy: only ${stats.read} file(s) actually read (below the floor of ${MIN_TRACKED_FILES_FLOOR}; ${files.length} were listed, ${stats.unreadable} unreadable) — refusing to read green on a tree it could not read\n`,
      );
      process.exit(2);
    }
    if (stats.unreadable > UNREADABLE_TOLERANCE) {
      process.stderr.write(
        `privacy: listed ${files.length} file(s) but only read ${stats.read} (${stats.unreadable} unreadable, exceeding the tolerance of ${UNREADABLE_TOLERANCE}) — refusing to read green on a tree it could not read\n`,
      );
      process.exit(2);
    }
  }

  for (const f of runtimeTracked) {
    allFindings.push({
      file: f,
      line: 0,
      pattern: "runtime-tracked",
      severity: "HIGH",
      match: "file under runtime/events/memory is git-tracked",
    });
  }

  const high = allFindings.filter((f) => f.severity === "HIGH");
  const med = allFindings.filter((f) => f.severity === "MED");
  const fail = shouldFail(allFindings, mode);
  if (asJson) {
    process.stdout.write(JSON.stringify(allFindings, null, 2) + "\n");
  } else {
    process.stdout.write(
      `# scanned ${stats.read} file(s); ${allFindings.length} finding(s) (${high.length} HIGH, ${med.length} MED); mode=${mode}\n`,
    );
    // Failing findings first; LOW (report-only unless --strict) after.
    const ordered = allFindings
      .slice()
      .sort((a, b) => rank(a.severity) - rank(b.severity));
    for (const f of ordered.slice(0, 200)) {
      process.stdout.write(
        `  ${f.severity}  ${f.file}:${f.line}  ${f.pattern}  ${f.match}\n`,
      );
    }
    if (ordered.length > 200) {
      process.stdout.write(`  ... and ${ordered.length - 200} more\n`);
    }
    process.stdout.write(`# result: ${fail ? "FAIL" : "OK"} (exit ${fail ? 1 : 0})\n`);
  }
  process.exit(fail ? 1 : 0);
}

function rank(sev) {
  return sev === "HIGH" ? 0 : sev === "MED" ? 1 : 2;
}

if (require.main === module) main();

module.exports = {
  PATTERNS,
  scanFile,
  shouldFail,
  isAllowlistedEmail,
  loadAllowlist,
  loadKnownNames,
  loadRuntimeRoots,
};
