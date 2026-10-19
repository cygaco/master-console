"use strict";

const fs = require("fs");
const path = require("path");

const HEADERS = {
  RUN_THIS: { canonical: "▶️ RUN THIS", labelUC: "RUN THIS", baseGlyph: "▶", vs16Glyph: "▶️" },
  DECISION_NEEDED: { canonical: "⚠️ DECISION NEEDED", labelUC: "DECISION NEEDED", baseGlyph: "⚠", vs16Glyph: "⚠️" },
  BLOCKED: { canonical: "⛔ BLOCKED", labelUC: "BLOCKED", baseGlyph: "⛔", vs16Glyph: "⛔" },
  FYI: { canonical: "📌 FYI", labelUC: "FYI", baseGlyph: "📌", vs16Glyph: "📌" },
};

const LOOSE_HEADER_RE =
  /^(▶️|▶|⚠️|⚠|⛔|📌)(\s*)(run this|decision needed|blocked|fyi)\b(.*)$/i;

function headerTypeForLabel(labelLower) {
  if (labelLower === "run this") return "RUN_THIS";
  if (labelLower === "decision needed") return "DECISION_NEEDED";
  if (labelLower === "blocked") return "BLOCKED";
  if (labelLower === "fyi") return "FYI";
  return null;
}

function matchHeader(line) {
  const m = LOOSE_HEADER_RE.exec(line.trim());
  if (!m) return null;
  const [, glyph, spacing, label, rest] = m;
  const type = headerTypeForLabel(label.toLowerCase());
  if (!type) return null;
  const def = HEADERS[type];
  const glyphOk = glyph === def.vs16Glyph;
  const spacingOk = spacing === " ";
  const labelOk = label === def.labelUC;
  const isDetailOverrideMarker =
    type === "FYI" && /^\s*\(detail requested\)\s*$/i.test(rest || "");
  const exact = glyphOk && spacingOk && labelOk;
  return { type, exact, isDetailOverrideMarker };
}

const CODES = Object.freeze({
  CMD_OUTSIDE_RUN: "CMD-OUTSIDE-RUN",
  QUESTION_OUTSIDE_DECISION: "QUESTION-OUTSIDE-DECISION",
  MULTI_COMMAND: "MULTI-COMMAND",
  HEADER_GLYPH: "HEADER-GLYPH",
  PREAMBLE_TOO_LONG: "PREAMBLE-TOO-LONG",
  REGISTER_OVERRUN: "REGISTER-OVERRUN",
  RAW_IDENTIFIER: "RAW-IDENTIFIER",
});

const STRUCTURAL_CODES = new Set([
  CODES.CMD_OUTSIDE_RUN,
  CODES.QUESTION_OUTSIDE_DECISION,
  CODES.MULTI_COMMAND,
  CODES.HEADER_GLYPH,
]);
const REGISTER_CODES = new Set([
  CODES.PREAMBLE_TOO_LONG,
  CODES.REGISTER_OVERRUN,
  CODES.RAW_IDENTIFIER,
]);

function classOf(code) {
  return STRUCTURAL_CODES.has(code) ? "structural" : "register";
}

const DEFAULTS = Object.freeze({
  strictness: "advisory",
  maxLinesBeforeHeader: 5,
  allowIdentifiers: false,
  extraCommandPrefixes: [],
  detailRequested: false,
});

const EXPLICIT_COMMAND_MARKER_RE = /^(!|\$ )/;
const BARE_COMMAND_TOOL_RE =
  /^(git|node|npm|npx|pnpm|powershell|pwsh|gh|curl|python3?|bash|docker|terraform|kubectl)\s+[\w./-]+(\s|$)/i;
