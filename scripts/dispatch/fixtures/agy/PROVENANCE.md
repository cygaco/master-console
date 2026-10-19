# agy auth-fallback detector fixtures — provenance

ADR-0037. These two fixtures are the committed regression anchors for
`scripts/dispatch/agy-auth-tells.js` (`detectAgyAuthFallback`). The
genuine sample MUST be a real capture, and any derived fixture MUST document its transform — a
hand-authored "genuine" fixture encodes author assumptions.

## authenticated-serve.log — GENUINE (REDACTED real capture)
- Source: a real `agy` execution with a valid keyring. REDACTED capture, not byte-identical. These substitutions
  are applied in the committed file: the real home path → `<home>`, the project path → `<project-root>`, the
  account email → `operator@example.com`, the token expiry → `<expiry>`, the conversation
  id, request trace ids and response ids → `<conversation-id>`, `<trace-id-N>` and `<response-id-N>`, and every
  glog timestamp → shifted by one fixed offset onto a synthetic date (`0101`, starting in the second
  `12:00:00`), keeping the fractional seconds and every delta between lines. No other line was changed. (The committed redacted file therefore hashes differently from the
  original capture.)
- Shape: startup transients (`Model resolved via default`, `local chrome mode / eval mode`,
  `You are not logged into Antigravity`, `not authenticated`) at lines 1-53, THEN keyring load
  (`expired=false`, L54) and the three code-site auth-success lines (`ChainedAuth: authenticated
  via keyring` L55, `OAuth: authenticated successfully` L57, `silent auth succeeded` L68), then
  authenticated request execution with the resolver/request labels logged for "Gemini 3.1 Pro
  (High)". pid = 39296 on every line (glog field 3). SERVED-MODEL identity is UNPROVEN here (the log carries the requested/resolver LABEL, not an operator-account-config served-model attestation)
  — this fixture proves AUTHENTICATION, not which model actually served.
- Expected classification: `auth_fallback: false` (surface `auth-success`). This is the anchor that must never regress.

## unauthenticated-serve.log — DERIVED (documented transform)
- Derived from `authenticated-serve.log` by: (1) removing the three code-site auth-success lines
  (`ChainedAuth: authenticated via keyring`, `OAuth: authenticated successfully as ...`,
  `Print mode: silent auth succeeded`) and two other auth-result lines (`Auth succeeded, refreshing
  features and managers`, `applyAuthResult: …`); (2) flipping `expired=false` → `expired=true` on the
  keyring.go line. Same pid (39296), same timestamps — a synthetic UNauthenticated serve.
- Expected classification: `auth_fallback: true`. Represents the false-green:
  an unauthenticated serve that exits 0 with output but never authenticated.

## Edge cases
The sequence / concurrency / fail-closed edge cases (expired-then-refresh-success,
late-transient-after-success, interleaved-pid, rotation, indeterminate trio, year-rollover,
stdout-collision) are constructed programmatically in `../agy-auth-tells.test.js` from labeled
glog-line builders — each transform is auditable in-test rather than a separate hand-authored log.
