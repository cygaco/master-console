#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../hooks/lib/skill-router-core.js");
const { shouldSkip, capDeclarativeMention } = require("../hooks/skill-router.js");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "voice-router-fixtures";
const SENTENCES_FILE = path.join(ROOT, "fixtures", "voice-router", "sentences.jsonl");

function resolveCatalogPath() {
  try {
    const paths = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
    return path.join(ROOT, paths.skillCatalog || ".claude/runtime/skill-catalog.json");
  } catch {
    return path.join(ROOT, ".claude", "runtime", "skill-catalog.json");
  }
}

function routeOne(say, routableEntries, confirmFlags) {
  const normalized = core.normalize(say);
  if (shouldSkip(say, normalized.contentTokens.length)) {
    return { slug: null, tier: null, tie: false, flags: [], args: "" };
  }
  const ranked = [];
  for (const entry of routableEntries) {
    const r = core.scoreEntry(normalized, entry);
    if (r.score > 0) ranked.push({ entry, score: r.score, exact: r.exact, complete: r.complete });
  }
  ranked.sort((a, b) => b.score - a.score);
  let decision = core.decide(ranked, normalized.contentTokens.length);
  decision = capDeclarativeMention(decision, say);
  if (!decision.tier) return { slug: null, tier: null, tie: false, flags: [], args: "" };

  const winner = ranked[0];
  const { entities } = core.parseEntities(normalized.tokens, say);
  const { flags, matchedSpoken, remainder } = core.parseFlags(normalized.tokens.join(" "), winner.entry);
  decision = core.applyFlagCeiling(decision, flags, confirmFlags, { entry: winner.entry, matchedSpoken });
  let args = "";
  if (winner.entry.args_mode === "free-text") args = remainder;
  else if (winner.entry.args_mode === "topic") {
    args = entities.epic_id || entities.ticket || entities.sprint_id || remainder;
  }
  return { slug: winner.entry.slug, score: winner.score, tier: decision.tier, tie: decision.tie, flags, args };
}

function evaluate({ rows, catalog }) {
  const findings = [];
  const skipped = [];
  const routable = (catalog.entries || []).filter((e) => e && e.alias_of == null && e.user_invocable === true);
  const slugSet = new Set(routable.map((e) => e.slug));
  const truncatedCatalog = Boolean(catalog.truncated);

  for (const row of rows) {
    const expect = row.expect || {};
    if (expect.skill && !slugSet.has(expect.skill)) {
      if (truncatedCatalog) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "truncated-catalog-skill-missing",
          message: `"${row.say}" expects skill "${expect.skill}" but the catalog truncated ${catalog.truncated} entries (CATALOG_MAX_ENTRIES) and it is absent from routing — a fresh install ships this gap, it is not a benign skip`,
        });
        continue;
      }
      skipped.push({ say: row.say, reason: `referenced skill "${expect.skill}" absent from the generated catalog` });
      continue;
    }
    const got = routeOne(row.say, routable, catalog.confirm_flags || []);

    if (expect.skill === null) {
      if (got.tier !== null) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "false-positive-hijack",
          message: `"${row.say}" expected NO suggestion but got ${got.slug} (${got.tier}, score ${got.score?.toFixed?.(2)})`,
        });
      }
      continue;
    }

    const anyOf = Array.isArray(expect.any_of) ? expect.any_of : null;
    if (anyOf) {
      const present = anyOf.filter((s) => slugSet.has(s));
      if (present.length !== anyOf.length) {
        const missingSkills = anyOf.filter((s) => !slugSet.has(s));
        if (truncatedCatalog) {
          findings.push({
            severity: "high",
            check: NAME,
            kind: "truncated-catalog-skill-missing",
            message: `"${row.say}" expects one of [${anyOf.join(", ")}] but [${missingSkills.join(", ")}] absent — catalog truncated ${catalog.truncated} entries (CATALOG_MAX_ENTRIES)`,
          });
          continue;
        }
        skipped.push({ say: row.say, reason: `any_of skill(s) absent from the generated catalog: ${missingSkills.join(", ")}` });
        continue;
      }
      if (!anyOf.includes(got.slug)) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "wrong-skill",
          message: `"${row.say}" expected one of [${anyOf.join(", ")}] but got ${got.slug || "(nothing)"}`,
        });
        continue;
      }
    } else if (got.slug !== expect.skill) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "wrong-skill",
        message: `"${row.say}" expected ${expect.skill} but got ${got.slug || "(nothing)"}`,
      });
      continue;
    }
    const label = anyOf ? `one of [${anyOf.join(", ")}]` : expect.skill;
    if (expect.tier && got.tier !== expect.tier) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "wrong-tier",
        message: `"${row.say}" (${label}) expected tier ${expect.tier} but got ${got.tier}`,
      });
    }
    if (typeof expect.tie === "boolean" && got.tie !== expect.tie) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "wrong-tie",
        message: `"${row.say}" (${label}) expected tie=${expect.tie} but got tie=${got.tie}`,
      });
    }
    if (Array.isArray(expect.flags)) {
      const missing = expect.flags.filter((f) => !got.flags.includes(f));
      if (missing.length) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "missing-flag",
          message: `"${row.say}" (${expect.skill}) expected flags [${expect.flags.join(", ")}] but got [${got.flags.join(", ")}] — missing [${missing.join(", ")}]`,
        });
      }
    }
    if (typeof expect.args === "string" && got.args !== expect.args) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "wrong-args",
        message: `"${row.say}" (${expect.skill}) expected args "${expect.args}" but got "${got.args}"`,
      });
    }
  }
  return { findings, skipped };
}

function loadRows(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function main() {
  const asJson = process.argv.includes("--json");
  let catalog, rows;
  try {
    const catalogPath = resolveCatalogPath();
    if (!fs.existsSync(catalogPath)) throw new Error(`catalog missing: ${catalogPath} (run node scripts/generate-skill-catalog.js)`);
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (catalog.schema !== "mc/skill-catalog/v2" || !Array.isArray(catalog.entries)) {
      throw new Error(`catalog schema mismatch or malformed: ${catalog.schema}`);
    }
    rows = loadRows(SENTENCES_FILE);
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const { findings, skipped } = evaluate({ rows, catalog });

  if (asJson) {
    process.stdout.write(
      JSON.stringify({ ok: findings.length === 0, check: NAME, counts: { rows: rows.length, skipped: skipped.length }, findings, skipped }, null, 2) + "\n",
    );
  } else {
    for (const f of findings) process.stdout.write(`FAIL  [${f.kind}] ${f.message}\n`);
    for (const s of skipped) process.stdout.write(`SKIP  ${s.say} — ${s.reason}\n`);
    process.stdout.write(`# ${NAME}: ${rows.length} rows, ${skipped.length} skipped, ${findings.length} finding(s)\n`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate, routeOne, loadRows };
