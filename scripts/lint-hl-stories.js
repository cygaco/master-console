#!/usr/bin/env node
/**
 * HL-Stories Linter — Validates high-level stories for the product spec set.
 * Usage: node scripts/lint-hl-stories.js [feature] [--verbose]
 */
const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./hooks/lib/paths");

const ROOT = PROJECT;
const FEATURES_DIR = PATHS.specsRoot || path.join(ROOT, "requirements", "04-features");
const ALLOWED_ROLES = [
  "user",
  "system",
  "product manager",
  "admin",
  "security admin",
  "platform owner",
  "developer",
  "operator",
  "team",
];
const COMPOUND_PATTERNS = [
  /\bI want to .+ and (?:also |additionally )?(?:have|get|see|be|receive|set|create)\b/i,
  /\bI want to .+,\s*(?:and|as well as|while also|plus)\s/i,
];
const DETAIL_LEAK_PATTERNS = [
  { pattern: /\bbutton\b/i, label: "UI element (button)" },
  { pattern: /\bdropdown\b/i, label: "UI element (dropdown)" },
  { pattern: /\bmodal\b/i, label: "UI element (modal)" },
  { pattern: /\btoast\b/i, label: "UI element (toast)" },
  { pattern: /\bspinner\b/i, label: "UI element (spinner)" },
  { pattern: /\bclick(?:s|ing)?\b/i, label: "interaction detail (click)" },
  { pattern: /\btab\b/i, label: "UI element (tab)" },
  { pattern: /\bAPI\b/, label: "technical detail (API)" },
  { pattern: /\bendpoint\b/i, label: "technical detail (endpoint)" },
  { pattern: /\bdatabase\b/i, label: "technical detail (database)" },
  { pattern: /\bRedis\b/, label: "technical detail (Redis)" },
  { pattern: /\bJSON\b/, label: "technical detail (JSON)" },
  { pattern: /\bCSS\b/, label: "technical detail (CSS)" },
  { pattern: /\broute\b/i, label: "technical detail (route)" },
];
const DETAIL_ALLOWLIST = [/API call/i, /API key/i, /API.+operational/i];

const RED = "\x1b[31m",
  YELLOW = "\x1b[33m",
  GREEN = "\x1b[32m";
const CYAN = "\x1b[36m",
  DIM = "\x1b[2m",
  RESET = "\x1b[0m",
  BOLD = "\x1b[1m";

function error(f, id, m) {
  return { level: "error", feature: f, storyId: id, msg: m };
}
function warn(f, id, m) {
  return { level: "warn", feature: f, storyId: id, msg: m };
}
function info(f, id, m) {
  return { level: "info", feature: f, storyId: id, msg: m };
}

function normalizeClassification(classification) {
  return classification.replace(/\s+\([^)]*\)\s*$/, "").trim();
}

function normalizeRole(role) {
  return role
    .toLowerCase()
    .replace(/\s+(?:who|with)\b.*$/, "")
    .trim();
}

