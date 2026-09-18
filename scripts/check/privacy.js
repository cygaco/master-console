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
 *
 * Exit:
 *   0 — no failing findings for the chosen mode
 *   1 — default: any HIGH or MED · --strict: any finding · --advisory: any HIGH
 *   2 — usage error
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
    return [];
  }
}

function loadKnownNames() {
  const f = path.join(".claude", "project", "memory", "known-names.json");
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")).names || [];
  } catch {
    return [];
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
  const findings = [];
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return findings;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      if (p.id === "email" && isAllowlistedEmail(m[0], allow)) continue;
      findings.push({
        file,
        line: i + 1,
        pattern: p.id,
        severity: p.severity,
        match: m[0].slice(0, 80),
      });
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
    files = trackedFiles().filter((f) => {
      if (SKIP_FILES.includes(f)) return false;
      const top = f.split("/")[0];
      if (SKIP_DIRS.has(top)) return false;
      // Skip binary-ish extensions
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|gz|tar)$/i.test(f))
        return false;
      return true;
    });
  }

  // Runtime tracked check
  const runtimeRoots = loadRuntimeRoots();
  const runtimeTracked = files.filter((f) =>
    runtimeRoots.some((r) => f.startsWith(r + "/") || f === r),
  );

  const ctx = { knownNames: loadKnownNames(), allow: loadAllowlist() };
  let allFindings = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    allFindings = allFindings.concat(scanFile(f, ctx));
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
      `# scanned ${files.length} file(s); ${allFindings.length} finding(s) (${high.length} HIGH, ${med.length} MED); mode=${mode}\n`,
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
