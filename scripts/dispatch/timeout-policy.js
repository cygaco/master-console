"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const FOREGROUND_CEILING_MS = 540000;

const WRAPPER_DEFAULTS = {
  "dispatch-claude": 20 * 60 * 1000,
  "dispatch-skill":  15 * 60 * 1000,
  "epsilon-agent":   15 * 60 * 1000,
  "epsilon-claude":  20 * 60 * 1000,
  "run-provider":    15 * 60 * 1000,
};

function foregroundAwareTimeout(defaultMs, opts) {
  const isBackground =
    (opts != null && opts.background === true) ||
    mcEnv.readEnv("DISPATCH_BACKGROUND") === "1";

  if (isBackground) return defaultMs;
  return Math.min(defaultMs, FOREGROUND_CEILING_MS);
}

module.exports = { FOREGROUND_CEILING_MS, WRAPPER_DEFAULTS, foregroundAwareTimeout };
