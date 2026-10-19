"use strict";

const SKIP_WORDS = new Set([
  "approve", "continue", "done", "all", "yes", "no", "ok", "sure", "go",
  "next", "skip", "stop", "cancel", "retry", "confirm", "accept", "reject",
]);

const STOPWORDS = new Set(
  "the a an to please can you could you lets let's now this that in on of for me my us our it up with and so just go ahead hey alex okay ok"
    .split(/\s+/)
    .filter(Boolean),
);

const COMPOUND_JOINS = [
  [["road", "map"], "roadmap"],
  [["check", "point"], "checkpoint"],
  [["hand", "off"], "handoff"],
  [["take", "notes"], "takenotes"],
  [["red", "team"], "redteam"],
  [["play", "book"], "playbook"],
  [["one", "shot"], "oneshot"],
  [["ad", "hoc"], "adhoc"],
  [["re", "cap"], "recap"],
  [["retro", "spective"], "retrospective"],
  [["turbo", "mode"], "turbo"],
  [["master", "console"], "mc"],
  [["enforcement", "debt"], "enforcement"],
];

function applyHomophones(tokens) {
  const out = tokens.slice();
  const rewritten = new Array(tokens.length).fill(false);
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    const prev = out[i - 1];
    const next = out[i + 1];
    if (t === "and" && (prev === "session" || next === "session")) {
      out[i] = "end";
      rewritten[i] = true;
    } else if (t === "ad" && out.includes("roadmap")) {
      out[i] = "add";
      rewritten[i] = true;
    } else if (
      (t === "spring" || t === "print") &&
      next &&
      ["mode", "status", "full", "plan"].includes(next)
    ) {
      out[i] = "sprint";
      rewritten[i] = true;
    } else if (t === "epoch") {
      out[i] = "epic";
      rewritten[i] = true;
    } else if (t === "turbot" || t === "turbine") {
      out[i] = "turbo";
      rewritten[i] = true;
    } else if (t === "better" && next && ["mine", "consult"].includes(next)) {
      out[i] = "beta";
      rewritten[i] = true;
    } else if (t === "rode" && next === "map") {
      out[i] = "road";
      rewritten[i] = true;
    } else if (t === "right" && prev === "session") {
      out[i] = "write";
      rewritten[i] = true;
    }
  }
  return { tokens: out, rewritten };
}

function applyCompoundJoins(tokens, rewritten) {
  const out = [];
  const outRewritten = [];
  let i = 0;
  while (i < tokens.length) {
    let joined = false;
    for (const [pair, merged] of COMPOUND_JOINS) {
      if (
        tokens[i] === pair[0] &&
        i + 1 < tokens.length &&
        tokens[i + 1] === pair[1]
      ) {
        out.push(merged);
        outRewritten.push(Boolean(rewritten[i] || rewritten[i + 1]));
        i += 2;
        joined = true;
        break;
      }
    }
    if (!joined) {
      out.push(tokens[i]);
      outRewritten.push(Boolean(rewritten[i]));
      i += 1;
    }
  }
  return { tokens: out, rewritten: outRewritten };
}

function lightStem(token) {
  if (token.length >= 5) {
    if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
    if (token.endsWith("ed") && token.length > 6) return token.slice(0, -2);
    if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  }
  return token;
}

function normalize(text) {
  let s = String(text || "").toLowerCase();
  s = s.replace(/\bdash dash\b|\bdouble dash\b/g, " -- ");
  s = s.replace(/\bcolon\b/g, " : ");
  s = s.replace(/\bhyphen\b|\bdash\b/g, " - ");
  s = s.replace(/[^a-z0-9\s']/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const rawTokens = s.split(" ").filter(Boolean);
  const homophoned = applyHomophones(rawTokens);
  const joined = applyCompoundJoins(homophoned.tokens, homophoned.rewritten);
  const tokens = joined.tokens.map(lightStem);
  const rewritten = joined.rewritten;

  const contentTokens = [];
  const contentRewritten = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!STOPWORDS.has(tokens[i])) {
      contentTokens.push(tokens[i]);
      contentRewritten.push(rewritten[i]);
    }
  }
  return { tokens, contentTokens, rewritten, contentRewritten, raw: s };
}

function tokenize(text) {
  return normalize(text).contentTokens;
}

function damerauLevenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d = [];
  for (let i = 0; i <= al; i++) d.push([i]);
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[al][bl];
}

function fuzzyEq(a, b) {
  if (a === b) return { match: true, exact: true };
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 3) return { match: false, exact: false };
  const tolerance = maxLen >= 7 ? 2 : 1;
  if (damerauLevenshtein(a, b) <= tolerance) {
    return { match: true, exact: false };
  }
  if (a.length >= 5 && b.startsWith(a) && a !== b) {
    return { match: true, exact: false };
  }
  return { match: false, exact: false };
}

