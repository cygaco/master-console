#!/usr/bin/env node

"use strict";

let normalizeRole = (r) => r;
try {
  ({ normalizeRole } = require("./lib/role-aliases"));
} catch {
}

function deriveBuildChainSet() {
  const set = new Set([
    "frontend-builder", "backend-builder", "security-builder",
    "frontend-fixer", "backend-fixer", "security-fixer",
    "frontend-reviewer", "backend-reviewer", "qa-reviewer", "security-reviewer",
    "design-quality", "visual-review",
    "builder", "fixer",
  ]);
  try {
    const { gammaOnlyTypes } = require("../dispatch/org-roles");
    const derived = gammaOnlyTypes();
    if (derived instanceof Set) for (const r of derived) set.add(r);
  } catch {
  }
  set.delete("test-runner");
  return set;
}

const BUILD_CHAIN = deriveBuildChainSet();

function isBuildChain(role) {
  if (!role) return false;
  const canon = normalizeRole(String(role).toLowerCase());
  return BUILD_CHAIN.has(canon) || BUILD_CHAIN.has(String(role).toLowerCase());
}

function resolveRole(event) {
  const explicit = event.tool_input?.subagent_type;
  if (explicit) return normalizeRole(String(explicit).toLowerCase());
  const prompt = (event.tool_input?.prompt || "").slice(0, 500);
  if (/^feature:\s*\S+/im.test(prompt)) return "builder";
  if (/\b(security-reviewer|redteam)\b/i.test(prompt)) return "security-reviewer";
  if (/\b(qa-reviewer|compliance|req-reviewer|\bqa\b)\b/i.test(prompt)) return "qa-reviewer";
  if (/\b(frontend-reviewer)\b/i.test(prompt)) return "frontend-reviewer";
  if (/\b(backend-reviewer)\b/i.test(prompt)) return "backend-reviewer";
  if (/\b(reviewer|evaluator)\b/i.test(prompt)) return "reviewer";
  return "unknown";
}

function hasScopeContract(prompt) {
  return /scopeContract|allowedFiles|forbiddenFiles|File Scope|In-scope files/i.test(prompt || "");
}

function extractScopeContract(prompt) {
  const p = prompt || "";
  const m = /scopeContract[\s:=]*(\{)/i.exec(p);
  if (!m) return { found: false };

  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < p.length; i++) {
    const ch = p[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const json = p.slice(start, i + 1);
        try {
          return { found: true, parsed: JSON.parse(json) };
        } catch {
          return { found: true, parsed: null };
        }
      }
    }
  }
  return { found: true, parsed: null };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Agent" || event.tool_response !== undefined) process.exit(0);
    const role = resolveRole(event);
    if (!isBuildChain(role)) process.exit(0);
    const prompt = event.tool_input?.prompt || "";
    if (!hasScopeContract(prompt)) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: "scope-contract-guard: build-chain dispatch must include scopeContract or explicit allowedFiles/forbiddenFiles.",
        }),
      );
      process.exit(2);
    }

    const sc = extractScopeContract(prompt);
    if (sc.found) {
      if (sc.parsed === null) {
        console.log(
          JSON.stringify({
            decision: "block",
            reason: "scope-contract-guard: scopeContract present but unparseable — refusing (declare a parseable allowedFiles/forbiddenFiles).",
          }),
        );
        process.exit(2);
      }
      const allowedFiles = sc.parsed.allowedFiles;
      const forbiddenFiles = sc.parsed.forbiddenFiles;
      const hasEmptyAllowed = Array.isArray(allowedFiles) && allowedFiles.length === 0;
      const hasForbidden = Array.isArray(forbiddenFiles) && forbiddenFiles.length > 0;
      if (hasEmptyAllowed && !hasForbidden) {
        console.log(
          JSON.stringify({
            decision: "block",
            reason: "scope-contract-guard: scopeContract has an EMPTY allowedFiles:[] — this blocks ALL builder writes. Declare the file(s) you intend to write in allowedFiles, or use forbiddenFiles to blocklist instead.",
          }),
        );
        process.exit(2);
      }
    }
  } catch {
    process.exit(0);
  }
  process.exit(0);
});

module.exports = { hasScopeContract, extractScopeContract, resolveRole, isBuildChain, BUILD_CHAIN };
