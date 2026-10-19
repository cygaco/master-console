
"use strict";

function requiresFallback(provider) {
  return provider !== "claude";
}

function defaultFallback(provider) {
  return requiresFallback(provider) ? "claude" : null;
}

function validateFallback(provider, fallback) {
  if (requiresFallback(provider)) {
    if (!fallback) {
      return {
        ok: false,
        reason: `Fallback is required when provider is "${provider}". Without it, dispatch fails if the ${provider} CLI is missing.`,
      };
    }
    if (fallback === provider) {
      return {
        ok: false,
        reason: "Fallback must differ from primary provider.",
      };
    }
  }
  return { ok: true };
}

module.exports = { requiresFallback, defaultFallback, validateFallback };
