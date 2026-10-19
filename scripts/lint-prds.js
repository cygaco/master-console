#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./hooks/lib/paths");

const ROOT = PROJECT;
const FEATURES_DIR = PATHS.specsRoot || path.join(ROOT, "requirements", "04-features");
const SRC_DIR = path.join(ROOT, "src");

const REQUIRED_SECTIONS = [
  "1. Title + Classification",
  "2. Screen",
  "3. Context",
  "4. JTBD (Jobs To Be Done)",
  "5. Emotional Framing",
  "6. Goals",
  "7. Assumptions",
  "8. Feature Description",
  "9. Dependencies / Blockers",
  "10. Usage Cost",
  "11. Scoring Impact",
  "12. UI Reference",
  "13. Implementation Map",
  "14. Test Plan",
  "15. Out of Scope",
  "16. Open Questions",
];

const SECTION_ALIASES = {
  "open questions": "decisions",
};

const BEFORE_AFTER_PATTERNS = [
  /\bcurrently\b/i,
  /\bbefore this\b/i,
  /\bafter this\b/i,
  /\bpreviously\b/i,
  /\bused to\b/i,
  /\bwill now\b/i,
  /\binstead of\b/i,
  /\breplaces?\b/i,
  /\bno longer\b/i,
  /\bnew(?:ly)?\s+(?:added|introduced|implemented)\b/i,
  /\bupgraded?\b/i,
  /\bmigrat(?:ed?|ing)\b/i,
];

const BEFORE_AFTER_ALLOWLIST = [
  /before (?:each|every|any|the user|submitting|clicking|applying|starting|generating)/i,
  /after (?:each|every|any|the user|completing|clicking|parsing|confirming|generating|payment)/i,
  /currently (?:employed|available|active)/i,
  /replace(?:s|ment)? (?:text|content|all|the)/i,
];

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function error(feature, msg) {
  return { level: "error", feature, msg };
}
function warn(feature, msg) {
  return { level: "warn", feature, msg };
}
function info(feature, msg) {
  return { level: "info", feature, msg };
}

function extractSections(content) {
  const sections = {};
  const lines = content.replace(/\r/g, "").split("\n");
  let currentSection = null;
  let currentBody = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(\d+)\.\s+(.+?)(?:\s+`\[.*\]`)?$/);
    if (match) {
      if (currentSection) {
        sections[currentSection] = currentBody.join("\n").trim();
      }
      currentSection = `${match[1]}. ${match[2].trim()}`;
      currentBody = [];
    } else if (currentSection) {
      currentBody.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = currentBody.join("\n").trim();
  }
  return sections;
}

