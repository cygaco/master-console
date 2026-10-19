"use strict";

const PROFILES = [
  "web-saas",
  "mobile-app",
  "desktop-app",
  "ai-tool",
  "marketplace",
  "content-community",
  "internal-external",
  "self-hosted",
  "unknown",
];

const SIMPLE_MVP = {
  db: "supabase",
  auth: "supabase",
  payments: "stripe-checkout",
  hosting: "vercel",
  analytics: "plausible",
  email: "resend",
};

const DEFAULT_STACKS = {
  "web-saas": {
    db: "supabase-or-neon",
    auth: "clerk-or-supabase",
    payments: "stripe",
    hosting: "vercel",
    analytics: "posthog-or-plausible",
    email: "resend-or-loops",
  },
  "mobile-app": {
    db: "supabase",
    auth: "supabase",
    payments: "stripe-where-supported-else-iap",
    hosting: "eas-build-submit",
    analytics: "posthog",
    email: "resend",
  },
  "desktop-app": {
    db: "sqlite-or-turso",
    auth: "license-keys-or-supabase",
    payments: "stripe-or-license",
    hosting: "signed-builds-auto-update",
    analytics: "posthog",
    email: "resend",
  },
  "ai-tool": {
    db: "supabase",
    auth: "clerk-or-supabase",
    payments: "stripe-usage-or-credit",
    hosting: "vercel",
    analytics: "posthog",
    email: "resend",
  },
  marketplace: {
    db: "postgres-neon",
    auth: "clerk-or-supabase",
    payments: "stripe-connect",
    hosting: "vercel",
    analytics: "posthog",
    email: "resend",
  },
  "content-community": {
    db: "supabase",
    auth: "supabase",
    payments: "stripe-subscription",
    hosting: "vercel",
    analytics: "plausible",
    email: "loops",
  },
  "internal-external": {
    db: "keep-existing",
    auth: "add-auth-boundary",
    payments: "stripe",
    hosting: "keep-existing-or-vercel",
    analytics: "posthog",
    email: "resend",
  },
  "self-hosted": {
    db: "postgres-self-hosted",
    auth: "authjs-or-custom",
    payments: "stripe",
    hosting: "docker-compose-on-vps",
    analytics: "plausible-self-hosted-or-posthog",
    email: "resend",
  },
  unknown: SIMPLE_MVP,
};

function declaredValues(state) {
  const d = state && state.declaredStack;
  if (!d || !d.present || !d.values) return {};
  return d.values;
}

function declaredProfile(values) {
  const v = values || {};
  const hay = [v.framework, v.database, v.auth, v.payments, v.hosting, v.analytics]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return null;
  if (/\b(expo|react native|ios|android|eas)\b/.test(hay)) return "mobile-app";
  if (/\b(electron|tauri|desktop)\b/.test(hay)) return "desktop-app";
  if (/\b(stripe connect|marketplace|seller|vendor)\b/.test(hay)) return "marketplace";
  if (/\b(openai|llm|ai sdk|agents sdk|anthropic|gemini)\b/.test(hay)) return "ai-tool";
  if (/\b(self hosted|self-hosted|docker|vps|compose)\b/.test(hay)) return "self-hosted";
  if (/\b(next|remix|svelte|vue|react|web|vercel|netlify)\b/.test(hay)) return "web-saas";
  return null;
}

function applyDeclaredStack(stack, values) {
  const out = Object.assign({}, stack);
  const applied = [];
  const map = {
    framework: "framework",
    database: "db",
    auth: "auth",
    payments: "payments",
    hosting: "hosting",
    analytics: "analytics",
  };
  for (const [declaredKey, stackKey] of Object.entries(map)) {
    const value = values && values[declaredKey];
    if (!value) continue;
    out[stackKey] = `${value} (declared)`;
    applied.push(`${stackKey}:${value}`);
  }
  return { stack: out, applied };
}

