"use strict";

const REQUIRED_SCOPE_TERMS = [/artifact-verification/i, /integration-to-main|integration into `?main`?/i];
const REQUIRED_EXCLUSION_TERMS = [/capability grant/i, /protected mutation/i];
const EXCLUSION_MARKER_RE = /NOT\s+(?:covered|this adapter's job)/i;
const OVERCLAIM_ALL_FOUR_RE = /all\s+four\s+core-?2\s+powers|capability grants?\s+and\s+protected mutation\s+(?:are|is)\s+(?:now\s+)?(?:enforced|live|covered)/i;

function assertScopedHonestly(text) {
  for (const re of REQUIRED_SCOPE_TERMS) {
    if (!re.test(text)) return { ok: false, reason: "promise-missing-scoped-power-claim" };
  }
  if (OVERCLAIM_ALL_FOUR_RE.test(text)) {
    return { ok: false, reason: "promise-overclaims-beyond-artifact-verification+integration-slice" };
  }
  for (const re of REQUIRED_EXCLUSION_TERMS) {
    if (!re.test(text)) return { ok: false, reason: "promise-silently-omits-uncovered-power" };
  }
  if (!EXCLUSION_MARKER_RE.test(text)) {
    return { ok: false, reason: "promise-overclaims-beyond-artifact-verification+integration-slice" };
  }
  return { ok: true };
}

module.exports = { assertScopedHonestly, REQUIRED_SCOPE_TERMS, REQUIRED_EXCLUSION_TERMS, EXCLUSION_MARKER_RE, OVERCLAIM_ALL_FOUR_RE };
