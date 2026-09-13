"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * broker-dogfood.js — the SHARED pre-flip dogfood layer for the INC-1 brokered transport
 * (SP-20260721-001, D-4, unit MIG). Used by `broker-merge.js` (#5) and `broker-release-commit.js` (#6).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────────
 * BE-1 built the transport (`integrateBranchMerge` / `integrateReleaseCommit`). Before the Seam E fence is
 * ARMED, D-4's own merges route through that transport VOLUNTARILY — that voluntary mileage is the evidence
 * the arm decision rests on. Voluntary routing needs an escape hatch (the ordinary `git merge`) for the case
 * where the broker cannot RUN, or a pre-flip dogfood would deadlock the sprint that is building the fence.
 *
 * An escape hatch is also how a dogfood claim rots. If the helper can silently drop to the ordinary route,
 * then "every D-4 merge went through the transport" degrades into "every D-4 merge invoked a script that
 * MIGHT have gone through the transport" — an unbacked `proven` claim, and exactly the false-green shape
 * this sprint exists to kill. So this module makes the escape hatch EXPENSIVE AND LOUD:
 *
 *   FALLBACK-VISIBILITY (β rider-on-the-rider, BINDING). Every fall-back is
 *     LOGGED   — an append-only structured record in `runtime/d4/inc1/dogfood-fallbacks.jsonl`
 *                (+ a best-effort mirror into paths.eventsFile),
 *     COUNTED  — each record carries a monotonic `seq`; the running count is derived from the ledger
 *                itself (not a separate counter that could drift from it), and
 *     SURFACED — a banner on stderr naming the count, the reason, and the honest bar.
 *   And the teeth that make it non-optional: **if the record cannot be written, the fallback DOES NOT
 *   HAPPEN** (`fallback-unrecordable`). An unloggable fallback is precisely the silent bypass the rider
 *   forbids, so it is refused rather than performed. Visibility is a PRECONDITION of the escape hatch, not
 *   a courtesy afterwards.
 *
 * ── THE CLASSIFICATION RULE (the other half of the teeth) ─────────────────────────────────────────────
 * A fallback is legitimate ONLY when the broker could not RENDER A JUDGEMENT (missing bundle, unusable
 * scratch space, git spawn failure). When the broker DID render one and it was a REFUSAL, falling back
 * would be walking around a security verdict — the single worst thing this helper could do. Therefore:
 *
 *   security     → NEVER falls back. Surfaced loudly, exit non-zero. (The verdict IS the product.)
 *   usage        → NEVER falls back. The call is malformed; fix the call.
 *   operational  → MAY fall back, always logged+counted+surfaced.
 *   unknown      → treated as SECURITY (default-deny). A reason this module has never heard of is NOT
 *                  evidence of an operational hiccup; if BE-1 adds a refusal reason and nobody updates
 *                  this table, the safe failure is "refuse and surface", never "quietly bypass".
 *
 * The honest bar at flip time: ZERO fallbacks, or every one of them individually explained from this
 * ledger. `node scripts/dispatch/broker-dogfood.js --report` prints exactly that.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const lease = require("./conductor-lease");

const ROOT = path.resolve(__dirname, "..", "..");

/** The dedicated dogfood ledger (repo-relative). Append-only JSONL, one record per fall-back. */
const FALLBACK_LOG_REL = path.join("runtime", "d4", "inc1", "dogfood-fallbacks.jsonl");
const FALLBACK_SCHEMA = "d4-dogfood-fallback/1";

// ── refusal classification ────────────────────────────────────────────────────────────────────────────

/**
 * SECURITY_REASONS — the broker looked at the request and REFUSED it. Every one of these is a trust-spine
 * verdict (β R1/R2/R5/R6, record-trust, the CAS). Falling back on any of them would land, by the ordinary
 * route, exactly the write the transport just judged unsafe. Non-negotiable: no fallback, loud surface.
 */
const SECURITY_REASONS = Object.freeze([
  // choke-point head/binding spine
  "new-head-unresolvable",
  "new-head-not-a-commit",
  "live-head-unresolvable",
  "new-head-equals-live-head",
  "new-head-not-descendant-of-live-head",
  "head-binding-refused",
  "head-binding-error",
  "merge-first-parent-not-live-head",
  "release-parent-not-live-head",
  // checked === landed
  "result-tree-mutated-mid-run",
  "pinned-suite-failed",
  // pinned-bundle authentication (coded throws out of loadPinnedCheckLib — lineage/pin/candidate-escape)
  "incomplete-bundle-manifest",
  "bundle-pin-mismatch",
  "bundle-lineage-mismatch",
  "bundle-lineage-unresolvable",
  "pinned-node-inside-candidate",
  "pinned-checklib-inside-candidate",
  // suite reconciliation (reconcileTransportSuite)
  "empty-expected-check-set",
  "malformed-run-nonce",
  "malformed-check-result",
  "unknown-check-result",
  "stale-check-result",
  "duplicate-check-result",
  "missing-required-check",
  "check-failed",
  "check-timed-out",
  "required-check-skipped",
  // record-trust + the CAS itself
  "lease-not-held",
  "ref-update-refused", // git refused the compare-and-swap: the ref MOVED. Never paper over a race.
  // this module's own security-shaped refusals
  "fallback-unrecordable", // a fallback that cannot be logged is a silent bypass — refuse it instead
  // ambiguous-toward-attack failures on a CONFIGURED bundle / a specific candidate tree (GF-1, conservative-
  // by-construction). A PRESENT-but-unreadable/unparseable promoted bundle, or a candidate SHA whose tree
  // will not materialize, cannot be PROVEN an infrastructure miss — a poisoned/truncated pinned bundle and
  // a hostile candidate arrive the same way. So they NEVER fall back. (True absence of a configured bundle
  // is the DISTINCT operational reason `no-pinned-bundle-configured`; a structurally-incomplete manifest is
  // the DISTINCT security code `incomplete-bundle-manifest` emitted by the controller.)
  "bundle-load-failed", // a configured, present pinned bundle failed to read/parse — suspicious, not infra
  "result-tree-materialize-failed", // a specific candidate SHA's tree would not materialize — candidate-dependent
]);

/**
 * USAGE_REASONS — the request was malformed before any trust judgement was possible. Also NO fallback (a
 * broken call is not a reason to reach for the un-brokered route), but reported as a caller bug rather
 * than as a security event, so a typo does not read like an attack in the ledger.
 */
const USAGE_REASONS = Object.freeze([
  "invalid-target-ref",
  "merge-commit-unresolvable",
  "merge-parents-unresolvable",
  "merge-commit-not-a-two-parent-merge",
  "release-commit-unresolvable",
  "release-parents-unresolvable",
  "release-commit-not-single-parent",
  // this module's own usage refusals
  "branch-unresolvable",
  "already-merged",
  "merge-conflict", // the ordinary route would conflict too — falling back cannot help
  "nothing-to-commit",
  "target-ref-unresolvable",
]);

/**
 * OPERATIONAL_REASONS — the broker could not RUN, and the failure is PROVABLY infrastructure, not a
 * judgement about the request. DELIBERATELY SHORT and enumerated one-by-one (never a prefix/family match).
 * CONSERVATIVE-BY-CONSTRUCTION (GF-1): only failures that cannot possibly encode an attack on THIS request
 * belong here. A present-but-corrupt configured bundle (`bundle-load-failed`) and an un-materializable
 * candidate tree (`result-tree-materialize-failed`) are ambiguous-toward-attack and live in SECURITY_REASONS
 * above — they never fall back. What remains here is either a genuine tooling gap (`merge-tree-unsupported`,
 * `broker-module-unavailable`), a git-transport error (`ref-update-error`), or the honest ABSENCE of a
 * configured bundle (`no-pinned-bundle-configured`) — none of which is a verdict about the write.
 */
const OPERATIONAL_REASONS = Object.freeze([
  "ref-update-error", // the git spawn itself errored (not a refusal — a refusal is `ref-update-refused`)
  // this module's own operational misses
  "no-pinned-bundle-configured", // no promoted bundle available to this invocation (ABSENCE, not corruption)
  "broker-module-unavailable",
  "broker-threw",
  "merge-tree-unsupported", // git too old for `merge-tree --write-tree`
]);

const REASON_CLASS = Object.freeze(
  Object.fromEntries([
    ...SECURITY_REASONS.map((r) => [r, "security"]),
    ...USAGE_REASONS.map((r) => [r, "usage"]),
    ...OPERATIONAL_REASONS.map((r) => [r, "operational"]),
  ]),
);

/** classifyRefusal(reason) -> "security" | "usage" | "operational". DEFAULT-DENY: unknown ⇒ "security". */
function classifyRefusal(reason) {
  if (typeof reason !== "string" || !reason) return "security";
  return REASON_CLASS[reason] || "security";
}

/** fallbackAllowed(reason) -> boolean. TRUE for exactly one class: operational. */
function fallbackAllowed(reason) {
  return classifyRefusal(reason) === "operational";
}

// ── the fallback ledger (LOGGED + COUNTED) ───────────────────────────────────────────────────────────

function defaultLogPath(root) {
  return path.join(root || ROOT, FALLBACK_LOG_REL);
}

/** readFallbacks(logPath) -> [record,...]. A malformed line is preserved as {_malformed} — never dropped,
 *  because dropping it would UNDER-count fallbacks, which is the one direction that must never happen.
 *
 *  ENOENT (the ledger has never been written) is the ONLY read failure that legitimately means "empty" —
 *  it is returned as []. Any OTHER read error (EACCES/EISDIR/EIO — a ledger that EXISTS but cannot be read)
 *  is NOT empty: swallowing it to [] would under-count fallbacks, which is exactly the silent-bypass the
 *  fallback-visibility rider forbids (an unreadable-but-appendable ledger would otherwise permit a count-0
 *  fallback and certify "ZERO fallbacks" at flip time). So a non-ENOENT read error THROWS; callers on the
 *  security path (recordFallback, report) catch it and refuse / surface rather than under-count. (GF-3) */
function readFallbacks(logPath) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return []; // never written = legitimately empty
    throw e; // present-but-unreadable is NOT empty — the caller must not under-count
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { _malformed: true, raw: l };
      }
    });
}