function matchTokenSet(promptTokens, phraseTokens, promptRewritten) {
  const used = new Array(promptTokens.length).fill(false);
  let matchedCount = 0;
  let allExact = true;
  const matchedPositions = [];
  for (const pt of phraseTokens) {
    let bestIdx = -1;
    let bestExact = false;
    for (let i = 0; i < promptTokens.length; i++) {
      if (used[i]) continue;
      const a = promptTokens[i];
      const r =
        STOPWORDS.has(a) || STOPWORDS.has(pt)
          ? { match: a === pt, exact: a === pt }
          : fuzzyEq(a, pt);
      const exactHere = r.exact && !(promptRewritten && promptRewritten[i]);
      if (r.match) {
        if (bestIdx === -1 || (exactHere && !bestExact)) {
          bestIdx = i;
          bestExact = exactHere;
          if (exactHere) break;
        }
      }
    }
    if (bestIdx !== -1) {
      used[bestIdx] = true;
      matchedCount++;
      matchedPositions.push(bestIdx);
      if (!bestExact) allExact = false;
    } else {
      allExact = false;
    }
  }
  let inOrder = true;
  for (let i = 1; i < matchedPositions.length; i++) {
    if (matchedPositions[i] < matchedPositions[i - 1]) {
      inOrder = false;
      break;
    }
  }
  const orderBonus = matchedPositions.length >= 2 && inOrder ? 1 : 0;
  return { matchedCount, allExact, orderBonus, total: phraseTokens.length };
}

function phraseScore(promptTokens, promptContentTokenCount, phraseTokens, promptRewritten) {
  if (!phraseTokens || phraseTokens.length === 0) return { score: 0, allExact: false, matchedCount: 0 };
  const { matchedCount, allExact, orderBonus, total } = matchTokenSet(
    promptTokens,
    phraseTokens,
    promptRewritten,
  );
  if (matchedCount === 0) return { score: 0, allExact: false, matchedCount: 0 };
  const promptLen = Math.max(1, promptContentTokenCount);
  const score =
    0.7 * (matchedCount / total) +
    0.2 * (matchedCount / promptLen) +
    0.1 * orderBonus;
  return {
    score,
    allExact: allExact && matchedCount === total,
    matchedCount,
    complete: matchedCount === total,
  };
}

function scoreEntry(normalized, entry) {
  const promptTokens = normalized.tokens;
  const contentCount = normalized.contentTokens.length;
  const promptRewritten = normalized.rewritten;
  let best = { score: 0, exact: false, complete: false, channel: null };

  for (const phrase of entry.says_norm || []) {
    const r = phraseScore(promptTokens, contentCount, phrase, promptRewritten);
    if (r.score > best.score) {
      best = { score: r.score, exact: r.allExact, complete: r.complete, channel: "phrase" };
    }
  }

  if (Array.isArray(entry.slug_tokens) && entry.slug_tokens.length > 0) {
    const r = phraseScore(promptTokens, contentCount, entry.slug_tokens, promptRewritten);
    let slugScore = r.score;
    const fullMatch = r.matchedCount === entry.slug_tokens.length;
    const shortPrompt = contentCount <= 6;
    if (!(fullMatch && shortPrompt)) {
      slugScore = Math.min(slugScore, 0.85);
    }
    if (slugScore > best.score) {
      best = { score: slugScore, exact: r.allExact, complete: fullMatch, channel: "slug" };
    }
  }

  return best;
}

const MODE_WORDS = new Set(["sprint", "adhoc", "oneshot", "solo"]);
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

function parseEntities(tokens, rawText) {
  const entities = {};
  const consumed = new Array(tokens.length).fill(false);

  for (let i = 0; i < tokens.length; i++) {
    if (MODE_WORDS.has(tokens[i])) {
      entities.mode = tokens[i];
      consumed[i] = true;
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === "last" || tokens[i] === "top") && i + 1 < tokens.length) {
      const nxt = tokens[i + 1];
      const n = /^\d+$/.test(nxt) ? parseInt(nxt, 10) : NUMBER_WORDS[nxt];
      if (Number.isFinite(n)) {
        entities.n = n;
        consumed[i] = true;
        consumed[i + 1] = true;
      }
    }
  }

  const sprintIdMatch = String(rawText || "").match(/\bs-[a-z0-9]+-\d+\b/i);
  if (sprintIdMatch) entities.sprint_id = sprintIdMatch[0];
  const epicIdMatch = String(rawText || "").match(/\be-[a-z0-9-]+-\d{3}\b/i);
  if (epicIdMatch) entities.epic_id = epicIdMatch[0];
  const ticketMatch = String(rawText || "").match(/\bt-\d+/i);
  if (ticketMatch) entities.ticket = ticketMatch[0];

  const durationMatch = String(rawText || "").match(
    /\b(\d+)\s*(minutes?|hours?)\b|\ban hour\b/,
  );
  if (durationMatch) {
    if (durationMatch[0] === "an hour") {
      entities.ttl_minutes = 60;
    } else {
      const n = parseInt(durationMatch[1], 10);
      entities.ttl_minutes = /hour/.test(durationMatch[2]) ? n * 60 : n;
    }
  }

  return { entities, consumed };
}

