#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { PATHS, PROJECT } = require("../hooks/lib/paths");

const ROOT = PROJECT || path.resolve(__dirname, "..", "..");
const VERDICTS = Object.freeze(["DECIDE", "DIRECTIVE", "ESCALATE"]);

function judgmentStack() {
  return [
    { label: "PERSONA (beta.md)", file: path.join(ROOT, ".claude/agents/president/beta.md") },
    { label: "JUDGEMENT MODEL", file: path.join(ROOT, ".claude/agents/president/_system/beta/judgement-model.md") },
    { label: "DECISION POLICY", file: PATHS.decisionPolicy },
    { label: "CURRENT STAGE", file: PATHS.currentStage },
  ];
}

function readMaybe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function resolveOutPath(outFile, root) {
  return path.isAbsolute(outFile) ? outFile : path.join(root, outFile);
}

function precedentSlice(n) {
  const raw = readMaybe(PATHS.betaEvents);
  if (!raw) return "(no prior β events on record)";
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).join("\n") || "(no prior β events on record)";
}

function buildContext({ boundary, claims, precedentLines }) {
  if (!boundary || !boundary.trim() || !claims || !claims.trim()) {
    return { ok: false, reason: "the β-consult contract requires BOTH --boundary and --claims non-empty (an under-specified consult yields a canned verdict)" };
  }
  const parts = [];
  parts.push(
    `# β BOUNDARY CONSULT — assembled by beta-consult.js (CLI reach path for the GPT-β).\n` +
      `You are Alex β. Read your FULL judgment stack below, then render ONE verdict: DECIDE | DIRECTIVE | ESCALATE.\n` +
      `Advise HOW + name risks; do NOT descope a design-locked build. Emit the verdict token on its own line,\n` +
      `prefixed exactly "VERDICT: ", followed by your reasoning.\n`,
  );
  for (const s of judgmentStack()) {
    const body = readMaybe(s.file);
    if (body === null) {
      return { ok: false, reason: `judgment-stack file missing (fail-closed — β must not judge under-fed): ${s.file}` };
    }
    parts.push(`\n\n===== ${s.label} =====\n${body.trim()}`);
  }
  parts.push(`\n\n===== β PRECEDENT (recent events) =====\n${precedentSlice(precedentLines)}`);
  parts.push(
    `\n\n===== THE BOUNDARY PAYLOAD =====\n` +
      `boundary: ${boundary}\n\n` +
      `claims / code to verify:\n${claims}\n`,
  );
  return { ok: true, context: parts.join("") };
}

function resolveClaims(val) {
  if (val === "-") {
    try {
      return fs.readFileSync(0, "utf8");
    } catch {
      return "";
    }
  }
  if (val && fs.existsSync(val)) return readMaybe(val) || "";
  return val || "";
}

function parseVerdict(output) {
  if (!output) return null;
  const matches = [...String(output).matchAll(/^[ \t>*-]*VERDICT:[ \t]*(DECIDE|DIRECTIVE|ESCALATE)[ \t]*\r?$/gim)].map((m) => m[1].toUpperCase());
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : null;
}

function attestRanOnGpt(result) {
  const fellBack = !!(result && (result.fallback === true || result.quotaFallbackFrom));
  const observedCmd = (result && result.cmd) || "";
  const codexFired = /^\s*codex\s+exec(?:\s|$)/.test(observedCmd);
  const ranOnGpt = !!(result && result.ok === true && result.provider === "openai" && codexFired && !fellBack);
  return { ranOnGpt, fellBack, codexFired, observedCmd };
}

function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    return v === undefined || /^--/.test(v) ? null : v;
  };
  const boundary = get("--boundary");
  const claimsArg = get("--claims");
  const precedentLines = parseInt(get("--precedent-lines") || "20", 10) || 20;
  const json = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const outFile = get("--out");

  if (!boundary || !claimsArg) {
    process.stderr.write("usage: beta-consult.js --boundary <id> --claims <file|-|inline> [--precedent-lines N] [--out <f>] [--json] [--dry-run]\n");
    return 2;
  }

  const claims = resolveClaims(claimsArg);
  const built = buildContext({ boundary, claims, precedentLines });
  if (!built.ok) {
    process.stderr.write(`beta-consult: ${built.reason}\n`);
    return 2;
  }

  const dir = path.join(ROOT, "runtime", "beta-consult");
  fs.mkdirSync(dir, { recursive: true });
  const ctxFile = path.join(dir, `${boundary.replace(/[^A-Za-z0-9._-]/g, "_")}-${Date.now()}.md`);
  fs.writeFileSync(ctxFile, built.context);

  if (dryRun) {
    const has = (label) => built.context.includes(label);
    const shapeOk =
      has("PERSONA (beta.md)") && has("JUDGEMENT MODEL") && has("DECISION POLICY") &&
      has("CURRENT STAGE") && has("β PRECEDENT") && has(`boundary: ${boundary}`) && built.context.includes(claims.slice(0, 40));
    const out = { command: "beta-consult", dry_run: true, boundary, context_file: path.relative(ROOT, ctxFile), context_bytes: Buffer.byteLength(built.context), full_stack_assembled: shapeOk };
    process.stdout.write(JSON.stringify(out, null, json ? 2 : 0) + "\n");
    return shapeOk ? 0 : 1;
  }

  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/dispatch-agent.js"), "beta", ctxFile], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const stdout = r.stdout || "";
  let result = null;
  const last = stdout.trim().split("\n").filter(Boolean).pop();
  try {
    result = last ? JSON.parse(last) : null;
  } catch {
  }
  const agentOutput = (result && (result.output || (result.parsed && JSON.stringify(result.parsed)))) || stdout;
  const verdict = parseVerdict(agentOutput);
  const observedModel = (result && result.actualModel) || null;
  const requestedModel = (result && result.model) || null;
  const { ranOnGpt, fellBack, observedCmd } = attestRanOnGpt(result);
  const ok = !!(result && result.ok && verdict && ranOnGpt);
  const effectiveModel = ranOnGpt ? observedModel : null;

  const out = {
    command: "beta-consult",
    boundary,
    context_file: path.relative(ROOT, ctxFile),
    dispatched: !!result,
    ok,
    verdict,
    ran_on_gpt: ranOnGpt,
    observed_cmd: observedCmd || null,
    requested_model: requestedModel,
    fell_back: fellBack,
    effective_model: effectiveModel,
    provider: (result && result.provider) || null,
    dispatch_exit: typeof r.status === "number" ? r.status : null,
    error: ok
      ? undefined
      : !result
        ? "β dispatch produced no parseable result"
        : fellBack
          ? `β FELL BACK off the GPT lab (provider=${result.provider}) — not a valid gpt-5.6-sol attestation`
          : result.provider !== "openai"
            ? `β did not run on the GPT lab (provider=${result.provider})`
            : !verdict
              ? "no single 'VERDICT: DECIDE|DIRECTIVE|ESCALATE' line in β output"
              : (result && result.error) || "β consult not ok",
  };
  if (outFile) fs.writeFileSync(resolveOutPath(outFile, ROOT), JSON.stringify(out, null, 2));
  process.stdout.write(JSON.stringify(out, null, json ? 2 : 0) + "\n");
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { buildContext, parseVerdict, attestRanOnGpt, judgmentStack, resolveClaims, resolveOutPath, VERDICTS };