const SENTENCE_PUNCTUATION_RE = /[.,?](?:\s|$)/;
const MAX_BARE_COMMAND_TOKENS = 12;
const COMMAND_TOKEN_SHAPE_RE = /^(-|--|\.?\/|[\w./-]+\.(js|ps1|sh|json|md)$|[a-z][\w-]*$)/i;
const ENGLISH_STOPWORD_RE =
  /^(is|are|was|were|be|has|have|will|can|should|must|does|did|the|a|an|and|or|to|of|in|on|for|with|that|this|it|not|no|yes)$/i;
const PROSE_TAIL_RE =
  /^(runs?|running|shows?|showing|lists?|prints?|returns?|passes|passed|fails|failed|works?|looks?|reports?|says?|outputs?|exits?|takes?|gives?|found|finds?|clean|cleanly|green|red|fine|ok|okay|still|now|already|just|only|also|two|three|four|five|several|many|some|none|all|every|open|closed|done|finished|complete|completed|successfully|correctly|here|there|today|again|because|since|when|while|but|if|so|then|than|as|at|by|from|into|its|their|your|our|my)$/i;
const KNOWN_SUBCOMMANDS = {
  git: "status push pull commit add log diff checkout branch merge rebase fetch clone reset stash tag remote show switch restore cherry-pick init worktree",
  npm: "test run install i ci start build publish pack init exec audit update link version ls outdated",
  pnpm: "test run install i add start build publish pack init exec audit update link ls outdated",
  gh: "pr issue repo run release workflow api auth gist browse status",
  docker: "run build ps images pull push compose exec logs stop start rm rmi",
  terraform: "init plan apply destroy validate fmt output",
  kubectl: "get apply delete describe logs exec rollout",
};
const KNOWN_SUBCOMMAND_SETS = Object.fromEntries(
  Object.entries(KNOWN_SUBCOMMANDS).map(([k, v]) => [k, new Set(v.split(" "))]),
);
const OPERATOR_TOKEN_RE = /^(\||\|\||&&|&|;|>|>>|<|2>&1)$/;