function parseFlags(normalizedText, entry) {
  const flags = [];
  const matchedSpoken = [];
  const map = entry.flags || {};
  const spokenPhrases = Object.keys(map).sort((a, b) => b.length - a.length);
  let remaining = ` ${normalizedText} `;
  for (const spoken of spokenPhrases) {
    const needle = ` ${spoken} `;
    if (remaining.includes(needle)) {
      flags.push(map[spoken]);
      matchedSpoken.push(spoken);
      remaining = remaining.replace(needle, " ");
    }
  }
  return { flags, matchedSpoken, remainder: remaining.trim() };
}

const TIERS = { HIGH: "HIGH", MEDIUM: "MEDIUM", NONE: null };
const VALID_CONFIRM = new Set(["never", "always", "fuzzy-only"]);

function decide(ranked, contentTokenCount) {
  if (!ranked || ranked.length === 0) return { tier: TIERS.NONE, tie: false };
  const best = ranked[0];
  const runnerUp = ranked[1];
  const tie = !!(runnerUp && best.score - runnerUp.score < 0.08);

  if (best.score < 0.6) return { tier: TIERS.NONE, tie: false };

  const rawConfirm = best.entry && best.entry.confirm;
  const confirm = VALID_CONFIRM.has(rawConfirm) ? rawConfirm : "always";
  const within12 = contentTokenCount <= 12;
  const within25 = contentTokenCount <= 25;

  if (!within12 && best.complete !== true) {
    return { tier: TIERS.NONE, tie: false, reason: "partial-match-in-long-prompt" };
  }

  let wantsHigh =
    best.score >= 0.8 && !tie && within12 && confirm !== "always";

  if (wantsHigh && confirm === "fuzzy-only" && !best.exact) {
    wantsHigh = false;
  }

  if (wantsHigh) return { tier: TIERS.HIGH, tie: false };

  if (!within25) return { tier: TIERS.NONE, tie: false };
  return { tier: TIERS.MEDIUM, tie };
}

function applyFlagCeiling(decision, flags, confirmFlags, winner) {
  if (!decision || decision.tier !== TIERS.HIGH) return decision;
  if (!Array.isArray(confirmFlags) || !confirmFlags.length) {
    if ((flags || []).length) return { ...decision, tier: TIERS.MEDIUM, reason: "confirm-flags-unavailable" };
    return decision;
  }
  const set = new Set(confirmFlags.map(String));
  const spoken = (winner && Array.isArray(winner.matchedSpoken) && winner.matchedSpoken) || [];
  const entry = (winner && winner.entry) || null;
  for (let i = 0; i < (flags || []).length; i++) {
    const f = String(flags[i]);
    if (!(set.has(f) || set.has(f.split(/\s+/)[0]))) continue;
    if (entry && spoken[i] && isOwnName(entry, spoken[i])) continue;
    return { ...decision, tier: TIERS.MEDIUM, reason: `widening-flag:${f}` };
  }
  return decision;
}

function isOwnName(entry, spokenPhrase) {
  const toks = String(spokenPhrase || "").split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const slugToks = new Set(entry.slug_tokens || []);
  if (toks.every((t) => slugToks.has(t))) return true;
  for (const phrase of entry.says_norm || []) {
    const set = new Set(phrase);
    if (toks.every((t) => set.has(t))) return true;
  }
  return false;
}

function firstSentence(desc) {
  return String(desc || "").split(/(?<=[.!?])\s/)[0].slice(0, 120);
}

function formatContext(decision, ranked, buildInvoke) {
  if (!decision || !decision.tier) return null;
  const lines = ["SUGGESTED SKILLS:"];
  const shown = decision.tier === "MEDIUM" && decision.tie ? ranked.slice(0, 2) : ranked.slice(0, 1);
  for (const r of shown) {
    const desc = firstSentence(r.entry.description);
    lines.push(
      `  /${r.entry.slug} — ${desc} (score ${r.score.toFixed(2)}) [${decision.tier}]`,
    );
  }
  if (decision.tier === "HIGH") {
    lines.push(`  → invoke: ${buildInvoke(shown[0])}`);
  } else if (decision.tie) {
    lines.push(
      `  → confirm one: ${shown.map((r) => `/${r.entry.slug}`).join("  |  ")}`,
    );
  } else {
    lines.push(`  → confirm: ${buildInvoke(shown[0])}`);
  }
  lines.push(
    decision.tier === "HIGH"
      ? "  voice-router: deterministic match on the operator's sentence. HIGH = invoke it now. MEDIUM = ask in ONE line (⚠️ DECISION NEEDED) before invoking; the score is not authorization. Skills marked confirm-always (push/deploy/release/delete/turbo) are never auto-invoked by voice."
      : "  voice-router: MEDIUM match — ask in ONE line (⚠️ DECISION NEEDED) before invoking; the score is not authorization. Skills marked confirm-always (push/deploy/release/delete/turbo) are never auto-invoked by voice.",
  );
  return lines.join("\n");
}

module.exports = {
  STOPWORDS,
  SKIP_WORDS,
  normalize,
  tokenize,
  damerauLevenshtein,
  fuzzyEq,
  matchTokenSet,
  phraseScore,
  scoreEntry,
  parseEntities,
  parseFlags,
  decide,
  applyFlagCeiling,
  isOwnName,
  formatContext,
  TIERS,
};
