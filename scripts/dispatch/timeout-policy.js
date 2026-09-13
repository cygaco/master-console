"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * timeout-policy.js — Foreground-aware timeout policy for dispatch wrappers.
 *
 * Fixes the doogle-class G8/N1 defect: every wrapper's DEFAULT bound exceeded the
 * harness FOREGROUND Bash ceiling (600s), so a foreground wrapper was killed by the
 * harness BEFORE its own bound fired — meaning it never wrote its death record. The
 * "loud death record" layer silently degraded to the backstop only.
 *
 * THE FIX — foregroundAwareTimeout (β-ratified, T-20260610-304):
 *   - A FOREGROUND_CEILING_MS constant (540s — 60s headroom under the 600s harness kill)
 *     so the wrapper's bound fires BEFORE the harness kill and the death record is written.
 *   - FAIL-CLOSED detection: treat the dispatch as FOREGROUND (→ clamp to 540s) UNLESS
 *     an explicit background signal is present. Absence of the signal ⇒ clamp. This
 *     prevents a detection gap from silently re-opening the doogle class.
 *   - Background dispatches (real builder runs > 540s) keep their full bound via the
 *     explicit MC_DISPATCH_BACKGROUND=1 signal or opts.background === true.
 *
 * WRAPPER_DEFAULTS — the canonical per-wrapper raw bounds (the *requested* bound before
 * the foreground ceiling is applied). Each wrapper imports this so the sanity check and
 * the wrappers always agree on the same defaults. Changing a default here is the one
 * place to edit.
 *
 * NOTE on env overrides (DISPATCH_BUILDER_TIMEOUT_MS / DISPATCH_SKILL_TIMEOUT_MS):
 *   An env override sets the *requested* bound but the foreground ceiling is the hard
 *   cap. A caller that genuinely needs >540s MUST set MC_DISPATCH_BACKGROUND=1 —
 *   the honest signal that they've backgrounded the dispatch. Without that signal, any
 *   requested bound above 540s is clamped (fail-closed).
 *
 * Wired into:
 *   scripts/dispatch-claude.js   (DISPATCH_CLAUDE route)
 *   scripts/dispatch-skill.js    (DISPATCH_SKILL route)
 *   scripts/sprint/epsilon-runtime.js  (spawnAgent — both DISPATCH_AGENT + DISPATCH_CLAUDE)
 * Verified by:
 *   scripts/checks/dispatch-timeout-sanity.js  (standalone, report-only)
 *   scripts/checks/dispatch-timeout-sanity.test.js  (planted-violation + fail-closed tests)
 */

// 540s — 60s headroom under the 600s harness Bash-tool kill so the wrapper's own
// bound fires BEFORE the harness kills it, giving it time to write the death record.
const FOREGROUND_CEILING_MS = 540000;

/**
 * Canonical per-wrapper raw (requested) bounds.
 * These are imported by each wrapper AND by the sanity check to ensure both
 * agree on the same values (single source of truth).
 *
 * Background dispatches (real builders running > 540s) need these full values —
 * they are NOT clamped when an explicit background signal is present.
 */
const WRAPPER_DEFAULTS = {
  "dispatch-claude": 20 * 60 * 1000, // 20 min — builders are heavier
  "dispatch-skill":  15 * 60 * 1000, // 15 min
  "epsilon-agent":   15 * 60 * 1000, // 15 min — spawnAgent DISPATCH_AGENT route
  "epsilon-claude":  20 * 60 * 1000, // 20 min — spawnAgent DISPATCH_CLAUDE route
  // Gauntlet fix-cycle (claude backend lane, 2026-06-10): runProvider — the
  // cross-provider spawn in scripts/hooks/lib/providers.js — was the FOURTH
  // wrapper named by NOTAGAIN audit G8 and the W0 build missed it (the exact
  // fix-all-callers law this epic exists to mechanize). Same 15-min raw bound,
  // same foreground clamp.
  "run-provider":    15 * 60 * 1000, // 15 min — providers.js runProvider (cross-provider route)
};

/**
 * foregroundAwareTimeout(defaultMs, opts) -> number
 *
 * Returns the EFFECTIVE timeout bound for a dispatch.
 *
 * FAIL-CLOSED design: defaults to the SAFE (clamped) bound when the
 * foreground/background mode CANNOT be determined. Concretely, clamp to
 * FOREGROUND_CEILING_MS UNLESS an explicit background signal is present:
 *   1. opts.background === true   (caller set it explicitly)
 *   2. mcEnv.readEnv("DISPATCH_BACKGROUND") === "1"
 * ABSENCE of either signal ⇒ clamp (NOT the longer default).
 *
 * @param {number} defaultMs  The raw requested bound (e.g. from WRAPPER_DEFAULTS or an env override).
 * @param {object} opts       Optional. Set opts.background=true for an explicit background dispatch.
 * @returns {number}          Effective bound in milliseconds (≤ FOREGROUND_CEILING_MS when foreground).
 */
function foregroundAwareTimeout(defaultMs, opts) {
  const isBackground =
    (opts != null && opts.background === true) ||
    mcEnv.readEnv("DISPATCH_BACKGROUND") === "1";

  if (isBackground) return defaultMs;
  return Math.min(defaultMs, FOREGROUND_CEILING_MS);
}

module.exports = { FOREGROUND_CEILING_MS, WRAPPER_DEFAULTS, foregroundAwareTimeout };