function cleanToken(tok) {
  return tok.replace(/[.,!?;:'")\]]+$/, "");
}

function hasCommandSignalToken(tok) {
  if (OPERATOR_TOKEN_RE.test(tok)) return true;
  if (/^--?[A-Za-z]/.test(tok)) return true;
  if (/[\/]/.test(tok)) return true;
  return /^[\w.-]+\.(js|ps1|sh|json|md|py|ts|yml|yaml)$/i.test(cleanToken(tok));
}

const COMMAND_FENCE_LANGS = new Set([
  "bash", "sh", "zsh", "shell", "pwsh", "powershell", "cmd", "bat", "ps1",
]);
const FENCE_EXECUTABLES = new Set([
  "git", "node", "npm", "npx", "pnpm", "yarn", "powershell", "pwsh", "gh", "curl", "wget",
  "python", "python3", "pip", "bash", "sh", "zsh", "docker", "terraform", "kubectl", "make",
  "cargo", "go", "ssh", "scp", "sudo", "rm", "mv", "cp", "mkdir", "chmod", "cd", "ls", "cat",
  "echo", "export", "set", "cmd",
]);
const DETAIL_OVERRIDE_RE =
  /\b(detail|details|explain|verbose|full report|walk me through|show me everything)\b/i;
const RAW_ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bED-\d+\b|\bRI-\d+\b|\bSP-\d{8}-\d+\b|\bS-[A-Z]+-\d+\b|\bL-\d{4}-|\bmsg_id\b|\bPC-\d+\b|\bR-\d+\b|\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const QUESTION_END_RE = /\?\s*[*_`"')\]]*$/;
const QUOTED_TRAILING_SPAN_RE = /["“]([^"”]*)["”]\s*[*_`')\]]*$/;

function isQuotedQuestionEcho(trimmed) {
  const m = QUOTED_TRAILING_SPAN_RE.exec(trimmed);
  return !!m && m[1].includes("?");
}

function isBareCommandLine(trimmed, extraPrefixes) {
  if (EXPLICIT_COMMAND_MARKER_RE.test(trimmed)) return true;
  if (extraPrefixes.some((p) => trimmed.startsWith(p))) return true;
  if (!BARE_COMMAND_TOOL_RE.test(trimmed)) return false;
  if (SENTENCE_PUNCTUATION_RE.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > MAX_BARE_COMMAND_TOKENS) return false;
  if (tokens.length < 2) return false;
  const tool = tokens[0].toLowerCase();
  const token2 = cleanToken(tokens[1]);
  if (ENGLISH_STOPWORD_RE.test(token2)) return false;
  if (!COMMAND_TOKEN_SHAPE_RE.test(token2)) return false;
  for (let i = 2; i < tokens.length; i++) {
    const t = cleanToken(tokens[i]);
    if (ENGLISH_STOPWORD_RE.test(t) || PROSE_TAIL_RE.test(t)) return false;
  }
  if (tokens.slice(1).some(hasCommandSignalToken)) return true;
  if (tool === "npx") return true;
  const subs = KNOWN_SUBCOMMAND_SETS[tool];
  return !!subs && subs.has(token2.toLowerCase());
}

function isFenceCommandLine(trimmed, extraPrefixes) {
  if (!trimmed) return false;
  if (EXPLICIT_COMMAND_MARKER_RE.test(trimmed)) return true;
  if (extraPrefixes.some((p) => trimmed.startsWith(p))) return true;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 2 && FENCE_EXECUTABLES.has(tokens[0].toLowerCase())) return true;
  return isBareCommandLine(trimmed, extraPrefixes);
}

function isCommandFence(lang, bodyLines, extraPrefixes) {
  if (COMMAND_FENCE_LANGS.has(lang)) return true;
  if (lang !== "") return false;
  return bodyLines.some((l) => isFenceCommandLine(l.trim(), extraPrefixes));
}

function scanText(text, options) {
  const opts = { ...DEFAULTS, ...options };
  const extraPrefixes = Array.isArray(opts.extraCommandPrefixes) ? opts.extraCommandPrefixes : [];

  const lines = String(text == null ? "" : text).split(/\r\n|\r|\n/);
  const findings = [];

  let section = null;
  let firstHeaderLineIdx = -1;
  let textRequestsDetailOverride = false;

  let inFence = false;
  let fenceLang = "";
  let fenceOpenSection = null;
  let fenceOpenLineIdx = -1;
  let fenceBody = [];
  let fenceCountInRunThis = 0;
  let runThisSpanFirstLineIdx = -1;

  function closeRunThisSpanIfAny() {
    if (runThisSpanFirstLineIdx >= 0 && fenceCountInRunThis > 1) {
      findings.push({
        code: CODES.MULTI_COMMAND,
        line: runThisSpanFirstLineIdx + 1,
        excerpt: lines[runThisSpanFirstLineIdx].trim().slice(0, 100),
      });
    }
    runThisSpanFirstLineIdx = -1;
    fenceCountInRunThis = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const fenceMatch = /^```\s*([A-Za-z0-9_-]*)/.exec(trimmed);

    if (fenceMatch && !inFence) {
      inFence = true;
      fenceLang = fenceMatch[1].toLowerCase();
      fenceOpenSection = section;
      fenceOpenLineIdx = i;
      fenceBody = [];
      continue;
    }
    if (fenceMatch && inFence) {
      inFence = false;
      const isCmdFence = isCommandFence(fenceLang, fenceBody, extraPrefixes);
      if (isCmdFence && fenceOpenSection === "RUN_THIS") fenceCountInRunThis++;
      if (isCmdFence && fenceOpenSection !== "RUN_THIS") {
        findings.push({
          code: CODES.CMD_OUTSIDE_RUN,
          line: fenceOpenLineIdx + 1,
          excerpt: (lines[fenceOpenLineIdx + 1] || "").trim().slice(0, 100),
        });
      }
      fenceLang = "";
      continue;
    }
    if (inFence) {
      fenceBody.push(raw);
      continue;
    }

    if (trimmed === "") continue;

    if (/^#{1,6}\s/.test(trimmed)) {
      closeRunThisSpanIfAny(i);
      section = null;
      continue;
    }

    const hm = matchHeader(trimmed);
    if (hm) {
      closeRunThisSpanIfAny(i);
      if (firstHeaderLineIdx === -1) firstHeaderLineIdx = i;
      if (!hm.exact) {
        findings.push({ code: CODES.HEADER_GLYPH, line: i + 1, excerpt: trimmed.slice(0, 100) });
      }
      if (hm.isDetailOverrideMarker) textRequestsDetailOverride = true;
      section = hm.type;
      if (section === "RUN_THIS") runThisSpanFirstLineIdx = i;
      continue;
    }

    const isBlockquote = trimmed.startsWith(">");
    const commandCandidate = isBlockquote ? trimmed.replace(/^>+\s*/, "") : trimmed;

    if (section !== "RUN_THIS") {
      if (isBareCommandLine(commandCandidate, extraPrefixes)) {
        findings.push({ code: CODES.CMD_OUTSIDE_RUN, line: i + 1, excerpt: trimmed.slice(0, 100) });
      }
    }

    if (
      section !== "DECISION_NEEDED" &&
      !isBlockquote &&
      QUESTION_END_RE.test(trimmed) &&
      !isQuotedQuestionEcho(trimmed)
    ) {
      findings.push({ code: CODES.QUESTION_OUTSIDE_DECISION, line: i + 1, excerpt: trimmed.slice(0, 100) });
    }
  }
  closeRunThisSpanIfAny(lines.length);

  const detailRequested = !!opts.detailRequested || textRequestsDetailOverride;

  if (!opts.allowIdentifiers && !detailRequested) {
    let sec2 = null;
    let inFence2 = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const fenceMatch = /^```/.test(trimmed);
      if (fenceMatch) {
        inFence2 = !inFence2;
        continue;
      }
      if (inFence2 || trimmed === "") continue;
      if (/^#{1,6}\s/.test(trimmed)) {
        sec2 = null;
        continue;
      }
      const hm = matchHeader(trimmed);
      if (hm) {
        sec2 = hm.type;
        continue;
      }
      if (sec2 === "RUN_THIS") continue;
      for (const m of trimmed.matchAll(RAW_ID_RE)) {
        findings.push({ code: CODES.RAW_IDENTIFIER, line: i + 1, excerpt: m[0] });
      }
    }
  }

  if (!detailRequested) {
    if (firstHeaderLineIdx >= 0) {
      const preambleNonBlank = lines
        .slice(0, firstHeaderLineIdx)
        .filter((l) => l.trim() !== "").length;
      if (preambleNonBlank > opts.maxLinesBeforeHeader) {
        findings.push({
          code: CODES.PREAMBLE_TOO_LONG,
          line: firstHeaderLineIdx + 1,
          excerpt: `${preambleNonBlank} lines before the first header (max ${opts.maxLinesBeforeHeader})`,
        });
      }
    } else {
      const totalNonBlank = lines.filter((l) => l.trim() !== "").length;
      if (totalNonBlank > opts.maxLinesBeforeHeader) {
        findings.push({
          code: CODES.REGISTER_OVERRUN,
          line: totalNonBlank,
          excerpt: `${totalNonBlank} non-blank lines, no contract header (max ${opts.maxLinesBeforeHeader})`,
        });
      }
    }
  }

  return findings;
}

function computeVerdict(strictness, hasStructural, hasRegister) {
  if (strictness === "off") return "pass";
  if (strictness === "advisory") return hasStructural || hasRegister ? "warn" : "pass";
  if (strictness === "strict") {
    if (hasStructural) return "block";
    if (hasRegister) return "warn";
    return "pass";
  }
  if (strictness === "pedantic") return hasStructural || hasRegister ? "block" : "pass";
  return hasStructural || hasRegister ? "warn" : "pass";
}

function exitCodeForVerdict(verdict) {
  return verdict === "block" ? 2 : 0;
}

function lint(text, options) {
  const opts = { ...DEFAULTS, ...(options || {}) };
  const findings =
    opts.strictness === "off" ? [] : scanText(text, opts);
  const hasStructural = findings.some((f) => classOf(f.code) === "structural");
  const hasRegister = findings.some((f) => classOf(f.code) === "register");
  const verdict = computeVerdict(opts.strictness, hasStructural, hasRegister);
  return { findings, verdict };
}

function extractText(contentField) {
  if (typeof contentField === "string") return contentField;
  if (Array.isArray(contentField)) {
    return contentField
      .filter((b) => b && (b.type === "text" || typeof b.text === "string"))
      .map((b) => b.text || "")
      .join("\n");
  }
  return "";
}

function roleOf(entry) {
  if (!entry) return null;
  if (entry.role) return entry.role;
  if (entry.message && entry.message.role) return entry.message.role;
  if (entry.type === "user" || entry.type === "assistant") return entry.type;
  return null;
}

function textOf(entry) {
  if (!entry) return "";
  if (entry.message && entry.message.content !== undefined) return extractText(entry.message.content);
  if (entry.content !== undefined) return extractText(entry.content);
  if (typeof entry.text === "string") return entry.text;
  return "";
}

function readLastRoleText(transcriptPath, role, root, readFileSyncImpl) {
  const read = readFileSyncImpl || fs.readFileSync;
  try {
    let p = transcriptPath;
    if (!path.isAbsolute(p) || !fs.existsSync(p)) {
      const candidate = path.join(root || process.cwd(), transcriptPath);
      if (fs.existsSync(candidate)) p = candidate;
    }
    const raw = read(p, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (roleOf(entry) === role) {
        const t = textOf(entry);
        if (t) return t;
      }
    }
  } catch {
  }
  return "";
}

function resolveInput(payload, opts) {
  const root = (opts && opts.root) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!payload || typeof payload !== "object") {
    return { skip: true, reason: "unreadable-payload", text: "", detailRequested: false };
  }
  if (payload.stop_hook_active) {
    return { skip: true, reason: "stop-hook-active-reentry", text: "", detailRequested: false };
  }
  if (payload.agent_id || payload.agent_type) {
    return { skip: true, reason: "agent-turn", text: "", detailRequested: false };
  }

  let text = "";
  if (typeof payload.last_assistant_message === "string" && payload.last_assistant_message.length > 0) {
    text = payload.last_assistant_message;
  } else if (typeof payload.transcript_path === "string" && payload.transcript_path) {
    text = readLastRoleText(payload.transcript_path, "assistant", root);
  }

  if (!text) {
    return { skip: true, reason: "no-message", text: "", detailRequested: false };
  }

  const nonBlankLines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (nonBlankLines.length < 2) {
    return { skip: true, reason: "too-short", text: "", detailRequested: false };
  }

  let priorPrompt = "";
  if (typeof payload.prior_user_prompt === "string") {
    priorPrompt = payload.prior_user_prompt;
  } else if (typeof payload.transcript_path === "string" && payload.transcript_path) {
    priorPrompt = readLastRoleText(payload.transcript_path, "user", root);
  }
  const detailRequested = DETAIL_OVERRIDE_RE.test(priorPrompt || "");

  return { skip: false, reason: null, text, detailRequested };
}

module.exports = {
  lint,
  scanText,
  resolveInput,
  readLastRoleText,
  matchHeader,
  computeVerdict,
  exitCodeForVerdict,
  classOf,
  CODES,
  STRUCTURAL_CODES,
  REGISTER_CODES,
  HEADERS,
  DEFAULTS,
};
