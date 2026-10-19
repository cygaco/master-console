#!/usr/bin/env node

"use strict";

const ALLOWED_RECIPE_KINDS = Object.freeze([
  "set_env_and_reprobe",
  "retry_with_same_timeout",
]);

const ALLOWED_ENV_KEYS = Object.freeze([]);

const FORBIDDEN_ENV_SUBSTRINGS = Object.freeze([
  "API_KEY",
  "TOKEN",
  "SECRET",
  "AUTH",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "OAUTH",
  "SESSION",
  "BEARER",
]);

function isAuthMutatingEnvKey(key) {
  if (typeof key !== "string") return true;
  const upper = key.toUpperCase();
  return FORBIDDEN_ENV_SUBSTRINGS.some((s) => upper.includes(s));
}

function truncateReason(s) {
  if (typeof s !== "string") return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

function applySetEnvAndReprobe(recipe) {
  if (!recipe || typeof recipe !== "object") {
    return { ok: false, skipped_reason: "recipe_invalid" };
  }
  if (recipe.scope !== "process") {
    return { ok: false, skipped_reason: "recipe_scope_not_process" };
  }
  if (!recipe.env || typeof recipe.env !== "object") {
    return { ok: false, skipped_reason: "recipe_env_missing" };
  }
  const envKeys = Object.keys(recipe.env);
  if (envKeys.length === 0) {
    return { ok: false, skipped_reason: "recipe_env_empty" };
  }
  for (const k of envKeys) {
    if (!ALLOWED_ENV_KEYS.includes(k)) {
      return { ok: false, skipped_reason: "env_key_not_allowed: " + k };
    }
    if (isAuthMutatingEnvKey(k)) {
      return { ok: false, skipped_reason: "env_key_auth_mutating: " + k };
    }
    const v = recipe.env[k];
    if (typeof v !== "string") {
      return { ok: false, skipped_reason: "env_value_not_string: " + k };
    }
  }
  for (const k of envKeys) {
    process.env[k] = recipe.env[k];
  }
  return { ok: true };
}

function applyRetryWithSameTimeout(recipe) {
  if (!recipe || typeof recipe !== "object") {
    return { ok: false, skipped_reason: "recipe_invalid" };
  }
  return { ok: true };
}

function runAutofixes(args) {
  args = args || {};
  const rca = Array.isArray(args.rca) ? args.rca : [];
  const probeOne = typeof args.probeOne === "function" ? args.probeOne : null;
  const logFn = typeof args.log === "function" ? args.log : null;
  const noAutofix = !!args.noAutofix;
  const print =
    typeof args.print === "function"
      ? args.print
      : (s) => {
          process.stdout.write(s);
        };

  if (noAutofix) {
    if (rca.some((e) => e && e.safe_to_autofix === true)) {
      print("Auto-fix skipped (--no-autofix)\n");
    }
    return [];
  }

  if (!probeOne) {
    if (logFn) {
      try {
        logFn("audit", {
          type: "autofix",
          action: "provider-autofix-skipped",
          reason: "probeOne_missing",
        });
      } catch (e) {
      }
    }
    return [];
  }

  const out = [];

  for (const e of rca) {
    if (!e || typeof e !== "object") continue;
    if (e.safe_to_autofix !== true) continue;

    const provider = e.provider;
    const originalStatus = e.status;
    const recipe = e.fix_recipe;
    const recipeKind = recipe && recipe.kind;

    if (!ALLOWED_RECIPE_KINDS.includes(recipeKind)) {
      const rec = {
        provider: provider,
        original_status: originalStatus,
        fix_recipe_kind: recipeKind || null,
        applied: false,
        success: false,
        reprobe_status: null,
        reason: null,
        skipped_reason: "unknown_recipe_kind",
      };
      out.push(rec);
      if (logFn) {
        try {
          logFn("audit", {
            type: "autofix",
            action: "provider-autofix-skipped",
            provider: provider,
            original_status: originalStatus,
            fix_recipe_kind: recipeKind || null,
            applied: false,
            success: false,
            reason: "unknown_recipe_kind",
          });
        } catch (err) {
        }
      }
      continue;
    }

    let applyResult;
    if (recipeKind === "set_env_and_reprobe") {
      applyResult = applySetEnvAndReprobe(recipe);
    } else if (recipeKind === "retry_with_same_timeout") {
      applyResult = applyRetryWithSameTimeout(recipe);
    } else {
      applyResult = { ok: false, skipped_reason: "unknown_recipe_kind" };
    }

    if (!applyResult.ok) {
      const rec = {
        provider: provider,
        original_status: originalStatus,
        fix_recipe_kind: recipeKind,
        applied: false,
        success: false,
        reprobe_status: null,
        reason: null,
        skipped_reason: applyResult.skipped_reason,
      };
      out.push(rec);
      if (logFn) {
        try {
          logFn("audit", {
            type: "autofix",
            action: "provider-autofix-skipped",
            provider: provider,
            original_status: originalStatus,
            fix_recipe_kind: recipeKind,
            applied: false,
            success: false,
            reason: applyResult.skipped_reason,
          });
        } catch (err) {
        }
      }
      continue;
    }

    let reprobe;
    try {
      reprobe = probeOne(provider, {});
    } catch (err) {
      reprobe = {
        provider: provider,
        status: "unknown_error",
        reason:
          "reprobe_threw: " + (err && err.message ? err.message : String(err)),
      };
    }
    const reprobeStatus =
      reprobe && typeof reprobe.status === "string"
        ? reprobe.status
        : "unknown_error";
    const success = reprobeStatus === "ok";

    print(
      "Auto-fix: " +
        provider +
        "." +
        originalStatus +
        " -> recipe " +
        recipeKind +
        "\n",
    );
    print("  re-probe: " + (success ? "ok" : reprobeStatus) + "\n");

    const rec = {
      provider: provider,
      original_status: originalStatus,
      fix_recipe_kind: recipeKind,
      applied: true,
      success: success,
      reprobe_status: reprobeStatus,
      reason: truncateReason(reprobe && reprobe.reason),
      skipped_reason: null,
    };
    out.push(rec);

    if (logFn) {
      try {
        logFn("audit", {
          type: "autofix",
          action: "provider-autofix-attempted",
          provider: provider,
          original_status: originalStatus,
          fix_recipe_kind: recipeKind,
          applied: true,
          success: success,
          reprobe_status: reprobeStatus,
        });
      } catch (err) {
      }
    }
  }

  return out;
}

module.exports = {
  runAutofixes: runAutofixes,
  ALLOWED_RECIPE_KINDS: ALLOWED_RECIPE_KINDS,
  ALLOWED_ENV_KEYS: ALLOWED_ENV_KEYS,
  FORBIDDEN_ENV_SUBSTRINGS: FORBIDDEN_ENV_SUBSTRINGS,
  isAuthMutatingEnvKey: isAuthMutatingEnvKey,
  _applySetEnvAndReprobe: applySetEnvAndReprobe,
  _applyRetryWithSameTimeout: applyRetryWithSameTimeout,
};
