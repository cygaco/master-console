#!/usr/bin/env node
"use strict";

const core = require("./skill-router-core.js");

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check(
  "compound join: road map -> roadmap",
  core.normalize("add to the road map").tokens.includes("roadmap"),
);
check(
  "homophone: session and quick -> session end quick",
  core.normalize("session and quick").tokens.join(" ") === "session end quick",
);
check(
  "homophone: spring before mode -> sprint",
  core.normalize("how is the spring mode going").tokens.includes("sprint"),
);
check(
  "normalize marks the homophone-rewritten position, not its neighbors",
  (() => {
    const n = core.normalize("spring mode");
    const springIdx = n.tokens.indexOf("sprint");
    const modeIdx = n.tokens.indexOf("mode");
    return n.rewritten[springIdx] === true && n.rewritten[modeIdx] === false;
  })(),
);
check(
  "a genuinely-spoken word is never marked rewritten",
  core.normalize("sprint mode").rewritten.every((r) => r === false),
);
check(
  "rewritten flag survives a compound join (turbine mode -> merged 'turbo' stays rewritten)",
  (() => {
    const n = core.normalize("turbine mode");
    const idx = n.tokens.indexOf("turbo");
    return idx !== -1 && n.tokens.length === 1 && n.rewritten[idx] === true;
  })(),
);
check(
  "stopwords removed from contentTokens but not tokens",
  (() => {
    const n = core.normalize("wrap up the session please");
    return n.tokens.includes("the") && !n.contentTokens.includes("the");
  })(),
);
check(
  "light stemming: wrapping ~ wrap (fuzzy-equivalent post-stem, not necessarily byte-identical)",
  core.fuzzyEq(core.normalize("wrapping up").tokens[0], "wrap").match === true,
);

check("fuzzyEq exact", core.fuzzyEq("sprint", "sprint").exact === true);
check(
  "fuzzyEq edit-distance-1 (6 chars) matches, not exact",
  (() => {
    const r = core.fuzzyEq("sprnt", "sprint");
    return r.match === true && r.exact === false;
  })(),
);
check(
  "fuzzyEq prefix truncation (retro ~ retrospective)",
  (() => {
    const r = core.fuzzyEq("retro", "retrospective");
    return r.match === true && r.exact === false;
  })(),
);
check(
  "fuzzyEq short tokens (<=3 chars) require exact",
  core.fuzzyEq("en", "end").match === false,
);

const sessionEnd = {
  slug: "session:end",
  says_norm: [
    ["wrap", "up", "session"],
    ["end", "session"],
    ["session", "end"],
  ],
  slug_tokens: ["session", "end"],
  confirm: "never",
};

check(
  "scoreEntry: exact phrase scores high ('up' stays matchable though it's a scoring stopword)",
  core.scoreEntry(core.normalize("wrap up the session"), sessionEnd).score >= 0.8,
);
check(
  "scoreEntry: session end fast scores HIGH (slug or phrase channel, either is correct)",
  core.scoreEntry(core.normalize("session end fast"), sessionEnd).score >= 0.8,
);
check(
  "scoreEntry: slug channel alone (no overlapping phrase) scores HIGH on a short prompt",
  (() => {
    const slugOnly = { slug: "fix:deep", says_norm: [], slug_tokens: ["fix", "deep"], confirm: "never" };
    const r = core.scoreEntry(core.normalize("fix deep"), slugOnly);
    return r.score >= 0.8 && r.channel === "slug";
  })(),
);
check(
  "scoreEntry: unrelated prompt scores ~0",
  core.scoreEntry(core.normalize("tell me a joke please"), sessionEnd).score < 0.3,
);
check(
  "scoreEntry requires the normalize() object — no bare-array call shape survives",
  (() => {
    const slugOnly = { slug: "fix:deep", says_norm: [], slug_tokens: ["fix", "deep"], confirm: "never" };
    try {
      core.scoreEntry(["fix", "deep"], slugOnly);
      return false;
    } catch {
      return true;
    }
  })(),
);

const sessionTurboFuzzyOnly = {
  slug: "session:turbo",
  says_norm: [["turbo"], ["initiate", "turbo"]],
  slug_tokens: ["session", "turbo"],
  confirm: "fuzzy-only",
};
const modeSprintFuzzyOnly = {
  slug: "mode:sprint",
  says_norm: [["sprint", "mode"]],
  slug_tokens: ["mode", "sprint"],
  confirm: "fuzzy-only",
};

