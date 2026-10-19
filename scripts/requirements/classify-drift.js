
const path = require("path");
const { DRIFT_CLASS } = require("./config");

const CONTRACT_KEYWORDS = [
  "session",
  "auth",
  "authentication",
  "authorization",
  "permission",
  "role",
  "scope",
  "payment",
  "checkout",
  "billing",
  "pricing",
  "tier",
  "subscription",
  "privacy",
  "gdpr",
  "consent",
  "pii",
  "routing",
  "redirect",
  "middleware",
  "csrf",
  "cookie",
  "token",
  "jwt",
];

const GOLDEN_PATH_PATHS = [
  "src/app/page.tsx",
  "src/lib/auth",
  "src/lib/storage",
  "services/backend/src/middleware",
  "services/backend/src/routes/auth",
  "packages/shared/auth",
];

function looksLikeContractTouch(rco) {
  const cap = (s) => (typeof s === "string" ? s.slice(0, 32 * 1024) : "");
  const haystack = [
    ...(rco.changedFiles || []),
    ...(rco.impactedRequirements || []),
    rco.summary || "",
    rco.diffSummary || "",
    cap(rco.oldString),
    cap(rco.newString),
    cap(rco.diffText),
  ]
    .join(" ")
    .toLowerCase();

  if ((rco.sharedContractsTouched || []).length > 0) return true;

  for (const kw of CONTRACT_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(haystack)) return true;
  }
  for (const gp of GOLDEN_PATH_PATHS) {
    if (haystack.includes(gp.toLowerCase())) return true;
  }
  return false;
}

function looksLikeBehaviorChange(rco) {
  const cap = (s) => (typeof s === "string" ? s.slice(0, 16 * 1024) : "");
  const haystack = [
    rco.diffSummary || "",
    cap(rco.oldString),
    cap(rco.newString),
    cap(rco.diffText),
  ]
    .join(" ")
    .toLowerCase();
  const behaviorPatterns = [
    /\broute\b/,
    /\bendpoint\b/,
    /\bstatus\s*code\b/,
    /\benv\s*var\b/,
    /\bschema\b/,
    /\bmigration\b/,
    /\bvalidation\b/,
    /\berror\s*message\b/,
    /\bredirect\b/,
    /\bregex\b/,
  ];
  for (const re of behaviorPatterns) {
    if (re.test(haystack)) return true;
  }
  if (rco.criteriaDiff && rco.criteriaDiff.length > 0) return true;
  return false;
}

function isCrossFeature(rco) {
  const features = new Set(rco.impactedFeatures || []);
  return features.size > 1;
}

function classify(rco) {
  if (looksLikeContractTouch(rco)) return DRIFT_CLASS.C;
  if (isCrossFeature(rco) && (rco.sharedContractsTouched || []).length === 0) {
    return DRIFT_CLASS.B;
  }
  if (looksLikeBehaviorChange(rco)) return DRIFT_CLASS.B;
  return DRIFT_CLASS.A;
}

function recommend(rco, drClass) {
  const recs = {
    recommendedSpecUpdate: null,
    recommendedTestUpdate: null,
    requiresHuman: drClass === DRIFT_CLASS.C,
  };
  if (drClass === DRIFT_CLASS.A) {
    recs.recommendedSpecUpdate = "no_update_needed";
    recs.recommendedTestUpdate = "no_update_needed";
  } else if (drClass === DRIFT_CLASS.B) {
    recs.recommendedSpecUpdate = "update_acceptance_criteria";
    recs.recommendedTestUpdate = "add_or_update_test";
  } else {
    recs.recommendedSpecUpdate = "update_contract_and_dependents";
    recs.recommendedTestUpdate = "add_contract_test";
  }
  return recs;
}

module.exports = {
  classify,
  recommend,
  CONTRACT_KEYWORDS,
};