function extractStories(content) {
  const stories = [];
  const blocks = content.replace(/\r/g, "").split(/^## /m).filter(Boolean);
  for (const block of blocks) {
    if (!block.match(/^HL-/)) continue;
    const lines = block.split("\n");
    const idMatch = lines[0].trim().match(/^(HL-[A-Z]+-\d+):\s*(.+)/);
    if (!idMatch) continue;
    const classLine = lines.find((l) => /\*\*Classification:\*\*/.test(l));
    const classification = classLine
      ? classLine.replace(/.*\*\*Classification:\*\*\s*/, "").trim()
      : null;
    const quoteLine = lines
      .filter((l) => l.startsWith(">"))
      .map((l) => l.replace(/^>\s*/, ""))
      .join(" ")
      .trim();
    const criteriaStart = lines.findIndex((l) =>
      /\*\*Acceptance Criteria:\*\*/.test(l),
    );
    const criteria = [];
    if (criteriaStart >= 0) {
      for (let i = criteriaStart + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- ")) criteria.push(line.replace(/^- /, ""));
      }
    }
    stories.push({
      id: idMatch[1],
      title: idMatch[2],
      classification,
      quoteLine,
      criteria,
      raw: block,
    });
  }
  return stories;
}

function extractJTBDs(prdContent) {
  const clean = prdContent.replace(/\r/g, "");
  const jtbdMatch = clean.match(/## \d+\.\s+JTBD.*?\n([\s\S]*?)(?=\n## \d+\.)/);
  if (!jtbdMatch) return [];
  const jobs = [];
  let current = "";
  for (const line of jtbdMatch[1].split("\n")) {
    if (line.match(/^>\s+When\b/i)) {
      if (current) jobs.push(current);
      current = line.replace(/^>\s*/, "");
    } else if (line.match(/^>\s+/) && current)
      current += " " + line.replace(/^>\s*/, "");
    else if (current) {
      jobs.push(current);
      current = "";
    }
  }
  if (current) jobs.push(current);
  return jobs;
}

function checkStories(feature, stories) {
  const issues = [];
  if (stories.length === 0) {
    issues.push(error(feature, "-", "No stories found"));
    return issues;
  }
  for (const story of stories) {
    const { id, classification, quoteLine, criteria } = story;
    if (!classification)
      issues.push(error(feature, id, "Missing classification"));
    else if (
      normalizeClassification(classification) !== "MVP" &&
      normalizeClassification(classification) !== "Post-MVP"
    )
      issues.push(
        error(feature, id, `Invalid classification: "${classification}"`),
      );
    if (!quoteLine) {
      issues.push(error(feature, id, "Missing story text"));
      continue;
    }
    const roleMatch = quoteLine.match(/^As an?\s+(.+?),\s+I want\b/i);
    if (!roleMatch)
      issues.push(
        error(
          feature,
          id,
          'Story doesn\'t follow "As a [role], I want..." format',
        ),
      );
    else if (!ALLOWED_ROLES.includes(normalizeRole(roleMatch[1])))
      issues.push(error(feature, id, `Disallowed role: "${roleMatch[1]}"`));
    if (!/so that\b/i.test(quoteLine))
      issues.push(warn(feature, id, 'Missing "so that" clause'));
    for (const cp of COMPOUND_PATTERNS) {
      if (cp.test(quoteLine)) {
        issues.push(
          warn(
            feature,
            id,
            `Possible compound outcome: "${quoteLine.slice(0, 80)}..."`,
          ),
        );
        break;
      }
    }
    if (criteria.length < 2)
      issues.push(
        warn(
          feature,
          id,
          `Only ${criteria.length} acceptance criteria (expected 2-5)`,
        ),
      );
    else if (criteria.length > 5)
      issues.push(
        warn(
          feature,
          id,
          `${criteria.length} acceptance criteria (expected 2-5)`,
        ),
      );
    const fullText = quoteLine + "\n" + criteria.join("\n");
    for (const { pattern, label } of DETAIL_LEAK_PATTERNS) {
      if (
        pattern.test(fullText) &&
        !DETAIL_ALLOWLIST.some((a) => a.test(fullText))
      ) {
        issues.push(warn(feature, id, `Possible detail leak: ${label}`));
      }
    }
  }
  return issues;
}

function checkCoverage(feature, stories, prdContent) {
  const issues = [];
  const jtbds = extractJTBDs(prdContent);
  for (const jtbd of jtbds) {
    const wantMatch = jtbd.match(/I want to\s+(.+?),\s*so/i);
    if (!wantMatch) continue;
    const keywords = wantMatch[1]
      .toLowerCase()
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            "want",
            "that",
            "this",
            "have",
            "with",
            "from",
            "into",
            "what",
            "does",
            "when",
            "they",
            "than",
            "more",
            "also",
          ].includes(w),
      );
    let best = 0;
    for (const s of stories) {
      const t = (s.quoteLine + " " + s.criteria.join(" ")).toLowerCase();
      const m = keywords.filter((k) => t.includes(k)).length;
      if (m > best) best = m;
    }
    if (best < 2 && keywords.length >= 2)
      issues.push(
        warn(
          feature,
          "-",
          `JTBD may not be covered: "...${wantMatch[1].slice(0, 60)}..."`,
        ),
      );
  }
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  const singleFeature = args.find((a) => !a.startsWith("--"));
  const verbose = args.includes("--verbose") || args.includes("-v");
  console.log(`\n${BOLD}${CYAN}🔍 HL-Stories Linter${RESET}\n`);

  let featureDirs;
  if (singleFeature) {
    if (!fs.existsSync(path.join(FEATURES_DIR, singleFeature))) {
      console.error(`${RED}Feature not found: ${singleFeature}${RESET}`);
      process.exit(1);
    }
    featureDirs = [singleFeature];
  } else {
    featureDirs = fs
      .readdirSync(FEATURES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  const allIssues = [];
  let totalStories = 0,
    totalErrors = 0,
    totalWarns = 0,
    totalInfos = 0;

  for (const feature of featureDirs) {
    const hlPath = path.join(FEATURES_DIR, feature, "HL-STORIES.md");
    if (!fs.existsSync(hlPath)) {
      allIssues.push(error(feature, "-", "HL-STORIES.md not found"));
      continue;
    }
    const content = fs.readFileSync(hlPath, "utf-8");
    const stories = extractStories(content);
    totalStories += stories.length;
    allIssues.push(...checkStories(feature, stories));
    const prdPath = path.join(FEATURES_DIR, feature, "PRD.md");
    if (fs.existsSync(prdPath))
      allIssues.push(
        ...checkCoverage(feature, stories, fs.readFileSync(prdPath, "utf-8")),
      );
  }

  const grouped = {};
  for (const issue of allIssues) {
    if (!grouped[issue.feature]) grouped[issue.feature] = [];
    grouped[issue.feature].push(issue);
  }
  for (const [feature, issues] of Object.entries(grouped)) {
    const errors = issues.filter((i) => i.level === "error");
    const warns = issues.filter((i) => i.level === "warn");
    totalErrors += errors.length;
    totalWarns += warns.length;
    totalInfos += issues.filter((i) => i.level === "info").length;
    if (errors.length === 0 && warns.length === 0 && !verbose) continue;
    const badge =
      errors.length > 0
        ? `${RED}✗${RESET}`
        : warns.length > 0
          ? `${YELLOW}⚠${RESET}`
          : `${GREEN}✓${RESET}`;
    console.log(`${badge} ${BOLD}${feature}${RESET}`);
    for (const issue of issues) {
      if (issue.level === "info" && !verbose) continue;
      const icon =
        issue.level === "error"
          ? `  ${RED}✗${RESET}`
          : issue.level === "warn"
            ? `  ${YELLOW}⚠${RESET}`
            : `  ${DIM}ℹ${RESET}`;
      console.log(
        `${icon}${issue.storyId !== "-" ? ` [${issue.storyId}]` : ""} ${issue.msg}`,
      );
    }
    console.log();
  }

  const cleanFeatures = featureDirs.filter(
    (f) => !grouped[f] || grouped[f].every((i) => i.level === "info"),
  );
  if (cleanFeatures.length > 0 && !verbose)
    console.log(
      `${GREEN}✓${RESET} ${DIM}${cleanFeatures.join(", ")} — clean${RESET}\n`,
    );

  console.log(
    `${BOLD}Summary:${RESET} ${featureDirs.length} features, ${totalStories} stories`,
  );
  console.log(
    `  ${RED}${totalErrors} errors${RESET}  ${YELLOW}${totalWarns} warnings${RESET}  ${DIM}${totalInfos} info${RESET}`,
  );
  if (totalErrors > 0) {
    console.log(`\n${RED}${BOLD}FAIL${RESET}\n`);
    process.exit(1);
  } else if (totalWarns > 0) {
    console.log(`\n${YELLOW}${BOLD}WARN${RESET} — Review warnings.\n`);
    process.exit(0);
  } else {
    console.log(`\n${GREEN}${BOLD}PASS${RESET}\n`);
    process.exit(0);
  }
}

main();