function routeTier(say, entry) {
  const normalized = core.normalize(say);
  const r = core.scoreEntry(normalized, entry);
  const ranked = r.score > 0 ? [{ entry, score: r.score, exact: r.exact, complete: r.complete }] : [];
  return core.decide(ranked, normalized.contentTokens.length).tier;
}

check(
  "'turbine mode' / 'turbot mode' never auto-invoke session:turbo (MEDIUM, not HIGH)",
  routeTier("turbine mode", sessionTurboFuzzyOnly) === "MEDIUM" &&
    routeTier("turbot mode", sessionTurboFuzzyOnly) === "MEDIUM",
);
check(
  "'spring mode' / 'print mode' never auto-invoke mode:sprint (MEDIUM, not HIGH)",
  routeTier("spring mode", modeSprintFuzzyOnly) === "MEDIUM" &&
    routeTier("print mode", modeSprintFuzzyOnly) === "MEDIUM",
);
check(
  "genuinely-spoken 'turbo mode' / 'sprint mode' still auto-invoke HIGH (the exact-naming branch survives)",
  routeTier("turbo mode", sessionTurboFuzzyOnly) === "HIGH" &&
    routeTier("sprint mode", modeSprintFuzzyOnly) === "HIGH",
);
check(
  "scoreEntry reports exact=false when the winning match consumed a rewritten token, even though the rewritten string is byte-identical to the phrase",
  core.scoreEntry(core.normalize("turbot mode"), sessionTurboFuzzyOnly).exact === false,
);

function rankedFor(score, exact, confirm, complete = true) {
  return [{ entry: { slug: "x", confirm }, score, exact, complete }];
}

check(
  "decide: plain HIGH when confirm=never and score high",
  core.decide(rankedFor(0.9, true, "never"), 3).tier === "HIGH",
);
check(
  "decide: confirm=always caps at MEDIUM even at score 0.95",
  core.decide(rankedFor(0.95, true, "always"), 2).tier === "MEDIUM",
);
check(
  "decide: confirm=fuzzy-only + EXACT naming -> HIGH (user said it)",
  core.decide(rankedFor(0.9, true, "fuzzy-only"), 1).tier === "HIGH",
);
check(
  "decide: confirm=fuzzy-only + FUZZY/non-exact match -> MEDIUM (confirm-first)",
  core.decide(rankedFor(0.9, false, "fuzzy-only"), 3).tier === "MEDIUM",
);
check(
  "decide: below 0.60 -> none",
  core.decide(rankedFor(0.4, true, "never"), 3).tier === null,
);

check(
  "decide: PARTIAL match in a long prompt (>12 content tokens) -> none even at 0.74",
  core.decide([{ entry: { slug: "commit:land", confirm: "never" }, score: 0.74, exact: false, complete: false }], 20).tier === null,
);
check(
  "decide: COMPLETE match in a long prompt -> MEDIUM (phrase present in full)",
  core.decide([{ entry: { slug: "session:turbo", confirm: "fuzzy-only" }, score: 0.72, exact: true, complete: true }], 14).tier === "MEDIUM",
);
check(
  "decide: PARTIAL match in a SHORT prompt is still score-driven (rule only bites past 12)",
  core.decide([{ entry: { slug: "x", confirm: "never" }, score: 0.7, exact: false, complete: false }], 5).tier === "MEDIUM",
);
check(
  "decide: a caller that omits `complete` fails CLOSED to none past 12 tokens (no real caller ever omits this signal)",
  core.decide([{ entry: { slug: "x", confirm: "never" }, score: 0.7, exact: false }], 20).tier === null,
);
check(
  "decide: `complete: false` and an omitted `complete` are equivalent past 12 tokens (both fail closed)",
  core.decide([{ entry: { slug: "x", confirm: "never" }, score: 0.7, exact: false, complete: false }], 20).tier ===
    core.decide([{ entry: { slug: "x", confirm: "never" }, score: 0.7, exact: false }], 20).tier,
);
check(
  "matchTokenSet: a STOPWORD never fuzzes into a content word (and !~ land), but still matches itself exactly",
  (() => {
    const bad = core.matchTokenSet(["yesterday", "and", "whether", "the", "branch"], ["land", "the", "branch"]);
    const good = core.matchTokenSet(["wrap", "up", "the", "session"], ["wrap", "up", "the", "session"]);
    return bad.matchedCount === 2 && good.matchedCount === 4 && good.allExact === true;
  })(),
);
check(
  "scoreEntry: complete=true on a full phrase match, false on a partial one",
  (() => {
    const e = { slug: "commit:land", says_norm: [["land", "the", "branch"]], slug_tokens: ["commit", "land"] };
    const full = core.scoreEntry(core.normalize("land the branch"), e);
    const part = core.scoreEntry(core.normalize("remind me which branch we were on yesterday and whether the operator approved the pricing change"), e);
    return full.complete === true && part.complete === false;
  })(),
);