function normProvider(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function includesProvider(declared, detected) {
  const a = normProvider(declared);
  const b = normProvider(detected);
  return !!(a && b && (a.includes(b) || b.includes(a)));
}

function stackDriftEvents(state, values, effectiveProfile, inferredFromDeclared, explicitProfile) {
  const events = [];
  if (explicitProfile && inferredFromDeclared && explicitProfile !== inferredFromDeclared) {
    events.push({
      type: "stack_drift",
      layer: "profile",
      declared: inferredFromDeclared,
      detected: explicitProfile,
      severity: "advisory",
      action: "Explicit --profile override is controlling the last-mile plan.",
    });
  }
  const pairs = [
    ["framework", values.framework, state && state.framework],
    ["database", values.database, state && state.persistence && state.persistence.provider],
    ["auth", values.auth, state && state.auth && state.auth.provider],
    ["payments", values.payments, state && state.payments && state.payments.provider],
    ["hosting", values.hosting, state && state.deploy && state.deploy.target],
    ["analytics", values.analytics, state && state.analytics && state.analytics.provider],
  ];
  for (const [layer, declared, detected] of pairs) {
    if (declared && detected && detected !== "unknown" && !includesProvider(declared, detected)) {
      events.push({
        type: "stack_drift",
        layer,
        declared,
        detected,
        severity: "warning",
        action: "Review the implementation or revise the canonical Tech Stack declaration.",
      });
    }
  }
  if (events.length && effectiveProfile) {
    for (const e of events) e.profile = effectiveProfile;
  }
  return events;
}

function inferProfile(state) {
  if (!state) return "unknown";
  const fromDeclared = declaredProfile(declaredValues(state));
  if (fromDeclared) return fromDeclared;
  if (state.platform === "mobile") return "mobile-app";
  if (state.platform === "desktop") return "desktop-app";
  const selfHostedDb =
    state.persistence && state.persistence.hostingModel === "self-hosted";
  const noManagedTarget = !(state.deploy && state.deploy.target);
  if (selfHostedDb && noManagedTarget &&
      (state.framework === "nextjs" || state.platform === "web" || state.platform === "unknown")) {
    return "self-hosted";
  }
  if (state.framework === "nextjs" || state.platform === "web") {
    return "web-saas";
  }
  return "unknown";
}

function recommendStack(profile, state) {
  const declared = declaredValues(state);
  const inferredFromDeclared = declaredProfile(declared);
  const p = PROFILES.includes(profile) ? profile : inferProfile(state);
  const base = DEFAULT_STACKS[p] || SIMPLE_MVP;
  const declaredApplied = applyDeclaredStack(base, declared);
  const stack = Object.assign({}, declaredApplied.stack);
  const kept = [];
  const assumptions = [];
  const declaredStack = declaredApplied.applied;

  if (state) {
    if (state.persistence && state.persistence.provider) {
      stack.db = state.persistence.provider + " (existing)";
      kept.push(`db:${state.persistence.provider}`);
    }
    if (state.auth && state.auth.provider) {
      stack.auth = state.auth.provider + " (existing)";
      kept.push(`auth:${state.auth.provider}`);
    }
    if (state.payments && state.payments.provider) {
      stack.payments = state.payments.provider + " (existing)";
      kept.push(`payments:${state.payments.provider}`);
    }
    if (state.deploy && state.deploy.target) {
      stack.hosting = state.deploy.target + " (existing)";
      kept.push(`hosting:${state.deploy.target}`);
    }
    if (state.analytics && state.analytics.provider) {
      stack.analytics = state.analytics.provider + " (existing)";
      kept.push(`analytics:${state.analytics.provider}`);
    }
    if (state.email && state.email.provider) {
      stack.email = state.email.provider + " (existing)";
      kept.push(`email:${state.email.provider}`);
    }
  }

  if (!profile || !PROFILES.includes(profile)) {
    assumptions.push(`profile inferred as "${p}" from repo state (no --profile given)`);
  }
  if (inferredFromDeclared && (!profile || !PROFILES.includes(profile))) {
    assumptions.push(`profile inference used declared Tech Stack (${state.declaredStack.source})`);
  }
  if (state && state.declaredStack && state.declaredStack.present && !state.declaredStack.ok) {
    assumptions.push(`declared Tech Stack is present but invalid: ${(state.declaredStack.errors || []).join("; ")}`);
  }

  const rationale =
    `Profile "${p}": shortest safe path to paid launch. ` +
    `Defaults bias to easy setup, strong docs, low ops. ` +
    (declaredStack.length ? `Declared stack: ${declaredStack.join(", ")}. ` : "") +
    (kept.length ? `Keeping existing: ${kept.join(", ")}.` : "Greenfield last-mile stack.");

  const drift = stackDriftEvents(state, declared, p, inferredFromDeclared, PROFILES.includes(profile) ? profile : null);
  return { profile: p, stack, kept, declaredStack, stackDrift: drift, rationale, assumptions };
}

module.exports = { PROFILES, DEFAULT_STACKS, SIMPLE_MVP, inferProfile, recommendStack, declaredProfile, stackDriftEvents };