function extractFilePaths(text) {
  const paths = [];
  const backtickMatches = text.matchAll(/`(src\/[^`]+)`/g);
  for (const m of backtickMatches) {
    paths.push(m[1]);
  }
  return [...new Set(paths)];
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function getAllSrcFiles() {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else {
        results.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  }
  if (fs.existsSync(SRC_DIR)) walk(SRC_DIR);
  return results;
}

function checkStructural(feature, content, sections) {
  const issues = [];

  for (const req of REQUIRED_SECTIONS) {
    const sectionName = req.replace(/^\d+\.\s+/, "").toLowerCase();
    const alias = SECTION_ALIASES[sectionName];
    const found = Object.keys(sections).some((k) => {
      const actual = k.replace(/^\d+\.\s+/, "").toLowerCase();
      return actual === sectionName || actual === alias;
    });
    if (!found) {
      issues.push(error(feature, `Missing section: ## ${req}`));
    }
  }

  for (const [name, body] of Object.entries(sections)) {
    if (!body || body.trim().length === 0) {
      issues.push(
        error(
          feature,
          `Section "${name}" is empty — use n/a if not applicable`,
        ),
      );
    }
  }

  const titleSection = sections["1. Title + Classification"] || "";
  if (!/\bMVP\b/.test(titleSection) && !/\bPost-MVP\b/.test(titleSection)) {
    issues.push(
      error(
        feature,
        "Section 1 missing classification: must contain 'MVP' or 'Post-MVP'",
      ),
    );
  }

  const jtbd =
    sections["4. JTBD (Jobs To Be Done)"] || sections["4. JTBD"] || "";
  if (jtbd && jtbd !== "n/a") {
    const jtbdBlocks = jtbd.split(/\n>\s*\n/).filter(Boolean);
    const rawQuotes = jtbd.match(/^>\s*.+/gm) || [];

    let combinedQuotes = [];
    let current = "";
    for (const line of jtbd.split("\n")) {
      if (line.match(/^>\s+When\b/i)) {
        if (current) combinedQuotes.push(current);
        current = line.replace(/^>\s*/, "");
      } else if (line.match(/^>\s+/) && current) {
        current += " " + line.replace(/^>\s*/, "");
      } else if (current) {
        combinedQuotes.push(current);
        current = "";
      }
    }
    if (current) combinedQuotes.push(current);

    if (combinedQuotes.length === 0) {
      issues.push(
        error(
          feature,
          "JTBD section has no blockquoted jobs (use > When ... format)",
        ),
      );
    }
    for (const quote of combinedQuotes) {
      if (!/when\b/i.test(quote)) {
        issues.push(
          warn(feature, `JTBD missing "When": "${quote.slice(0, 60)}..."`),
        );
      }
      if (!/i want\b/i.test(quote)) {
        issues.push(
          warn(
            feature,
            `JTBD missing "I want [to]": "${quote.slice(0, 60)}..."`,
          ),
        );
      }
      if (!/so I can\b/i.test(quote)) {
        issues.push(
          warn(feature, `JTBD missing "so I can": "${quote.slice(0, 60)}..."`),
        );
      }
    }
  }

  const emo = sections["5. Emotional Framing"] || "";
  if (emo && emo !== "n/a") {
    if (!/entry/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **Entry** state"));
    if (!/during/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **During** state"));
    if (!/exit/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **Exit** state"));
  }

  const featureDesc = sections["8. Feature Description"] || "";
  if (featureDesc) {
    for (const pattern of BEFORE_AFTER_PATTERNS) {
      const matches = featureDesc.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        for (const match of matches) {
          const context = featureDesc.slice(
            Math.max(0, featureDesc.indexOf(match) - 30),
            featureDesc.indexOf(match) + match.length + 30,
          );
          const allowed = BEFORE_AFTER_ALLOWLIST.some((a) => a.test(context));
          if (!allowed) {
            issues.push(
              warn(
                feature,
                `Feature Description may contain before/after language: "${match}" in "...${context.trim()}..."`,
              ),
            );
          }
        }
      }
    }
  }

  if (/\bas a (?:user|developer|admin)\b/i.test(content)) {
    issues.push(
      warn(
        feature,
        "PRD may contain embedded user stories (found 'As a user/...' pattern). Stories belong in separate files.",
      ),
    );
  }

  const goals = sections["6. Goals"] || "";
  const vaguePatterns = [
    /\bimprove\b/i,
    /\benhance\b/i,
    /\bbetter\b/i,
    /\bgood\b/i,
  ];
  for (const vp of vaguePatterns) {
    if (vp.test(goals)) {
      issues.push(
        warn(
          feature,
          `Goals section contains vague language: "${goals.match(vp)?.[0]}". Goals should be concrete and measurable.`,
        ),
      );
    }
  }

  return issues;
}

function checkFilePaths(feature, sections) {
  const issues = [];

  const implMap = sections["13. Implementation Map"] || "";
  const implPaths = extractFilePaths(implMap);
  for (const p of implPaths) {
    if (!fileExists(p)) {
      const lineWithPath = implMap.split("\n").find((l) => l.includes(p));
      if (lineWithPath && /\bnew\b/i.test(lineWithPath)) {
        issues.push(
          info(feature, `Implementation Map: ${p} marked as new file (OK)`),
        );
      } else {
        issues.push(
          error(
            feature,
            `Implementation Map references non-existent file: ${p}`,
          ),
        );
      }
    }
  }

  return issues;
}

function checkCrossPRD(allPRDs) {
  const issues = [];

  const fileClaims = {};
  for (const [feature, { sections }] of Object.entries(allPRDs)) {
    const implMap = sections["13. Implementation Map"] || "";
    const rows = implMap
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.includes("---"));
    for (const row of rows) {
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) {
        const filePaths = extractFilePaths("`" + cells[0] + "`");
        for (const fp of filePaths) {
          if (!fileClaims[fp]) fileClaims[fp] = [];
          fileClaims[fp].push({ feature, change: cells[1] });
        }
      }
    }
  }

  for (const [fp, claims] of Object.entries(fileClaims)) {
    if (claims.length > 1) {
      const features = claims.map((c) => c.feature).join(", ");
      issues.push(
        info(
          "CROSS-PRD",
          `${fp} claimed more than once across PRDs: ${features}. Verify changes don't conflict.`,
        ),
      );
    }
  }

  const deps = {};
  for (const [feature, { sections }] of Object.entries(allPRDs)) {
    const depSection = sections["9. Dependencies / Blockers"] || "";
    deps[feature] = [];
    for (const [otherFeature] of Object.entries(allPRDs)) {
      if (otherFeature !== feature) {
        const featureWords = otherFeature.replace(/-/g, " ");
        if (
          depSection.toLowerCase().includes(featureWords) ||
          depSection.toLowerCase().includes(otherFeature)
        ) {
          deps[feature].push(otherFeature);
        }
      }
    }
  }

  const KNOWN_CODEPS = new Set([]);

  function hasCycle(node, visited, stack) {
    visited.add(node);
    stack.add(node);
    for (const dep of deps[node] || []) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return true;
      } else if (stack.has(dep)) {
        const pair = `${node}:${dep}`;
        if (KNOWN_CODEPS.has(pair)) {
          issues.push(
            info("CROSS-PRD", `Known co-dependency: ${node} ↔ ${dep} (OK)`),
          );
        } else {
          issues.push(
            error(
              "CROSS-PRD",
              `Circular dependency detected: ${node} → ${dep}`,
            ),
          );
        }
        return true;
      }
    }
    stack.delete(node);
    return false;
  }

  const visited = new Set();
  for (const feature of Object.keys(deps)) {
    if (!visited.has(feature)) {
      hasCycle(feature, visited, new Set());
    }
  }

  return issues;
}

