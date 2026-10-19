#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const catalogGen = require("../generate-skill-catalog.js");
const { normalize } = require("../hooks/lib/skill-router-core.js");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "skill-says-lint";

const MIGRATION_LIST = [
  "session:end", "session:resume", "session:handoff", "session:dump",
  "session:checkpoint", "session:recap", "session:turbo", "session:takenotes",
  "session:read", "session:write",
  "mode:sprint", "mode:adhoc", "mode:oneshot", "mode:solo",
  "sprint:full", "sprint:status", "sprint:plan", "sprint:design",
  "sprint:execute", "sprint:release", "sprint:retrospective",
  "roadmap:add", "roadmap:next", "roadmap:ideas", "roadmap:prioritize",
  "roadmap:cleanup", "panel:roadmap",
  "epic:plan", "epic:status", "epic:start", "epic:close", "epic:fold",
  "commit:local", "commit:land", "commit:remote",
  "fix:fast", "fix:deep", "scan:full", "qa:audit", "redteam:full", "linters:run",
  "learn:deep", "learn:ingest", "learn:integrate", "sleep:quick", "sleep:deep",
  "memory:verify",
  "report", "trackers:validate", "enforcement:log", "enforcement:list",
  "issues:log", "issues:list", "events:tail", "events:query",
  "research:deep", "research:simple", "reasoning:run", "beta:mine",
  "skills:create", "skills:edit", "hooks:add", "agents:list", "models:router",
  "mc:doctor", "mc:health", "mc:update", "mc:release", "portfolio:list",
  "portfolio:open",
];

const ENFORCE_ALL_AFTER = null;
const isIrreversible = catalogGen.isIrreversible;
const VALID_ARGS_MODES = new Set(["none", "free-text", "topic"]);
const PHRASE_RE = /^[a-z0-9' ]+$/;

function wordCount(phrase) {
  return phrase.trim().split(/\s+/).filter(Boolean).length;
}

function evaluate({ skills, enforcedSlugs, now, enforceAllAfter, confirmFlags }) {
  const findings = [];
  let warnedCount = 0;
  const enforced = enforcedSlugs instanceof Set ? enforcedSlugs : new Set(enforcedSlugs || []);
  const pastRamp = now && enforceAllAfter ? now >= enforceAllAfter : false;
  const runtimeConfirm = new Set((confirmFlags || []).map(String));

  const seenPhrases = new Map();
  const seenSlugSignatures = new Map();

  for (const s of skills) {
    const slug = s.slug;
    const routable = s.userInvocable !== false && !s.isAlias;
    if (!routable) {
      if (s.isAlias && Array.isArray(s.says) && s.says.length > 0) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "alias-carries-says",
          message: `${slug} is an alias forwarder but declares says: — aliases are excluded from routing and must not carry says:`,
        });
      }
      continue;
    }

    const inScope = enforced.has(slug);
    const hasSays = Array.isArray(s.says) && s.says.length > 0;

    if ((s.saysConfirm || "never") === "never") {
      if (isIrreversible(slug)) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "ceiling",
          message: `${slug}: slug matches the irreversible vocabulary but says-confirm is "never" — must be "always" or "fuzzy-only"`,
        });
      } else {
        const emittable = Object.values(
          catalogGen.filterFlags({ ...catalogGen.GLOBAL_FLAG_MAP, ...(s.saysFlags || {}) }, s.documentedFlags || []),
        );
        const uncapped = [...new Set(emittable)].filter(
          (v) => isIrreversible(v) && !runtimeConfirm.has(String(v)) && !runtimeConfirm.has(String(v).split(/\s+/)[0]),
        );
        if (uncapped.length) {
          findings.push({
            severity: "high",
            check: NAME,
            kind: "ceiling",
            message: `${slug}: voice can emit irreversible flag(s) ${uncapped.join(", ")} that are not runtime confirm-first, but says-confirm is "never" — must be "always" or "fuzzy-only" (or the flag must be in catalog.confirm_flags)`,
          });
        }
      }
    }

    if (!hasSays) {
      if (inScope) {
        if (pastRamp) {
          findings.push({
            severity: "high",
            check: NAME,
            kind: "missing-says",
            message: `${slug} is in the enforced says: scope but declares no says:`,
          });
        } else {
          warnedCount++;
        }
      }
      continue;
    }

    if (s.says.length < 3 || s.says.length > 6) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "says-count",
        message: `${slug}: says: has ${s.says.length} phrases (must be 3-6)`,
      });
    }

    for (const phrase of s.says) {
      const wc = wordCount(phrase);
      if (!PHRASE_RE.test(phrase) || phrase !== phrase.toLowerCase()) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "says-phrase-shape",
          message: `${slug}: phrase "${phrase}" must be lowercase letters/digits/apostrophes/spaces only (no commas/colons/slashes)`,
        });
      } else if (wc < 2 || wc > 8) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "says-phrase-length",
          message: `${slug}: phrase "${phrase}" is ${wc} words (must be 2-8)`,
        });
      }
      const sig = normalize(phrase).tokens.join(" ");
      if (seenPhrases.has(sig) && seenPhrases.get(sig) !== slug) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "says-collision",
          message: `${slug}: phrase "${phrase}" collides with ${seenPhrases.get(sig)} (normalized: "${sig}")`,
        });
      } else {
        seenPhrases.set(sig, slug);
      }
    }

    const slugSig = normalize(slug.replace(/:/g, " ")).tokens.join(" ");
    if (seenSlugSignatures.has(slugSig) && seenSlugSignatures.get(slugSig) !== slug) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "says-collision",
        message: `${slug}: slug signature "${slugSig}" collides with ${seenSlugSignatures.get(slugSig)}`,
      });
    } else {
      seenSlugSignatures.set(slugSig, slug);
    }
    for (const phrase of s.says) {
      const sig = normalize(phrase).tokens.join(" ");
      if (seenSlugSignatures.has(sig) && seenSlugSignatures.get(sig) !== slug) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "says-collision",
          message: `${slug}: phrase "${phrase}" collides with ${seenSlugSignatures.get(sig)}'s slug`,
        });
      }
    }

    const docSet = new Set(s.documentedFlags || []);
    for (const [spoken, flagStr] of Object.entries(s.saysFlags || {})) {
      const leading = String(flagStr).trim().split(/\s+/)[0];
      if (!docSet.has(leading)) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "invented-flag",
          message: `${slug}: says-flags["${spoken}"] = "${flagStr}" is not in this skill's documented flags (${[...docSet].join(", ") || "none"})`,
        });
      }
    }

    if (s.saysArgs && !VALID_ARGS_MODES.has(s.saysArgs)) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "bad-args-mode",
        message: `${slug}: says-args "${s.saysArgs}" not in {none, free-text, topic}`,
      });
    }
  }

  return { findings, warnedCount };
}

