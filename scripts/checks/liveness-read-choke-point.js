#!/usr/bin/env node
"use strict";
/**
 * liveness-read-choke-point.js — the KILL-THE-SEAM structural guard for same-session dispatch-liveness reads
 * (SP-20260718-004, gauntlet R4 close; β DIRECTIVE + α reconciliation). The recurrence-stopper.
 *
 * THE CLASS: the gauntlet found the SAME mistake-reachable false-green (a reader trusting a field-only ok:true
 * dispatch-completion record) in reader after reader, round after round. Patching each instance recurred. This
 * guard closes the CLASS: any SAME-SESSION file that READS the dispatch-completions ledger AND gates on an
 * ok:true record MUST also verify a valid origin-proof signature — routed through the shared choke-point
 * (scripts/dispatch/verified-liveness-read.js#isVerifiedLivenessRecord) OR calling attest-signing.verifyRecord
 * directly. A file that reads + gates on ok:true but NEVER verifies is a re-opened hole → this guard FAILS it.
 * So a NEW reader added later cannot silently re-open the class — it fails the guard until it verifies.
 *
 * CROSS-SESSION EXEMPTION (β teeth — structural, NOT a settable marker): signature verification requires the
 * signer + verifier to share the per-session HMAC secret (ADR-0025). A reader of a FOREIGN-session ledger
 * (a different repo/session that signed with a DIFFERENT secret) is UNVERIFIABLE BY CONSTRUCTION — forcing
 * verification there is a false-RED (the R3 verifyTyped regression). Such readers are EXPLICITLY exempted by
 * their STRUCTURAL property (they read an isolated/foreign-session ledger), named here with a reason, and
 * tracked (ED-232 cross-session key-distribution). The exemption is a reviewed CODE allowlist, never a
 * per-record settable field.
 *
 * Exit: 0 clean · 1 a same-session ledger reader gates on ok:true without verifying · 2 usage/internal.
 */
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  return process.env.CLAUDE_PROJECT_DIR || anchor;
}
const ROOT = resolveRoot();

// Scan ALL of scripts/ (gauntlet R5 SR-R5-001: a same-session reader in scripts/ ROOT — skills-test.js — was
// missed by a fixed sub-dir list). Tests + the verifier + the helper itself are excluded (a test is not a live
// reader; attest-signing IS the verifier; the helper IS the choke-point).
const SCAN_DIRS = ["scripts"];
const EXCLUDE_BASENAMES = new Set([
  "verified-liveness-read.js", // the choke-point itself
  "attest-signing.js", // the verifier itself
  "liveness-read-choke-point.js", // this guard
]);

// STRUCTURAL cross-session exemption: readers of a FOREIGN-session ledger, unverifiable by construction.
// Each entry names WHY it is cross-session (the structural property), not a settable flag. Tracked: ED-232.
const CROSS_SESSION_EXEMPT = Object.freeze({
  "scripts/mc/test-sealed-capsule-gate.js":
    "verifyTyped reads an ISOLATED child repo's ledger (sealed-capsule gate spawns a foreign session that " +
    "signs with its own per-session secret); unverifiable under the same-session HMAC model (ADR-0025). " +
    "Cross-session key-distribution is the ED-232 priority follow-up.",
});

// A file READS the dispatch-completions ledger if it names it or the canonical read helpers.
const LEDGER_READ = /dispatch-completions|WARPOS_COVERAGE_LEDGER|readCompletions|dispatchCompletionsFile/;
// A file GATES on an ok:true liveness RECORD — a `record.ok === true` / `record.ok !== true` COMPARISON, the
// canonical form where the actual ledger-record trust checks appear (and where every real reader this sprint
// converted lived). NAMED RESIDUAL (gauntlet R6 SR-R6-002/LRCP-R6-001 → ED-229): the truthy/negated/destructured
// equivalents (`if (!r.ok)`, `({ ok }) => ok`) are DELIBERATELY not matched here — a regex cannot distinguish a
// LEDGER record's `.ok` from a function-result `.ok` (`!res.ok`) or a JSON output literal (`{ ok: true }`) without
// DATAFLOW, so broadening the pattern produced ~26 pure false positives (unusable). Complete predicate-form +
// ledger-record-scoped coverage is the AST/dataflow guard upgrade = ED-229 (already tracked, deferred). This
// guard is therefore a bounded structural DETECTOR (defense-in-depth) at the canonical form; the GUARANTEE is
// that every ACTUAL current same-session reader is converted through the choke-point (β's structure-is-the-
// guarantee, scan-is-defense-in-depth framing). Deliberately NOT the `ok: true` object-LITERAL (return values).
const OK_PREDICATE = /\.ok\s*===\s*true|\.ok\s*!==\s*true/;
// Verification is PRESENT if it references the shared choke-point or the verifier directly.
const VERIFIES = /isVerifiedLivenessRecord|filterVerifiedLiveness|verified-liveness-read|verifyRecord/;
// A raw ok-predicate is checked PER-READ against a window (gauntlet R5 SR-R5-002: a per-FILE token check
// false-negatives when verifyRecord appears once but a raw ok:true read is elsewhere). Each raw record-.ok
// predicate must have a verifier within ±WINDOW lines. A LEGIT shape-only check whose signature verification
// lives in its caller (e.g. isWellFormedOkRecord) annotates itself with a `liveness-verified:` code pragma —
// a reviewed CODE-LINE annotation (NOT a settable per-record field, β teeth #1).
const WINDOW = 12;
const PRAGMA = /liveness-verified:/;
// Strip comments before the VERIFIES check (gauntlet R6 LRCP-R6-002): a verifier NAME mentioned inside a
// comment is NOT proof of verification. (The `liveness-verified:` PRAGMA is checked on the RAW window — it IS
// a reviewed comment annotation, deliberately.)
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function listJs(absDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) out.push(...listJs(abs));
    else if (e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(abs);
  }
  return out;
}

