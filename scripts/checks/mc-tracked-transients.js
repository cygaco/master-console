#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");
const ALLOWLIST_FILE = path.join(__dirname, "mc-tracked-transients.allowlist.json");

const TRANSCRIPT_TXT_MIN_BYTES = 200 * 1024;

const FORBIDDEN = [
  {
    prefix: ".mc/",
    reason: "per-install transactional audit log; never ship",
  },
  {
    prefix: ".warpos/",
    reason: "legacy per-install transactional audit log (pre-2.0.0 dir name); never ship",
  },
  {
    basenameGlob: "qa-*.png",
    reason: "QA screenshot; should live under runtime/qa-*/",
  },
  { prefix: "runtime/qa-", reason: "QA output dir; gitignored" },
  { prefix: "runtime/research/", reason: "research artifacts; gitignored" },
  { prefix: "runtime/logs/", reason: "runtime logs; gitignored" },
  {
    suffix: "/beta/events.jsonl",
    reason: "owner=runtime append-only log (beta judgment events); never ship",
  },
  {
    suffix: "/events.jsonl",
    reason: "owner=runtime append-only log; gitignored",
  },
  {
    suffix: "/tools.jsonl",
    reason: "owner=runtime append-only tool log; gitignored",
  },
  {
    suffix: "/skill-usage.jsonl",
    reason: "owner=runtime append-only skill-usage log; gitignored",
  },
  {
    prefix: ".claude/agents/president/_system/beta/mined/",
    reason: "beta mining output — verbatim operator prompts mined from ignored logs; never ship",
  },
  {
    re: /^runtime\/.*\.(jsonl|log|diff|err|out)$/i,
    reason: "per-run artifact under runtime/ (.jsonl/.log/.diff/.err/.out); gitignored",
  },
  {
    re: /^runtime\/.*\.txt$/i,
    minBytes: TRANSCRIPT_TXT_MIN_BYTES,
    reason: `transcript-like text > ${TRANSCRIPT_TXT_MIN_BYTES} bytes under runtime/`,
  },
];

function matchForbidden(file, sizeOf) {
  for (const rule of FORBIDDEN) {
    if (rule.prefix && file.includes(rule.prefix)) return rule.reason;
    if (rule.suffix && file.endsWith(rule.suffix)) return rule.reason;
    if (rule.re && rule.re.test(file)) {
      if (rule.minBytes) {
        const sz = sizeOf ? sizeOf(file) : 0;
        if (sz > rule.minBytes) return rule.reason;
        continue;
      }
      return rule.reason;
    }
    if (
      rule.basenameGlob &&
      new RegExp("^" + rule.basenameGlob.replace(/\*/g, ".*") + "$").test(
        path.basename(file),
      )
    ) {
      return rule.reason;
    }
  }
  return null;
}

function loadAllowlist(file = ALLOWLIST_FILE) {
  if (!fs.existsSync(file)) return new Map();
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!j || !Array.isArray(j.allow)) return null;
  const m = new Map();
  for (const e of j.allow) {
    if (!e || typeof e.path !== "string" || typeof e.reason !== "string" || !e.reason.trim()) return null;
    m.set(e.path, e.reason);
  }
  return m;
}

function evaluate(candidates, { sizeOf, allow } = {}) {
  const allowMap = allow || new Map();
  const violations = [];
  const allowed = [];
  for (const { file, staged: isStaged } of candidates) {
    const reason = matchForbidden(file, sizeOf);
    if (!reason) continue;
    if (allowMap.has(file)) {
      allowed.push({ file, reason: allowMap.get(file) });
      continue;
    }
    violations.push({ file, reason, staged: !!isStaged });
  }
  return { violations, allowed };
}

function main() {
  const allow = loadAllowlist();
  if (allow === null) {
    const msg = `FAIL [mc-tracked-transients] allowlist unreadable or malformed: ${ALLOWLIST_FILE} (every entry needs path + reason)`;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(2);
  }

  const result = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (JSON_OUT)
      console.log(
        JSON.stringify({ ok: true, reason: "not a git repo or git unavailable" }),
      );
    else console.log("OK   [mc-tracked-transients] not a git repo");
    process.exit(0);
  }
  const tracked = result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const stagedRes = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const staged =
    stagedRes.status === 0
      ? stagedRes.stdout
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const seen = new Set();
  const candidates = [];
  for (const f of tracked) {
    if (seen.has(f)) continue;
    seen.add(f);
    candidates.push({ file: f, staged: false });
  }
  for (const f of staged) {
    if (seen.has(f)) {
      const existing = candidates.find((c) => c.file === f);
      if (existing) existing.staged = true;
      continue;
    }
    seen.add(f);
    candidates.push({ file: f, staged: true });
  }

  const sizeOf = (f) => {
    try {
      return fs.statSync(path.join(ROOT, f)).size;
    } catch {
      return 0;
    }
  };
  const { violations, allowed } = evaluate(candidates, { sizeOf, allow });

  if (violations.length === 0) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, count: 0, allowed: allowed.length }));
    else
      console.log(
        `OK   [mc-tracked-transients] no transient files tracked${allowed.length ? ` (${allowed.length} allowlisted)` : ""}`,
      );
    process.exit(0);
  }

  const out = {
    ok: false,
    count: violations.length,
    violations: violations.slice(0, 20),
  };
  if (JSON_OUT) console.log(JSON.stringify(out));
  else {
    const stagedCount = violations.filter((v) => v.staged).length;
    console.error(
      `FAIL [mc-tracked-transients] ${violations.length} transient file(s) tracked or staged${stagedCount ? ` (${stagedCount} staged for commit)` : ""}:`,
    );
    for (const v of violations.slice(0, 20))
      console.error(
        `  - ${v.file}  (${v.reason})${v.staged ? "  [STAGED]" : ""}`,
      );
    if (violations.length > 20)
      console.error(`  ... and ${violations.length - 20} more`);
    console.error(
      "\nFix: for tracked files `git rm --cached <file>`; for staged files `git reset HEAD <file>`. Then ensure .gitignore covers the pattern. A file that is genuinely needed goes in scripts/checks/mc-tracked-transients.allowlist.json WITH a reason.",
    );
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { FORBIDDEN, matchForbidden, evaluate, loadAllowlist, TRANSCRIPT_TXT_MIN_BYTES, main };