check(
  "applyFlagCeiling: HIGH + widening --turbo as a secondary flag -> MEDIUM (confirm-first)",
  (() => {
    const d = core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], ["--turbo"]);
    return d.tier === "MEDIUM" && /widening-flag:--turbo/.test(d.reason);
  })(),
);
check(
  "applyFlagCeiling: multi-token local flag matches on its first token (--autonomy turbo)",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--autonomy turbo"], ["--autonomy turbo"]).tier === "MEDIUM" &&
    core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--autonomy turbo"], ["--autonomy"]).tier === "MEDIUM",
);
check(
  "applyFlagCeiling: HIGH + a non-widening flag (--fast) stays HIGH",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--fast"], ["--turbo"]).tier === "HIGH",
);
const sessionTurboEntry = {
  slug: "session:turbo",
  slug_tokens: ["session", "turbo"],
  says_norm: [["turbo"], ["initiate", "turbo"], ["go", "fast", "this", "session"]],
  confirm: "fuzzy-only",
};
const modeSprintEntry = {
  slug: "mode:sprint",
  slug_tokens: ["mode", "sprint"],
  says_norm: [["sprint", "mode"], ["initiate", "sprint", "mode"]],
  confirm: "fuzzy-only",
};
check(
  "applyFlagCeiling: the widening word is the WINNER'S OWN NAME (initiate turbo mode -> /session:turbo) -> HIGH stands",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], ["--turbo"], {
    entry: sessionTurboEntry,
    matchedSpoken: ["turbo"],
  }).tier === "HIGH",
);
check(
  "applyFlagCeiling: own-name via a says phrase (go fast this session -> /session:turbo --turbo) -> HIGH stands",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], ["--turbo"], {
    entry: sessionTurboEntry,
    matchedSpoken: ["go fast"],
  }).tier === "HIGH",
);
check(
  "applyFlagCeiling: widening word is NOT the winner's name (sprint mode turbo -> /mode:sprint --turbo) -> MEDIUM",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], ["--turbo"], {
    entry: modeSprintEntry,
    matchedSpoken: ["turbo"],
  }).tier === "MEDIUM",
);
check(
  "isOwnName: slug-token and says-phrase containment, negative on a foreign word",
  core.isOwnName(sessionTurboEntry, "turbo") === true &&
    core.isOwnName(sessionTurboEntry, "go fast") === true &&
    core.isOwnName(modeSprintEntry, "turbo") === false &&
    core.isOwnName(modeSprintEntry, "") === false,
);
check(
  "normalize: hyphen is a separator (turbo-ish -> turbo, ish; read-only -> read only)",
  (() => {
    const a = core.normalize("maybe go faster, turbo-ish?").tokens;
    const b = core.normalize("make it read-only").tokens;
    return a.includes("turbo") && a.includes("ish") && b.includes("read") && b.includes("only");
  })(),
);
check(
  "applyFlagCeiling: no flags / MEDIUM / NONE pass through unchanged (empty set + NO flags too)",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, [], []).tier === "HIGH" &&
    core.applyFlagCeiling({ tier: "HIGH", tie: false }, [], ["--turbo"]).tier === "HIGH" &&
    core.applyFlagCeiling({ tier: "MEDIUM", tie: true }, ["--turbo"], ["--turbo"]).tier === "MEDIUM" &&
    core.applyFlagCeiling({ tier: null, tie: false }, ["--turbo"], ["--turbo"]).tier === null,
);
check(
  "decide: tie within 0.08 forces MEDIUM even at high scores",
  (() => {
    const ranked = [
      { entry: { slug: "a", confirm: "never" }, score: 0.85, exact: true },
      { entry: { slug: "b", confirm: "never" }, score: 0.8, exact: true },
    ];
    const d = core.decide(ranked, 3);
    return d.tier === "MEDIUM" && d.tie === true;
  })(),
);
check(
  "decide: >25 content tokens -> none (length guard upstream, decide defensive too)",
  core.decide(rankedFor(0.9, true, "never"), 30).tier === null,
);
check(
  "decide: 12 < tokens <= 25 downgrades a would-be HIGH to MEDIUM",
  core.decide(rankedFor(0.9, true, "never"), 18).tier === "MEDIUM",
);