function scan(root = ROOT) {
  const violations = [];
  const exemptSeen = [];
  for (const d of SCAN_DIRS) {
    for (const abs of listJs(path.join(root, d))) {
      if (EXCLUDE_BASENAMES.has(path.basename(abs))) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      let text;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (!LEDGER_READ.test(text)) continue; // does not read the dispatch-completions ledger
      const lines = text.split(/\r?\n/);
      const okLines = [];
      for (let i = 0; i < lines.length; i++) if (OK_PREDICATE.test(lines[i])) okLines.push(i);
      if (okLines.length === 0) continue; // reads the ledger but never gates on a record's .ok (not a liveness gate)
      if (CROSS_SESSION_EXEMPT[rel]) {
        exemptSeen.push(rel);
        continue; // structurally cross-session — unverifiable by construction, tracked (ED-232)
      }
      // PER-READ (R5 SR-R5-002): each raw record-.ok predicate must have verification (or a reviewed pragma)
      // within ±WINDOW lines — a verifyRecord token elsewhere in the file no longer suppresses an unverified read.
      for (const i of okLines) {
        const from = Math.max(0, i - WINDOW);
        const to = Math.min(lines.length, i + WINDOW + 1);
        const win = lines.slice(from, to).join("\n");
        if (!VERIFIES.test(stripComments(win)) && !PRAGMA.test(win)) {
          violations.push({
            file: rel,
            line: i + 1,
            what: `an ok:true ledger predicate (\`${lines[i].trim().slice(0, 80)}\`) with NO origin-proof verification within ±${WINDOW} lines — route it through isVerifiedLivenessRecord or verify with attest-signing.verifyRecord (or annotate a reviewed shape-only check with a \`liveness-verified:\` pragma)`,
          });
        }
      }
    }
  }
  // Belt: a stale exemption entry for a file that no longer exists is itself a drift → flag it.
  const staleExempt = Object.keys(CROSS_SESSION_EXEMPT).filter((f) => !fs.existsSync(path.join(root, f)));
  return { violations, exemptSeen, staleExempt };
}

module.exports = { scan, LEDGER_READ, OK_PREDICATE, VERIFIES, CROSS_SESSION_EXEMPT };

if (require.main === module) {
  const json = process.argv.includes("--json");
  let res;
  try {
    res = scan();
  } catch (e) {
    process.stderr.write(`liveness-read-choke-point: internal error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }
  const fail = res.violations.length > 0 || res.staleExempt.length > 0;
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else if (!fail) {
    process.stdout.write(
      `OK   [liveness-read-choke-point] every same-session dispatch-liveness reader verifies origin-proof signatures` +
        ` (${res.exemptSeen.length} cross-session reader(s) structurally exempt + tracked ED-232).\n`,
    );
  } else {
    if (res.violations.length) {
      process.stdout.write(`FAIL [liveness-read-choke-point] ${res.violations.length} same-session reader(s) trust unsigned ok:true records:\n`);
      for (const v of res.violations) process.stdout.write(`  ${v.file}${v.line ? ":" + v.line : ""}\n    ${v.what}\n`);
      process.stdout.write("  Route the ok:true read through scripts/dispatch/verified-liveness-read.js#isVerifiedLivenessRecord (same-session), or add a STRUCTURAL cross-session exemption with a reason.\n");
    }
    for (const f of res.staleExempt) process.stdout.write(`  STALE cross-session exemption for a non-existent file: ${f}\n`);
  }
  process.exit(fail ? 1 : 0);
}
