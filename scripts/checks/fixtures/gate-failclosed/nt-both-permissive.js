// Fixture: a try/catch NESTED inside the body of
// an outer try/catch, where BOTH handlers reach a permissive outcome. The
// detector's findCatchHandlers() must not skip its scan cursor past the
// outer pair's own span after matching it: the inner (nested) handler is
// independently examined, and this fixture
// must yield BOTH findings.
function admitOrDeny() {
  try {
    try {
      readInnerStore();
    } catch (eInner) {
      // permissive: inner handler reached by a failure the outer try
      // encloses. Nested inside the outer try's BODY, before the outer's
      // own catch.
      process.exit(0);
    }
    return runRealDecision();
  } catch (eOuter) {
    // permissive: outer handler, matched normally.
    return { ok: true, skippedDecision: true };
  }
}

module.exports = { admitOrDeny };