check(
  "parseEntities: mode entity",
  core.parseEntities(["resume", "in", "sprint", "mode"], "resume in sprint mode")
    .entities.mode === "sprint",
);
check(
  "parseEntities: last N -> n",
  core.parseEntities(["tail", "the", "last", "20", "events"], "tail the last 20 events")
    .entities.n === 20,
);
check(
  "parseEntities: epic id regex",
  core.parseEntities([], "plan an epic for e-demo-flow-001").entities.epic_id ===
    "e-demo-flow-001",
);
check(
  "parseEntities: duration 'an hour' -> 60 minutes",
  core.parseEntities([], "speed mode for an hour").entities.ttl_minutes === 60,
);

check(
  "parseFlags: longest-match-first, only documented flags emitted",
  (() => {
    const entry = { flags: { "no push": "--no-push", push: "--push" } };
    const r = core.parseFlags("end the session but no push", entry);
    return r.flags.includes("--no-push") && !r.flags.includes("--push");
  })(),
);

check(
  "formatContext: HIGH tier includes an invoke line",
  (() => {
    const ranked = [
      {
        entry: { slug: "session:end", description: "Full session wrap-up." },
        score: 0.91,
        exact: true,
      },
    ];
    const decision = { tier: "HIGH", tie: false };
    const text = core.formatContext(decision, ranked, () => "/session:end --fast");
    return (
      text.includes("SUGGESTED SKILLS:") &&
      text.includes("[HIGH]") &&
      text.includes("→ invoke: /session:end --fast")
    );
  })(),
);
check(
  "formatContext: MEDIUM tie lists both + a confirm-one line",
  (() => {
    const ranked = [
      { entry: { slug: "roadmap:next", description: "Next thing." }, score: 0.71, exact: false },
      { entry: { slug: "sprint:status", description: "Status." }, score: 0.66, exact: false },
    ];
    const decision = { tier: "MEDIUM", tie: true };
    const text = core.formatContext(decision, ranked, () => "");
    return (
      text.includes("/roadmap:next") &&
      text.includes("/sprint:status") &&
      text.includes("confirm one:")
    );
  })(),
);
check(
  "formatContext: none tier -> null",
  core.formatContext({ tier: null }, [], () => "") === null,
);

check(
  "decide() with a MISSING confirm class caps at MEDIUM (never defaults to 'never')",
  core.decide([{ entry: { slug: "x" }, score: 0.95, exact: true, complete: true }], 3).tier === "MEDIUM",
);
check(
  "decide() with an INVALID confirm class caps at MEDIUM",
  core.decide([{ entry: { slug: "x", confirm: "bogus" }, score: 0.95, exact: true, complete: true }], 3).tier === "MEDIUM",
);
check(
  "applyFlagCeiling with an ABSENT confirm-flag set caps a flagged HIGH at MEDIUM",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], undefined).tier === "MEDIUM",
);
check(
  "applyFlagCeiling with an EMPTY confirm-flag set caps a flagged HIGH at MEDIUM",
  core.applyFlagCeiling({ tier: "HIGH", tie: false }, ["--turbo"], []).tier === "MEDIUM",
);
check(
  "a MEDIUM decision carries the confirm-semantics instruction",
  (() => {
    const ranked = [{ entry: { slug: "x:y", description: "D." }, score: 0.7, exact: false }];
    const t = core.formatContext({ tier: "MEDIUM", tie: false }, ranked, () => "/x:y");
    return /ask in ONE line/.test(t) && /score is not authorization/.test(t);
  })(),
);
check(
  "a MEDIUM tie also carries the semantics instruction",
  (() => {
    const ranked = [
      { entry: { slug: "a:b", description: "D." }, score: 0.7, exact: false },
      { entry: { slug: "c:d", description: "D." }, score: 0.68, exact: false },
    ];
    return /ask in ONE line/.test(core.formatContext({ tier: "MEDIUM", tie: true }, ranked, () => ""));
  })(),
);

console.log(`skill-router-core.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
