#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadPaths() {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8")
  );
}

function loadPackFromId(id, evalPacksDir) {
  return JSON.parse(
    fs.readFileSync(path.join(evalPacksDir, id + ".json"), "utf8")
  );
}

function findPackByTargetSlug(slug, evalPacksDir) {
  let files;
  try {
    files = fs.readdirSync(evalPacksDir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const pack = JSON.parse(
        fs.readFileSync(path.join(evalPacksDir, f), "utf8")
      );
      if (
        pack.target &&
        (pack.target === slug ||
          pack.target.includes("/" + slug) ||
          pack.target.endsWith(slug + ".md"))
      ) {
        return pack;
      }
    } catch {
    }
  }
  return null;
}

function runCheck(check, text) {
  const { kind, value } = check;

  switch (kind) {
    case "must_contain_all":
      if (!Array.isArray(value)) return false;
      return value.every((s) => text.includes(s));

    case "must_contain_any":
      if (!Array.isArray(value)) return false;
      return value.some((s) => text.includes(s));

    case "must_not_contain":
      if (!Array.isArray(value)) return false;
      return value.every((s) => !text.includes(s));

    case "regex_match":
      return new RegExp(value, "m").test(text);

    case "min_count": {
      const { pattern, n } = value;
      const re = new RegExp(pattern, "g");
      const count = (text.match(re) || []).length;
      return count >= n;
    }

    case "max_count": {
      const { pattern, n } = value;
      const re = new RegExp(pattern, "g");
      const count = (text.match(re) || []).length;
      return count <= n;
    }

    default:
      throw new Error(`unknown check kind: ${kind}`);
  }
}

function scoreDimension(dim, text, consultResult) {
  if (dim.mechanical) {
    const checks = dim.checks || [];
    if (checks.length === 0) return 1.0;
    const passed = checks.filter((c) => runCheck(c, text)).length;
    return passed / checks.length;
  }

  if (!consultResult) return null;
  return consultResult.ok ? 1.0 : 0.0;
}

function generateId(target) {
  const slug = path.basename(target, path.extname(target)).replace(/[^a-z0-9-]/gi, "-");
  return `etc-eval-${slug}-${Date.now()}`;
}

function evaluate({ target, pack: packArg, consult: consultFn } = {}) {
  const PATHS = loadPaths();
  const evalPacksDir = path.join(REPO_ROOT, PATHS.etcEvalPacks);
  const decisionsDir = path.join(REPO_ROOT, PATHS.etcDecisions);

  const targetPath = path.isAbsolute(target)
    ? target
    : path.join(REPO_ROOT, target);
  const targetText = fs.readFileSync(targetPath, "utf8");

  let pack;
  if (packArg && typeof packArg === "object") {
    pack = packArg;
  } else if (packArg && typeof packArg === "string") {
    if (packArg.endsWith(".json") || packArg.includes("/") || packArg.includes("\\")) {
      pack = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, packArg), "utf8"));
    } else {
      pack = loadPackFromId(packArg, evalPacksDir);
    }
  } else {
    const slug = path.basename(target, path.extname(target));
    pack = findPackByTargetSlug(slug, evalPacksDir);
    if (!pack) throw new Error(`no eval-pack found for target slug: ${slug}`);
  }

  let consultCalled = false;
  let consultResult = null;
  let anyNullJudgment = false;

  const scored = [];
  let mechWeightSum = 0;
  let mechScoreSum = 0;
  let judgWeightSum = 0;
  let judgScoreSum = 0;

  for (const dim of pack.rubric) {
    if (!dim.mechanical && !consultCalled && consultFn) {
      consultCalled = true;
      const promptText = [
        "Evaluate this skill artifact against the following criterion:",
        `Criterion: ${dim.criteria || "general quality"}`,
        "",
        "--- Artifact ---",
        targetText,
        "--- End Artifact ---",
        "",
        "Respond with a brief assessment of whether this artifact meets the criterion.",
      ].join("\n");
      try {
        consultResult = consultFn({ promptText });
      } catch (e) {
        consultResult = { ok: false, critique: "", flagged: [] };
      }
    }

    const score = scoreDimension(dim, targetText, consultResult);

    if (score === null) anyNullJudgment = true;

    scored.push({
      dimension: dim.dimension,
      score,
      weight: dim.weight,
      mechanical: dim.mechanical,
    });

    if (dim.mechanical) {
      mechWeightSum += dim.weight;
      mechScoreSum += (score || 0) * dim.weight;
    } else {
      if (score !== null) {
        judgWeightSum += dim.weight;
        judgScoreSum += score * dim.weight;
      }
    }
  }

  const totalWeightNonNull = scored.reduce(
    (s, d) => (d.score !== null ? s + d.weight : s),
    0
  );
  const confidence =
    totalWeightNonNull > 0
      ? scored.reduce((s, d) => (d.score !== null ? s + d.weight * d.score : s), 0) /
        totalWeightNonNull
      : 0;

  let decision;
  if (confidence >= 0.7) decision = "accept";
  else if (confidence >= 0.4) decision = "revise";
  else decision = "reject";

  const mechAvg = mechWeightSum > 0 ? mechScoreSum / mechWeightSum : null;
  const judgAvg = judgWeightSum > 0 ? judgScoreSum / judgWeightSum : null;
  const verdictDisagree =
    mechAvg !== null &&
    judgAvg !== null &&
    Math.abs(mechAvg - judgAvg) > 0.3;
  const arbitrationNeeded =
    confidence < 0.6 || anyNullJudgment || verdictDisagree;

  const id = generateId(target);
  const rationale =
    scored
      .map(
        (d) =>
          `${d.dimension}: ${
            d.score === null ? "null (judgment, no consult)" : d.score.toFixed(3)
          } (weight ${d.weight})`
      )
      .join("; ") +
    ` → confidence=${confidence.toFixed(3)}, arbitration_needed=${arbitrationNeeded}`;

  const record = {
    type: "decision_record",
    id,
    decision,
    owner: "etc_eval_enforcer",
    rationale,
    precedence_basis: "etc-eval-rubric-v0.1",
    confidence,
    arbitration_needed: arbitrationNeeded,
  };

  fs.mkdirSync(decisionsDir, { recursive: true });
  const recordPath = path.join(decisionsDir, `${id}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");

  const validResult = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "scripts", "contracts", "validate-artifact.js"),
      recordPath,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }
  );
  if (validResult.status !== 0) {
    const msg =
      (validResult.stderr || validResult.stdout || "").trim() ||
      "validation failed";
    throw new Error(
      `emitted decision_record failed validation (build defect): ${msg}`
    );
  }

  return { decision, confidence, arbitration_needed: arbitrationNeeded, record_path: recordPath };
}

module.exports = { evaluate };

if (require.main === module) {
  const argv = process.argv.slice(2);
  let target = null;
  let packId = null;
  let useConsult = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pack" && argv[i + 1]) {
      packId = argv[++i];
    } else if (argv[i] === "--consult") {
      useConsult = true;
    } else if (!argv[i].startsWith("--")) {
      target = argv[i];
    }
  }

  if (!target) {
    process.stderr.write("usage: eval.js <target> [--pack <id>] [--consult]\n");
    process.exit(2);
  }

  const consultFn = useConsult ? require("./consult").consult : null;

  try {
    const result = evaluate({ target, pack: packId, consult: consultFn });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  } catch (e) {
    process.stderr.write(`eval error: ${e.message}\n`);
    process.exit(2);
  }
}