function checkCodeDrift(allPRDs) {
  const issues = [];

  const claimedFiles = new Set();
  for (const [, { sections }] of Object.entries(allPRDs)) {
    const im = sections["13. Implementation Map"] || "";
    for (const p of extractFilePaths(im)) claimedFiles.add(p);
  }

  const allSrcFiles = getAllSrcFiles();

  const keyPatterns = [
    /^src\/components\/steps\//,
    /^src\/components\/pages\//,
    /^src\/lib\/[^/]+\.ts$/,
    /^src\/app\/api\//,
  ];

  for (const srcFile of allSrcFiles) {
    const isKey = keyPatterns.some((p) => p.test(srcFile));
    if (isKey && !claimedFiles.has(srcFile)) {
      if (srcFile.endsWith(".test.ts") || srcFile.endsWith(".d.ts")) continue;
      if (srcFile.endsWith(".css")) continue;
      const infraFiles = [
        "src/lib/pipeline.ts",
        "src/lib/validators.ts",
        "src/app/api/test/route.ts",
      ];
      if (infraFiles.includes(srcFile)) continue;
      issues.push(
        warn("CODE-DRIFT", `Source file not claimed by any PRD: ${srcFile}`),
      );
    }
  }

  return issues;
}

function main() {
  const args = process.argv.slice(2);
  const singleFeature = args.find((a) => !a.startsWith("--"));
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log(`\n${BOLD}${CYAN}🔍 PRD Linter${RESET}\n`);

  let featureDirs;
  if (singleFeature) {
    const dir = path.join(FEATURES_DIR, singleFeature);
    if (!fs.existsSync(dir)) {
      console.error(`${RED}Feature not found: ${singleFeature}${RESET}`);
      process.exit(1);
    }
    featureDirs = [singleFeature];
  } else {
    featureDirs = fs.existsSync(FEATURES_DIR)
      ? fs
          .readdirSync(FEATURES_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];
  }

  const allPRDs = {};
  const allIssues = [];
  let totalErrors = 0;
  let totalWarns = 0;
  let totalInfos = 0;

  for (const feature of featureDirs) {
    const prdPath = path.join(FEATURES_DIR, feature, "PRD.md");
    if (!fs.existsSync(prdPath)) {
      allIssues.push(error(feature, "PRD.md not found"));
      continue;
    }

    const content = fs.readFileSync(prdPath, "utf-8");
    const sections = extractSections(content);
    allPRDs[feature] = { content, sections };

    const structIssues = checkStructural(feature, content, sections);
    const fileIssues = checkFilePaths(feature, sections);
    allIssues.push(...structIssues, ...fileIssues);
  }

  if (!singleFeature) {
    const crossIssues = checkCrossPRD(allPRDs);
    allIssues.push(...crossIssues);

    const driftIssues = checkCodeDrift(allPRDs);
    allIssues.push(...driftIssues);
  }

  const grouped = {};
  for (const issue of allIssues) {
    if (!grouped[issue.feature]) grouped[issue.feature] = [];
    grouped[issue.feature].push(issue);
  }

  for (const [feature, issues] of Object.entries(grouped)) {
    const errors = issues.filter((i) => i.level === "error");
    const warns = issues.filter((i) => i.level === "warn");
    const infos = issues.filter((i) => i.level === "info");

    totalErrors += errors.length;
    totalWarns += warns.length;
    totalInfos += infos.length;

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
      console.log(`${icon} ${issue.msg}`);
    }
    console.log();
  }

  if (!singleFeature) {
    const cleanFeatures = featureDirs.filter(
      (f) => !grouped[f] || grouped[f].every((i) => i.level === "info"),
    );
    if (cleanFeatures.length > 0 && !verbose) {
      console.log(
        `${GREEN}✓${RESET} ${DIM}${cleanFeatures.join(", ")} — clean${RESET}\n`,
      );
    }
  }

  console.log(`${BOLD}Summary:${RESET} ${featureDirs.length} PRDs scanned`);
  console.log(
    `  ${RED}${totalErrors} errors${RESET}  ${YELLOW}${totalWarns} warnings${RESET}  ${DIM}${totalInfos} info${RESET}`,
  );

  if (totalErrors > 0) {
    console.log(
      `\n${RED}${BOLD}FAIL${RESET} — Fix errors before proceeding.\n`,
    );
    process.exit(1);
  } else if (totalWarns > 0) {
    console.log(
      `\n${YELLOW}${BOLD}WARN${RESET} — Review warnings. May be false positives.\n`,
    );
    process.exit(0);
  } else {
    console.log(`\n${GREEN}${BOLD}PASS${RESET} — All PRDs valid.\n`);
    process.exit(0);
  }
}

main();
