#!/usr/bin/env node

"use strict";

const LEVELS = ["auto", "notice", "confirm", "never"];

const LOAD_BEARING_COMMENT =
  "push-to-main: confirm — classifier gate is above permissions.allow " +
  "(empirically proven); this profile entry SURFACES the push requirement, " +
  "it does not satisfy the classifier.";

const PROFILE = {
  spend: {
    level: "auto",
    note: "auto within the session spend ceiling (default $100, operator-raisable) + the $5/op CLAUDE.md line",
  },
  commit: { level: "auto", note: "local commits — reversible, classifier-honored" },
  branch: { level: "auto", note: "branch create/checkout/worktree — classifier-honored" },

  "push-to-main": {
    level: "confirm",
    note: LOAD_BEARING_COMMENT,
  },
  "merge-to-main": {
    level: "confirm",
    note: "merge to the default branch is per-action in practice — the push that lands it is classifier-gated.",
  },

  "force-push-main": { level: "never", note: "forced push to the default branch — never, even with --scope all." },
  "backup-branch-delete": { level: "never", note: "delete backup/* or pre-* branches — never." },
  signup: { level: "never", note: "service signups — never (operator-only)." },
  purchase: { level: "never", note: "purchases — never (operator-only)." },
  secrets: { level: "never", note: "secret exposure — never." },

  deps: { level: "confirm", note: "adding a dependency is a supply-chain surface — confirm, don't auto." },
  auth: { level: "confirm", note: "auth/session changes — confirm." },
  env: { level: "confirm", note: "environment/config changes — confirm." },
  delete: { level: "confirm", note: "destructive deletes of tracked work — confirm." },
  migrate: { level: "confirm", note: "data migrations — confirm." },
  deploy: { level: "confirm", note: "production deploy — confirm." },
};

const MUST_BE_CONFIRM = ["push-to-main", "merge-to-main"];
const MUST_BE_NEVER = [
  "force-push-main",
  "backup-branch-delete",
  "signup",
  "purchase",
  "secrets",
];
const MUST_BE_AUTO = ["spend", "commit", "branch"];

function getProfile() {
  return JSON.parse(JSON.stringify(PROFILE));
}

function validateProfile(profile = PROFILE) {
  const violations = [];
  if (!profile || typeof profile !== "object") {
    return { ok: false, violations: ["profile is not an object"] };
  }

  for (const [scope, entry] of Object.entries(profile)) {
    const level = entry && entry.level;
    if (!LEVELS.includes(level)) {
      violations.push(
        `scope "${scope}" has invalid/absent level "${level}" (must be one of ${LEVELS.join(
          " | ",
        )})`,
      );
    }
  }

  for (const scope of MUST_BE_CONFIRM) {
    const lvl = profile[scope] && profile[scope].level;
    if (lvl === undefined) {
      violations.push(`missing required scope "${scope}" (must be "confirm")`);
    } else if (lvl !== "confirm") {
      violations.push(
        `HONESTY VIOLATION: scope "${scope}" is "${lvl}" but MUST be "confirm" ` +
          `— the classifier sits above permissions.allow (proven); ` +
          `a profile may not claim auto/notice push (overclaim).`,
      );
    }
  }

  for (const scope of MUST_BE_NEVER) {
    const lvl = profile[scope] && profile[scope].level;
    if (lvl !== "never") {
      violations.push(
        `CEILING VIOLATION: scope "${scope}" is "${lvl}" but MUST be "never".`,
      );
    }
  }

  for (const scope of MUST_BE_AUTO) {
    const lvl = profile[scope] && profile[scope].level;
    if (lvl !== "auto") {
      violations.push(
        `scope "${scope}" is "${lvl}" but should be "auto" (classifier-honored within ceilings).`,
      );
    }
  }

  const pushNote = (profile["push-to-main"] && profile["push-to-main"].note) || "";
  if (
    profile["push-to-main"] &&
    profile["push-to-main"].level === "confirm" &&
    !/classifier/i.test(pushNote)
  ) {
    violations.push(
      `scope "push-to-main" is confirm but its note is missing the load-bearing ` +
        `classifier rationale (the entry must explain WHY it cannot be auto).`,
    );
  }

  return { ok: violations.length === 0, violations };
}

function levelFor(scope) {
  const e = PROFILE[String(scope || "").toLowerCase()];
  return e ? e.level : null;
}

function renderProfile() {
  const lines = ["turbo permission profile (auto / notice / confirm / never)", ""];
  const order = ["auto", "notice", "confirm", "never"];
  for (const lvl of order) {
    const scopes = Object.entries(PROFILE).filter(([, e]) => e.level === lvl);
    if (!scopes.length) continue;
    lines.push(`  ${lvl.toUpperCase()}:`);
    for (const [scope, e] of scopes) {
      lines.push(`    ${scope.padEnd(22)} ${e.note}`);
    }
    lines.push("");
  }
  const v = validateProfile();
  lines.push(`  honesty invariant: ${v.ok ? "OK (push-to-main = confirm)" : "VIOLATED"}`);
  if (!v.ok) for (const x of v.violations) lines.push(`    ! ${x}`);
  return lines.join("\n");
}

module.exports = {
  LEVELS,
  PROFILE,
  LOAD_BEARING_COMMENT,
  MUST_BE_CONFIRM,
  MUST_BE_NEVER,
  MUST_BE_AUTO,
  getProfile,
  validateProfile,
  levelFor,
  renderProfile,
};

if (require.main === module) {
  const json = process.argv.includes("--json");
  if (json) {
    process.stdout.write(
      JSON.stringify({ profile: PROFILE, validation: validateProfile() }, null, 2) +
        "\n",
    );
  } else {
    process.stdout.write(renderProfile() + "\n");
  }
  process.exit(validateProfile().ok ? 0 : 1);
}