/** fallbackCount(logPath) -> number. Derived FROM the ledger, so the count and the evidence cannot drift.
 *  THROWS on a present-but-unreadable ledger (GF-3) — used on the SECURITY path, where an unreadable ledger
 *  must REFUSE the fallback (recordFallback catches it). Never use it where a throw could undo a completed
 *  write — use fallbackCountSafe for that. */
function fallbackCount(logPath) {
  return readFallbacks(logPath).length;
}

/**
 * readFallbacksSafe(logPath) -> {rows, unreadable}. THE ONE non-throwing ledger read for every INFORMATIONAL
 * site (the success-path result fields AND report()). It encodes a single invariant, in a single place, so
 * no caller can drift off it (the lib-only-fix-bypassing-callers class): reading the fallback ledger must
 * NEVER affect the success/failure of a ref op that already completed, and must NEVER certify a false zero.
 * ENOENT (never written) -> {rows:[], unreadable:false}; a present-but-unreadable ledger -> {rows:null,
 * unreadable:true}. The SECURITY DECISION path (recordFallback pre-append) deliberately does NOT use this —
 * it keeps the throwing readFallbacks/fallbackCount so an unreadable ledger REFUSES the fallback outright.
 */
function readFallbacksSafe(logPath) {
  try {
    return { rows: readFallbacks(logPath), unreadable: false };
  } catch {
    return { rows: null, unreadable: true };
  }
}