function slugFromRel(relPath) {
  return relPath.replace(/\.md$/i, "").replace(/\//g, ":");
}

function loadSkillsFromDisk(commandsDir) {
  const files = catalogGen.walkSkills(commandsDir);
  return files.map((f) => {
    const entry = catalogGen.entryFromFile(f);
    const slug = entry ? entry.slug : slugFromRel(f.rel);
    if (!entry) {
      return { slug, says: [], saysFlags: {}, documentedFlags: [], isAlias: false, userInvocable: true };
    }
    return {
      slug: entry.slug,
      description: entry.description,
      says: entry.says,
      saysFlags: {},
      saysArgs: entry.args_mode,
      saysConfirm: entry.confirm,
      documentedFlags: entry.documented_flags,
      userInvocable: entry.user_invocable,
      isAlias: !!entry.alias_of,
    };
  });
}

function attachRawSaysFlags(skills, commandsDir) {
  const files = catalogGen.walkSkills(commandsDir);
  const bySlug = new Map();
  for (const f of files) {
    const text = (() => {
      try {
        return fs.readFileSync(f.full, "utf8");
      } catch {
        return "";
      }
    })();
    const { frontmatter } = catalogGen.parseFrontmatter(text);
    bySlug.set(slugFromRel(f.rel), frontmatter["says-flags"]);
  }
  for (const s of skills) {
    const raw = bySlug.get(s.slug);
    if (raw && typeof raw === "object") s.saysFlags = raw;
  }
  return skills;
}

function explicitInvocableSlugs(commandsDir) {
  const out = [];
  for (const f of catalogGen.walkSkills(commandsDir)) {
    let text = "";
    try {
      text = fs.readFileSync(f.full, "utf8");
    } catch {
      continue;
    }
    const { frontmatter } = catalogGen.parseFrontmatter(text);
    if (frontmatter["user-invocable"] === true) out.push(slugFromRel(f.rel));
  }
  return out;
}

function enforcedScope(commandsDir) {
  return new Set([...MIGRATION_LIST, ...explicitInvocableSlugs(commandsDir)]);
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const enforceAll = args.includes("--enforce-all");

  const commandsPath = (() => {
    try {
      const paths = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
      return path.join(ROOT, paths.commands || ".claude/commands");
    } catch {
      return path.join(ROOT, ".claude", "commands");
    }
  })();

  let skills;
  try {
    if (!fs.existsSync(commandsPath)) throw new Error(`commands dir missing: ${commandsPath}`);
    skills = attachRawSaysFlags(loadSkillsFromDisk(commandsPath), commandsPath);
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const confirmFlags = catalogGen.computeConfirmFlags(
    catalogGen.walkSkills(commandsPath).map((f) => catalogGen.entryFromFile(f)).filter(Boolean),
  );

  const now = enforceAll ? "9999-99-99" : new Date().toISOString().slice(0, 10);
  const { findings, warnedCount } = evaluate({
    skills,
    enforcedSlugs: enforcedScope(commandsPath),
    now,
    enforceAllAfter: enforceAll ? now : ENFORCE_ALL_AFTER,
    confirmFlags,
  });

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        { ok: findings.length === 0, check: NAME, counts: { skills: skills.length, warned: warnedCount }, findings },
        null,
        2,
      ) + "\n",
    );
  } else {
    for (const f of findings) {
      process.stdout.write(`FAIL  [${f.kind}] ${f.message}\n`);
    }
    process.stdout.write(
      `# ${NAME}: ${skills.length} skills, ${warnedCount} warned (ramp), ${findings.length} finding(s)\n`,
    );
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate, enforcedScope, explicitInvocableSlugs, MIGRATION_LIST, ENFORCE_ALL_AFTER, isIrreversible, loadSkillsFromDisk };
