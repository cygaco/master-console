#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
    re: /(?<![\w./-])\/(?:Users|home)\/[A-Za-z0-9._-]+\b/,
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
  "scripts/check/privacy.js",
  ".claude/commands/scan/privacy.md",
  "tests/transcripts/check-privacy.md",
];

const ALLOWLIST_FILE = path.join(__dirname, "privacy.allowlist.json");

function loadAllowlist() {
  try {
    const j = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"));
    return {
      emails: new Set([
        ...(j.emails || []),
        ...(j.emailPairs || []).map((p) => `${p[0]}@${p[1]}`),
      ].map((s) => s.toLowerCase())),
      emailDomains: new Set((j.emailDomains || []).map((s) => s.toLowerCase())),
      emailDomainSuffixes: (j.emailDomainSuffixes || []).map((s) => s.toLowerCase()),
    };
  } catch {
    return { emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] };
  }
}

const RELEASE_TAG_RE = new RegExp(
  `^mc@v?\\d+(?:\\.\\d+)*(?:\\.\\.\\.[A-Za-z0-9._/-]+)?$`,
);

function isAllowlistedEmail(email, allow) {
  const e = email.toLowerCase();
  if (allow.emails.has(e)) return true;
  if (RELEASE_TAG_RE.test(e)) return true;
  const at = e.lastIndexOf("@");
  if (at === -1) return false;
  const domain = e.slice(at + 1);
  if (allow.emailDomains.has(domain)) return true;
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
    return null;
  }
}

const MIN_TRACKED_FILES_FLOOR = 1000;

const UNREADABLE_TOLERANCE = 20;

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
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|gz|tar)$/i.test(f))
        return false;
      return true;
    });
  }

  const runtimeRoots = loadRuntimeRoots();
  const runtimeTracked = files.filter((f) =>
    runtimeRoots.some((r) => f.startsWith(r + "/") || f === r),
  );

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
