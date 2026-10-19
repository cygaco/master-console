"use strict";
/**
 * provider-invocation-parity.js — asserts each DOC's per-provider CLI invocation
 * string matches the SHAPE the CODE actually builds. The single source of truth is
 * `buildProviderArgv` (scripts/hooks/lib/providers.js); the docs must not drift from it.
 *
 * Catches the doc↔code drift class:
 *   - F1: a doc claiming the WRONG prompt-delivery — "stdin" where the code puts the prompt on a `-p`
 *     argv value (agy), or vice-versa; OR an invocation MISSING the delivery marker the code requires.
 *   - F2: a doc carrying a MANDATORY flag the real argv omits (e.g. `--ask-for-approval` on `codex exec`).
 *
 * DERIVE-FROM-CODE (do NOT hardcode the expected shape; hardcoding just moves the
 * drift): the tool-id, usesStdin, the prompt-delivery FLAG (the argv token carrying the prompt), the
 * stdin `-` positional, and the long-flag set are ALL read from `buildProviderArgv`'s output. The check
 * is REQUIRE-PRESENT, not merely reject-the-opposite: a doc that OMITS the code's delivery marker (an
 * incomplete invocation) is a finding, and a doc showing BOTH markers (contradictory) is a finding.
 *
 * Invocations are read ONLY from a doc's own CODE SPAN — a FENCED code line, or the backticked
 * `` `<cli> …` `` span inside a TABLE cell — never the surrounding prose. So a sentence that merely
 * MENTIONS a cli or flag cannot self-trip, and
 * trailing parenthetical prose after a code span cannot mask a marker.
 *
 * REPORT-ONLY by default; `--enforce` exits 1 on any parity finding. Wired /scan:full.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const PROVIDERS = [
  { name: "openai", model: "gpt-6.1-sol" },
  { name: "antigravity", model: "gemini-3.1-pro-high" },
];
const DOCS = ["AGENTS.md", "CODEX.md", "ANTIGRAVITY.md"];

const PROMPT_SENTINEL = "__PROMPT_SENTINEL__";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codeShape(providerName, model) {
  let built;
  try {
    const { buildProviderArgv } = require(path.join(ROOT, "scripts", "hooks", "lib", "providers"));
    built = buildProviderArgv(providerName, model, ["-c", "model_reasoning_effort=high"], { prompt: PROMPT_SENTINEL });
  } catch (e) {
    return { error: `buildProviderArgv threw: ${e.message}` };
  }
  if (!built || built.fail) return { error: (built && built.error) || "buildProviderArgv failed" };
  const argv = Array.isArray(built.argv) ? built.argv : [];
  const longFlags = new Set(argv.filter((t) => typeof t === "string" && /^--[a-z]/i.test(t)));
  const promptIdx = argv.indexOf(PROMPT_SENTINEL);
  const promptFlag = !built.usesStdin && promptIdx > 0 ? argv[promptIdx - 1] : null;
  const hasStdinDash = argv.some((t) => t === "-");
  return { toolId: built.toolId, usesStdin: !!built.usesStdin, promptFlag, hasStdinDash, longFlags };
}

function extractInvocations(text, cli) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/);
  const startsCli = new RegExp(`^${escapeRegex(cli)}\\s+\\S`);
  const spanRe = new RegExp("`\\s*(" + escapeRegex(cli) + "\\s[^`]*)`", "g");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const c = raw.trim();
      if (startsCli.test(c)) out.push({ line: i + 1, cmd: c });
      continue;
    }
    if (/^\s*\|.*\|/.test(raw)) {
      let m;
      spanRe.lastIndex = 0;
      while ((m = spanRe.exec(raw)) !== null) {
        const c = m[1].trim();
        if (startsCli.test(c)) out.push({ line: i + 1, cmd: c });
      }
    }
  }
  return out;
}

function hasBareStdinDash(cmd) {
  return /(^|\s)-(\s|$)/.test(cmd);
}
function hasFlag(cmd, flag) {
  return new RegExp(`(^|\\s)${escapeRegex(flag)}(\\s|$)`).test(cmd);
}
function docMandatoryLongFlags(cmd) {
  const withoutOptional = cmd.replace(/\[[^\]]*\]/g, " ");
  const flags = new Set();
  const re = /(?:^|\s)(--[a-z][a-z-]*)/gi;
  let m;
  while ((m = re.exec(withoutOptional)) !== null) flags.add(m[1]);
  return flags;
}

function loadDocs() {
  return DOCS.map((d) => {
    try {
      return { name: d, text: fs.readFileSync(path.join(ROOT, d), "utf8") };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function computeFindings(opts = {}) {
  const docSources = opts.docs || loadDocs();
  const findings = [];
  const checked = [];
  const shapes = PROVIDERS.map(({ name, model }) => ({ name, shape: codeShape(name, model) }));
  const allPromptFlags = shapes.map((s) => s.shape && s.shape.promptFlag).filter(Boolean);
  for (const { name, shape } of shapes) {
    if (shape.error) {
      findings.push({ provider: name, doc: "(code)", code: "code_shape_unresolvable", detail: shape.error });
      continue;
    }
    const cli = shape.toolId;
    for (const { name: doc, text } of docSources) {
      for (const { line, cmd } of extractInvocations(text, cli)) {
        checked.push({ provider: name, doc, line, cmd });
        const saysStdin = hasBareStdinDash(cmd);
        const saysPromptFlag = shape.promptFlag ? hasFlag(cmd, shape.promptFlag) : false;
        const saysAnyArgvFlag = allPromptFlags.some((f) => hasFlag(cmd, f));
        if (shape.usesStdin) {
          if (!saysStdin) {
            findings.push({ provider: name, doc, line, code: "prompt_delivery_mismatch", detail: `code delivers the prompt on STDIN (a trailing '-' positional) but the doc invocation has no stdin '-': ${cmd}` });
          } else if (saysAnyArgvFlag) {
            findings.push({ provider: name, doc, line, code: "prompt_delivery_mismatch", detail: `code delivers the prompt on STDIN but the doc ALSO shows an argv prompt-flag (${allPromptFlags.filter((f) => hasFlag(cmd, f)).join(",")}) — contradictory: ${cmd}` });
          }
        } else {
          if (!saysPromptFlag) {
            findings.push({ provider: name, doc, line, code: "prompt_delivery_mismatch", detail: `code delivers the prompt on the '${shape.promptFlag}' argv value but the doc invocation lacks '${shape.promptFlag}': ${cmd}` });
          } else if (saysStdin) {
            findings.push({ provider: name, doc, line, code: "prompt_delivery_mismatch", detail: `code delivers the prompt on '${shape.promptFlag}' argv but the doc ALSO shows a bare stdin '-' (contradictory): ${cmd}` });
          }
        }
        for (const f of docMandatoryLongFlags(cmd)) {
          if (!shape.longFlags.has(f)) {
            findings.push({ provider: name, doc, line, code: "stale_flag", detail: `doc invocation carries '${f}' which is NOT in the real ${cli} argv (${[...shape.longFlags].join(" ") || "no long flags"}): ${cmd}` });
          }
        }
      }
    }
  }
  return { ok: findings.length === 0, findings, checkedCount: checked.length, checked };
}

function main(argv) {
  const enforce = argv.includes("--enforce");
  const jsonOut = argv.includes("--json");
  const res = computeFindings();
  if (jsonOut) {
    console.log(JSON.stringify({ ok: res.ok, enforce, checked: res.checkedCount, findings: res.findings }));
  } else if (res.ok) {
    console.log(`OK   [provider-invocation-parity] ${res.checkedCount} doc invocation(s) match buildProviderArgv (prompt-delivery + flag set, derived-from-code)`);
  } else {
    process.stderr.write(`FAIL [provider-invocation-parity] ${res.findings.length} finding(s) (${res.checkedCount} doc invocation(s) checked):\n\n`);
    for (const f of res.findings) process.stderr.write(`  ${f.doc}:${f.line || "-"} [${f.code}] ${f.provider}: ${f.detail}\n`);
  }
  process.exit(enforce && !res.ok ? 1 : 0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  computeFindings,
  loadDocs,
  codeShape,
  extractInvocations,
  hasBareStdinDash,
  hasFlag,
  docMandatoryLongFlags,
  PROVIDERS,
  DOCS,
};