/** fallbackCountSafe(logPath) -> {count, unreadable}. The count projection of the ONE safe read
 *  (readFallbacksSafe) — used at the success-path result fields (GF-3b). {count:null,unreadable:true} on an
 *  unreadable ledger, never a fabricated zero, never a throw. */
function fallbackCountSafe(logPath) {
  const safe = readFallbacksSafe(logPath);
  return { count: safe.unreadable ? null : safe.rows.length, unreadable: safe.unreadable };
}

/**
 * recordFallback(entry, opts) -> {ok, count, record, logPath, event_mirrored}.
 *
 * Appends ONE ledger record and returns the new running count. `ok:false` means the fallback was NOT made
 * visible — and the callers treat that as a REFUSAL to fall back at all (see `fallback-unrecordable`).
 * The eventsFile mirror is best-effort by design: the dedicated ledger is the source of truth, and a
 * missing/locked global event log must not be able to block a legitimate, logged fallback.
 */
function recordFallback(entry, opts = {}) {
  const logPath = opts.logPath || defaultLogPath(opts.root);
  let prior;
  try {
    prior = fallbackCount(logPath);
  } catch (e) {
    // The ledger EXISTS but cannot be read (GF-3). We cannot honestly count, so we cannot make this
    // fallback visible — report it as unrecordable, which `attemptFallback` turns into a REFUSAL
    // (`fallback-unrecordable`, a SECURITY reason) rather than a silent count-0 ordinary write.
    return { ok: false, count: null, record: null, logPath, error: `ledger-unreadable: ${e.message}`, event_mirrored: false };
  }
  const record = {
    schema: FALLBACK_SCHEMA,
    seq: prior + 1,
    ts: new Date(typeof opts.now === "number" ? opts.now : Date.now()).toISOString(),
    sprint: "SP-20260721-001",
    unit: "D-4 INC-1 MIG",
    ...entry,
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch (e) {
    return { ok: false, count: prior, record, logPath, error: e.message, event_mirrored: false };
  }

  let mirrored = false;
  if (opts.eventsPath) {
    try {
      fs.mkdirSync(path.dirname(opts.eventsPath), { recursive: true });
      fs.appendFileSync(opts.eventsPath, `${JSON.stringify({ type: "d4-dogfood-fallback", ...record })}\n`, "utf8");
      mirrored = true;
    } catch {
      mirrored = false; // best-effort mirror only — the dedicated ledger above is the source of truth
    }
  }

  // Re-derive the count from the ledger rather than trusting `prior + 1`: if a concurrent writer also
  // appended, the honest count is what the file now holds. (Just appended, so the file is present+readable;
  // if a read hiccup races us anyway, prior+1 is the honest floor — never under-count.)
  let derived;
  try {
    derived = fallbackCount(logPath);
  } catch {
    derived = prior + 1;
  }
  return { ok: true, count: derived, record, logPath, event_mirrored: mirrored };
}

/** resolveEventsPath() -> paths.eventsFile, or null when the registry is unavailable (never throws). */
function resolveEventsPath() {
  try {
    const { PATHS } = require("../hooks/lib/paths");
    return PATHS && PATHS.eventsFile ? PATHS.eventsFile : null;
  } catch {
    return null;
  }
}

// ── SURFACED ─────────────────────────────────────────────────────────────────────────────────────────

/** fallbackBanner(record, count, logPath) -> the loud stderr surface. Impossible to mistake for success. */
function fallbackBanner(record, count, logPath) {
  const bar = "═".repeat(94);
  return [
    "",
    bar,
    `  ⚠  DOGFOOD FALLBACK #${count} — THE BROKERED TRANSPORT WAS **NOT** EXERCISED FOR THIS WRITE`,
    bar,
    `  transport      : ${record.transport}`,
    `  target_ref     : ${record.target_ref}`,
    `  broker reason  : ${record.reason} (${record.classification})`,
    record.detail ? `  detail         : ${String(record.detail).slice(0, 300)}` : null,
    `  route taken    : ${record.fallback_route} (ORDINARY, un-brokered)`,
    `  ledger         : ${logPath}`,
    `  running count  : ${count}`,
    "",
    "  This write does NOT count as transport mileage. The honest bar at flip time is ZERO fallbacks,",
    "  or every one individually explained from the ledger above. Do not report the transport as",
    '  "proven in production" while this count is non-zero and unexplained.',
    bar,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** refusalBanner(kind, reason, detail) -> the surface for a NON-fallback refusal (security / usage). */
function refusalBanner(transport, reason, classification, detail) {
  const bar = classification === "security" ? "█".repeat(94) : "─".repeat(94);
  const head =
    classification === "security"
      ? "  ⛔ BROKER REFUSED (SECURITY) — NO FALLBACK. The ordinary route is NOT an option here."
      : "  ✖ BROKER REFUSED (USAGE) — the call is malformed. Fix the call; no fallback.";
  return ["", bar, head, bar, `  transport : ${transport}`, `  reason    : ${reason}`, detail ? `  detail    : ${String(detail).slice(0, 300)}` : null, bar, ""]
    .filter((l) => l !== null)
    .join("\n");
}

// ── git helpers (READ-ONLY unless the name says otherwise) ───────────────────────────────────────────

function git(args, cwd, env) {
  const r = spawnSync("git", args, {
    cwd: cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    // Optional env overlay (e.g. GIT_INDEX_FILE for an isolated build index — see broker-release-commit GF-2).
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    ok: !!r && r.status === 0,
    status: r ? r.status : null,
    stdout: String((r && r.stdout) || "").trim(),
    stderr: String((r && r.stderr) || (r && r.error && r.error.message) || "").trim(),
  };
}

function gitRead(args, cwd) {
  const r = git(args, cwd);
  return r.ok ? r.stdout : null;
}

function resolveRef(ref, cwd) {
  const out = gitRead(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
  return out ? out.toLowerCase() : null;
}

function currentBranchRef(cwd) {
  return gitRead(["symbolic-ref", "-q", "HEAD"], cwd);
}

// ── conductor lease ──────────────────────────────────────────────────────────────────────────────────

/**
 * ensureLease(spId, leaseRoot) -> {ok, state, token?, release()}.
 *
 * The transport resolves the CURRENT HOLDER's token itself, fresh from the lease store (record-trust — a
 * token can neither be asserted nor passed in). So the helper's only job is to guarantee the lease IS
 * held: reuse an existing holder if there is one (α's own conductor lease, the normal case), otherwise
 * acquire one for the duration and hand back a `release()` the caller must run.
 */
/** leaseReleaseWarning(spId, detail) -> a loud stderr banner. A dogfood-ACQUIRED lease that fails to
 *  release is ORPHANED and blocks the next conductor — this must never be silent (GF-4). */
function leaseReleaseWarning(spId, detail) {
  const bar = "═".repeat(94);
  return [
    "",
    bar,
    `  ⚠  LEASE RELEASE FAILED — the conductor lease for ${spId} may be ORPHANED`,
    `     ${detail}`,
    "     A later conductor may be blocked until it is cleared. Investigate before the next run.",
    bar,
    "",
  ].join("\n");
}

function ensureLease(spId, leaseRoot, api = lease) {
  const noop = () => ({ ok: true, released: false }); // nothing to release — a NO-OP still reports its shape
  if (!spId) return { ok: false, state: "no-sp-id", release: noop };
  let acquired = null;
  try {
    acquired = api.acquire(spId, { root: leaseRoot, sessionId: `d4-dogfood-${process.pid}` });
  } catch (e) {
    return { ok: false, state: "acquire-threw", detail: e.message, release: noop };
  }
  if (acquired && acquired.ok) {
    return {
      ok: true,
      state: "acquired",
      token: acquired.token,
      // We ACQUIRED this lease for the duration, so we MUST release it. A failed release ORPHANS the lease
      // and blocks the next conductor — so the outcome is RETURNED and loudly self-surfaced, never swallowed
      // (GF-4). The caller inspects the return; the stderr banner guarantees a surface even if it does not.
      release: () => {
        let r;
        try {
          r = api.release(spId, { root: leaseRoot, token: acquired.token });
        } catch (e) {
          const err = `lease release threw: ${e.message}`;
          process.stderr.write(leaseReleaseWarning(spId, err));
          return { ok: false, released: false, error: err };
        }
        if (r && r.ok === false) {
          const err = `lease release refused: ${r.reason || "unknown"}`;
          process.stderr.write(leaseReleaseWarning(spId, err));
          return { ok: false, released: false, error: err };
        }
        return { ok: true, released: true };
      },
    };
  }
  if (acquired && acquired.reason === "held") {
    // Someone already conducts this sprint (normally α). That is the intended shape — do NOT steal it,
    // do NOT release it on the way out.
    return { ok: true, state: "pre-existing", token: null, release: noop };
  }
  return { ok: false, state: (acquired && acquired.reason) || "unavailable", release: noop };
}

// ── the broker module (loaded defensively: an unloadable broker is an OPERATIONAL miss) ──────────────

function loadBroker(injected) {
  if (injected) return { ok: true, broker: injected };
  try {
    return { ok: true, broker: require("./trusted-controller") };
  } catch (e) {
    return { ok: false, reason: "broker-module-unavailable", detail: e.message };
  }
}

/**
 * resolveBundleConfig(opts) -> {ok, bundleManifestPath, bundleRoot} | {ok:false, reason}.
 *
 * A promoted pinned bundle lives OUT of tree by construction (see pinned-checker-bundle.js), so its
 * location must be supplied — by flag or by env.
 *
 * TWO DISTINCT failures, split by GF-1b (conservative-by-construction — the lead's "split the overlapping
 * reason, do not re-bucket"):
 *   - NO configuration supplied at all ⇒ `no-pinned-bundle-configured`, an OPERATIONAL miss (the honest
 *     pre-flip dogfood state — no promoted bundle yet; the ordinary route bypasses no judgement).
 *   - A manifest path IS configured but is MISSING / unstatable ⇒ `bundle-load-failed`, a SECURITY reason:
 *     a promoted pinned bundle that was configured and then vanished (deleted / access-denied / tampered)
 *     is suspicious and must NOT fall back to the ordinary route.
 */
function resolveBundleConfig(opts = {}, env = process.env) {
  const manifest = opts.bundleManifestPath || mcEnv.readEnv("PINNED_BUNDLE_MANIFEST", env) || null;
  const bundleRoot = opts.bundleRoot || mcEnv.readEnv("PINNED_BUNDLE_ROOT", env) || (manifest ? path.dirname(manifest) : null);
  if (!manifest) return { ok: false, reason: "no-pinned-bundle-configured", detail: "set --bundle-manifest or WARPOS_PINNED_BUNDLE_MANIFEST (a PROMOTED, out-of-tree bundle)" };
  if (!fs.existsSync(manifest)) return { ok: false, reason: "bundle-load-failed", detail: `configured bundle manifest is missing or unstatable: ${manifest}` };
  return { ok: true, bundleManifestPath: manifest, bundleRoot };
}

// ── the ordinary (un-brokered) route ─────────────────────────────────────────────────────────────────

/**
 * ordinaryLand({...}) -> {ok, route, reason?, detail?}. THE FALLBACK. This is the plain, un-brokered git
 * write that the Seam E fence will refuse once armed — which is the point: post-flip this function stops
 * working, and that is the forcing function that ends the dogfood period.
 *
 * NEVER call this directly. It is reachable only through `attemptFallback`, which refuses to run it unless
 * a ledger record was successfully written first.
 */
function ordinaryLand(args = {}) {
  const { gitRoot, targetRef, newHead, expectedHead, branch, message, kind } = args;
  const onTarget = currentBranchRef(gitRoot) === targetRef;
  if (kind === "branch-merge" && onTarget && branch) {
    // The genuinely ordinary shape when main is checked out: a plain --no-ff merge.
    const r = git(["merge", "--no-ff", "-m", message || `merge ${branch}`, branch], gitRoot);
    return r.ok ? { ok: true, route: "git merge --no-ff" } : { ok: false, route: "git merge --no-ff", reason: "ordinary-merge-failed", detail: r.stderr };
  }
  // Otherwise land the already-built commit by the ordinary compare-and-swap. Guard a null newHead (an
  // unreachable finish() edge — merge-tree unsupported AND the target ref not the checked-out branch) so we
  // return a coded failure rather than crashing spawnSync on a null argument (R2 addendum).
  if (!newHead) {
    return { ok: false, route: "git update-ref", reason: "ordinary-update-ref-failed", detail: "no commit object to land (newHead is null)" };
  }
  const r = git(["update-ref", targetRef, newHead, expectedHead], gitRoot);
  return r.ok ? { ok: true, route: "git update-ref" } : { ok: false, route: "git update-ref", reason: "ordinary-update-ref-failed", detail: r.stderr };
}

/**
 * attemptFallback(ctx) -> {ok, route, reason?, record?, count?}.
 *
 * The ONE gate every fall-back passes through. Order is load-bearing:
 *   1. classify — anything but `operational` is refused outright (no ledger entry, it is not a fallback);
 *   2. RECORD FIRST — write the ledger entry BEFORE the ordinary write, so a crash mid-write still leaves
 *      the fallback visible. A record with no write over-counts; a write with no record is the silent
 *      bypass. Over-counting is the safe direction;
 *   3. if the record could not be written, REFUSE (`fallback-unrecordable`) — do not perform the write;
 *   4. surface the banner, then perform the ordinary write.
 */
function attemptFallback(ctx = {}) {
  const { reason, detail, transport, targetRef, gitRoot, newHead, expectedHead, branch, message, logPath, eventsPath, now } = ctx;
  const classification = classifyRefusal(reason);
  if (classification !== "operational") {
    return { ok: false, route: "none", refused: true, classification, reason };
  }
  if (ctx.allowFallback === false) {
    return { ok: false, route: "none", refused: true, classification, reason: "fallback-disabled-by-flag", broker_reason: reason };
  }

  const kind = transport;
  const draft = {
      transport,
      target_ref: targetRef,
      reason,
      classification,
      detail: detail || null,
      new_head: newHead || null,
      previous_head: expectedHead || null,
      source_branch: branch || null,
      fallback_route: kind === "branch-merge" && currentBranchRef(gitRoot) === targetRef && branch ? "git merge --no-ff" : "git update-ref",
      actor: ctx.actor || "alpha-merge-hand",
      cwd: gitRoot || ROOT,
  };

  // A DRY RUN MUST NOT MOVE THE COUNT. The running count is the number the flip decision is argued from,
  // so a rehearsal that incremented it would inflate the very evidence it is rehearsing — and "explain
  // fallback #3" is unanswerable if #3 never actually happened. Report the PROJECTION instead: what the
  // record would say, and what the count would become. Nothing is written.
  if (ctx.dryRun === true) {
    // Default the ledger path exactly like recordFallback (R2 addendum): in production the CLI passes
    // seams={} so ctx.logPath is undefined, and reading it raw would make a legitimate dry-run rehearsal
    // (α holds the lease, no bundle promoted yet — the common pre-flip state) misreport a type error as
    // fallback-unrecordable instead of PROJECTING the count. The live path defaults inside recordFallback.
    const dryLogPath = logPath || defaultLogPath(ctx.root);
    let currentCount;
    try {
      currentCount = fallbackCount(dryLogPath);
    } catch (e) {
      // A rehearsal against an unreadable ledger (GF-3): give the SAME refusal the live path would, rather
      // than throwing — a dry run must never crash, and must not pretend it could record a fallback.
      return { ok: false, route: "none", refused: true, classification: "security", reason: "fallback-unrecordable", detail: `ledger-unreadable: ${e.message}`, broker_reason: reason, dry_run: true };
    }
    const projected = currentCount + 1;
    const preview = { schema: FALLBACK_SCHEMA, seq: projected, ts: null, dry_run: true, ...draft };
    const dryBanner = fallbackBanner({ ...preview, transport: `${preview.transport} (DRY RUN — nothing written)` }, projected, dryLogPath);
    if (ctx.emit !== false) process.stderr.write(`${dryBanner}\n`);
    return {
      ok: true,
      route: "dry-run",
      performed: false,
      recorded: false,
      record: preview,
      count: currentCount,
      projected_count: projected,
      banner: dryBanner,
    };
  }

  const rec = recordFallback(draft, { logPath, eventsPath, now, root: ctx.root });

  if (!rec.ok) {
    // A fallback that cannot be made visible is exactly the silent bypass the rider forbids. Refuse it.
    return { ok: false, route: "none", refused: true, classification: "security", reason: "fallback-unrecordable", detail: rec.error, broker_reason: reason };
  }

  const banner = fallbackBanner(rec.record, rec.count, rec.logPath);
  if (ctx.emit !== false) process.stderr.write(`${banner}\n`);

  const landed = ordinaryLand({ gitRoot, targetRef, newHead, expectedHead, branch, message, kind });
  return {
    ok: landed.ok,
    route: landed.route,
    reason: landed.reason,
    detail: landed.detail,
    record: rec.record,
    count: rec.count,
    banner,
    performed: true,
  };
}

// ── the report (the flip-time honesty surface) ───────────────────────────────────────────────────────

function report(logPath) {
  const p = logPath || defaultLogPath();
  // The SAME safe-read choke-point the success paths use (GF-3 / lead's round-2 note): an unreadable ledger
  // must NEVER read as "✔ ZERO fallbacks" — the false-green the flip decision is argued against.
  const { rows, unreadable } = readFallbacksSafe(p);
  if (unreadable) {
    const bar = "═".repeat(94);
    const text = [
      "D-4 INC-1 — brokered-transport dogfood fallback ledger",
      `  ledger : ${p}`,
      bar,
      "  ⛔ LEDGER UNREADABLE — the fallback count CANNOT be certified.",
      "  Do NOT argue the Seam E flip from dogfood mileage until this ledger reads cleanly.",
      bar,
    ].join("\n");
    return { count: null, rows: null, unreadable: true, error: "ledger present but unreadable", text };
  }
  const lines = [];
  lines.push("D-4 INC-1 — brokered-transport dogfood fallback ledger");
  lines.push(`  ledger : ${p}`);
  lines.push(`  count  : ${rows.length}`);
  if (rows.length === 0) {
    lines.push("");
    lines.push("  ✔ ZERO fallbacks — every dogfooded write went through the brokered transport.");
  } else {
    lines.push("");
    for (const r of rows) {
      if (r._malformed) {
        lines.push(`  #? MALFORMED LEDGER LINE (counted, unparseable): ${String(r.raw).slice(0, 160)}`);
        continue;
      }
      lines.push(`  #${r.seq} ${r.ts} ${r.transport} -> ${r.target_ref}`);
      lines.push(`       reason: ${r.reason} (${r.classification}) via ${r.fallback_route}`);
      if (r.detail) lines.push(`       detail: ${String(r.detail).slice(0, 200)}`);
    }
    lines.push("");
    lines.push(`  ⚠ ${rows.length} fallback(s). Each must be individually EXPLAINED before the transport is`);
    lines.push("    described as proven, and before the Seam E fence flip is argued from dogfood mileage.");
  }
  return { count: rows.length, rows, text: lines.join("\n") };
}

module.exports = {
  ROOT,
  FALLBACK_LOG_REL,
  FALLBACK_SCHEMA,
  SECURITY_REASONS,
  USAGE_REASONS,
  OPERATIONAL_REASONS,
  REASON_CLASS,
  classifyRefusal,
  fallbackAllowed,
  defaultLogPath,
  readFallbacks,
  readFallbacksSafe,
  fallbackCount,
  fallbackCountSafe,
  recordFallback,
  resolveEventsPath,
  fallbackBanner,
  refusalBanner,
  git,
  gitRead,
  resolveRef,
  currentBranchRef,
  ensureLease,
  loadBroker,
  resolveBundleConfig,
  ordinaryLand,
  attemptFallback,
  report,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--log");
  const p = idx >= 0 ? argv[idx + 1] : undefined;
  const r = report(p);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ count: r.count, rows: r.rows, unreadable: r.unreadable || false, log: p || defaultLogPath() }, null, 2));
  } else {
    console.log(r.text);
  }
  // An unreadable ledger is a non-zero exit: the flip decision must not be argued from a count that
  // could not even be read (GF-3).
  process.exit(r.unreadable ? 1 : 0);
}
