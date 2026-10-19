
const VALID_PREFIXES = ["pass", "done", "impossible"];

const INVALID_PREFIXES = [
  "pending",
  "skipped",
  "running",
  "codex-pending",
  "fail",
];

function validateGateCheck(entry) {
  const issues = [];

  if (!entry) {
    return { valid: false, issues: ["Entry is null/undefined"] };
  }

  const reviewerVerdict = entry.reviewer || entry.evaluator;
  const hasAnyReviewer = reviewerVerdict || entry.security || entry.compliance;
  if (!hasAnyReviewer) {
    issues.push(
      "GATE_CHECK has no reviewer fields (reviewer/security/compliance)",
    );
  }

  for (const field of ["reviewer", "security", "compliance"]) {
    const val = field === "reviewer" ? reviewerVerdict : entry[field];
    if (!val) continue;

    const lower = String(val).toLowerCase();

    for (const prefix of INVALID_PREFIXES) {
      if (lower.startsWith(prefix)) {
        issues.push(
          `${field}="${val}" starts with invalid prefix "${prefix}". ` +
            `Must be: ${VALID_PREFIXES.join(", ")}`,
        );
        break;
      }
    }

    const isValid = VALID_PREFIXES.some((p) => lower.startsWith(p));
    const isInvalid = INVALID_PREFIXES.some((p) => lower.startsWith(p));
    if (!isValid && !isInvalid) {
      issues.push(
        `${field}="${val}" has unknown prefix. Expected: ${VALID_PREFIXES.join(", ")}`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

function isPassingStatus(val) {
  if (!val || typeof val !== "string") return false;
  const lower = val.toLowerCase();
  return VALID_PREFIXES.some((p) => lower.startsWith(p));
}

function hashGateCheck(entry) {
  const crypto = require("crypto");
  const normalized = JSON.stringify({
    feature: entry.feature || "",
    phase: entry.phase || "",
    reviewer: entry.reviewer || entry.evaluator || "",
    security: entry.security || "",
    compliance: entry.compliance || "",
  });
  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
}

module.exports = {
  validateGateCheck,
  isPassingStatus,
  hashGateCheck,
  VALID_PREFIXES,
  INVALID_PREFIXES,
};
