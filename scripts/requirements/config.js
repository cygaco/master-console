
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SPECS_ROOT =
  PATHS.specsRoot || path.join(REPO_ROOT, "requirements", "04-features");
const REQUIREMENTS_ROOT =
  PATHS.requirementsRoot || path.join(REPO_ROOT, "requirements");
const INDEX_DIR = path.join(REQUIREMENTS_ROOT, "_index");
const CONTRACTS_DIR = path.join(
  REQUIREMENTS_ROOT,
  "04-architecture",
  "contracts",
);

const GRAPH_FILE = path.join(INDEX_DIR, "requirements.graph.json");
const STATUS_FILE = path.join(INDEX_DIR, "requirements.status.json");
const COVERAGE_FILE = path.join(INDEX_DIR, "requirements.coverage.json");
const STAGED_FILE =
  PATHS.requirementsStagedFile ||
  path.join(
    REPO_ROOT,
    ".claude",
    "project",
    "events",
    "requirements-staged.jsonl",
  );

const ID_PATTERNS = {
  granularStory: /\bGS-([A-Z][A-Z0-9]{1,12})-(\d{2,3})\b/g,
  highLevelStory: /\bHL-([A-Z][A-Z0-9]{1,12})-(\d{2,3})\b/g,
  crossStandard: /\bCS-(\d{3})\b/g,
  reqStandard: /\bREQ-([a-z0-9-]+)-([a-z0-9-]+)-(\d{3})\b/g,
};

const VERIFICATION_STATUS = Object.freeze({
  VERIFIED_BY_TEST: "verified_by_test",
  VERIFIED_BY_MANUAL_CHECK: "verified_by_manual_check",
  UNVERIFIED_ALLOWED_TEMPORARILY: "unverified_allowed_temporarily",
  DEPRECATED: "deprecated",
  STALE_PENDING_REVIEW: "stale_pending_review",
});

const LIFECYCLE_STATUS = Object.freeze({
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  REPLACED: "replaced",
  PROPOSED: "proposed",
});

const DRIFT_CLASS = Object.freeze({
  A: "A",
  B: "B",
  C: "C",
});

function listFeatureDirs() {
  const fs = require("fs");
  if (!fs.existsSync(SPECS_ROOT)) return [];
  return fs
    .readdirSync(SPECS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

module.exports = {
  REPO_ROOT,
  SPECS_ROOT,
  REQUIREMENTS_ROOT,
  INDEX_DIR,
  CONTRACTS_DIR,
  GRAPH_FILE,
  STATUS_FILE,
  COVERAGE_FILE,
  STAGED_FILE,
  ID_PATTERNS,
  VERIFICATION_STATUS,
  LIFECYCLE_STATUS,
  DRIFT_CLASS,
  listFeatureDirs,
};
