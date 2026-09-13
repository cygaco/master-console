"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * broker-merge.js — #5, the α-MERGE DOGFOOD HELPER (SP-20260721-001, D-4 INC-1, unit MIG).
 *
 * The thin hand α's merge-hand invokes to land a sprint branch onto main THROUGH the INC-1 brokered
 * transport, VOLUNTARILY, before the Seam E fence is armed.
 *
 *   node scripts/dispatch/broker-merge.js <branch> [options]
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────────────────
 *   1. Resolve the branch tip and the LIVE tip of the target ref (read-only).
 *   2. BUILD the merge commit WITHOUT MOVING ANY REF — `merge-tree --write-tree` then `commit-tree`, with
 *      the live head as FIRST parent and the branch tip as SECOND. Nothing is written to a ref here, so a
 *      broker refusal later leaves the repository exactly as it was found (the merge object is simply
 *      unreferenced and gets garbage-collected). That ordering is deliberate: the transport requires a
 *      real 2-parent merge object to judge, and a helper that had to move main first in order to ask
 *      permission would be a contradiction.
 *   3. Hold the conductor lease (reuse α's if it already holds one — see `ensureLease`).
 *   4. Call `integrateBranchMerge({merge_commit, target_ref}, opts)` — the broker re-resolves the live
 *      head ITSELF as the CAS anchor (β R1). This helper deliberately passes NO anchor: the head it read
 *      in step 1 is used only to build the merge object and to detect a race, never as a trust input.
 *   5. LANDED → print the receipt. BLOCKED → classify, and either surface-and-stop (security/usage) or
 *      fall back to the ordinary route with the full LOGGED+COUNTED+SURFACED treatment (operational only).
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────────
 *   • It never pushes. Landing locally and pushing are separate decisions (and pushing needs operator
 *     authorization per CLAUDE.md ## Autonomy).
 *   • It never touches the working tree. `update-ref` moves the ref underneath a checked-out main without
 *     refreshing the index, so when the target ref IS the checked-out branch the helper REPORTS
 *     `worktree_refresh_required` and lets the caller decide — it will not run a `reset --hard` on its own,
 *     because silently discarding working state to tidy up after a merge is not a helper's call to make.
 *   • It never falls back on a security refusal. See broker-dogfood.js for the classification rule.
 *
 * OPTIONS
 *   --merge-commit <sha>   Use an ALREADY-BUILT 2-parent merge commit instead of building one.
 *   --target-ref <ref>     Default refs/heads/main.
 *   --sp-id <id>           Sprint id for the conductor lease (default: $MC_SP_ID).
 *   --lease-root <dir>     Lease store root (default: the conductor-lease default).
 *   --git-root <dir>       Repository root (default: this repo).
 *   --bundle-manifest <p>  Promoted pinned-bundle manifest (or $MC_PINNED_BUNDLE_MANIFEST).
 *   --bundle-root <dir>    Promoted bundle root (or $MC_PINNED_BUNDLE_ROOT).
 *   --message <msg>        Merge commit message.
 *   --no-fallback          Refuse the ordinary route even for an operational miss (strict dogfood).
 *   --dry-run              Do everything except the final write (broker call included) — prints intent.
 *   --json                 Machine-readable result on stdout.
 *
 * EXIT 0 = landed (brokered OR logged fallback) · 1 = refused/failed · 2 = usage error.
 */
const dog = require("./broker-dogfood");

const TARGET_DEFAULT = "refs/heads/main";

/**
 * buildMergeCommit({gitRoot, head, tip, message}) -> {ok, sha} | {ok:false, reason, detail}.
 * Builds a REAL 2-parent merge object via `merge-tree --write-tree` + `commit-tree`. No ref is written.
 */
function buildMergeCommit(args = {}) {
  const { gitRoot, head, tip, message } = args;
  const mt = dog.git(["merge-tree", "--write-tree", head, tip], gitRoot);
  if (!mt.ok) {
    const err = `${mt.stderr}\n${mt.stdout}`;
    if (/unknown option|usage: git merge-tree|--write-tree/i.test(mt.stderr)) {
      return { ok: false, reason: "merge-tree-unsupported", detail: mt.stderr };
    }
    return { ok: false, reason: "merge-conflict", detail: err.trim().slice(0, 500) };
  }
  const tree = mt.stdout.split(/\r?\n/)[0].trim();
  if (!/^[0-9a-f]{40}$/i.test(tree)) return { ok: false, reason: "merge-tree-unsupported", detail: `unexpected merge-tree output: ${mt.stdout.slice(0, 200)}` };

  const ct = dog.git(["commit-tree", tree, "-p", head, "-p", tip, "-m", message], gitRoot);
  if (!ct.ok || !/^[0-9a-f]{40}$/i.test(ct.stdout)) {
    return { ok: false, reason: "merge-tree-unsupported", detail: ct.stderr || ct.stdout };
  }
  return { ok: true, sha: ct.stdout.toLowerCase(), tree };
}

/**
 * brokerMerge(input, opts, seams) -> result.
 *
 * `seams` is the SANCTIONED test-producer seam (same discipline as the controller's `*ForTest` exports):
 * {broker, lease, logPath, eventsPath, now}. Production callers never pass it. Note the asymmetry with the
 * transport itself — seams here only reach the DOGFOOD wrapper (ledger paths, the broker module handle),
 * never the trust spine, which lives entirely inside trusted-controller.js and is untouchable from here.
 */
function brokerMerge(input = {}, opts = {}, seams = {}) {
  const gitRoot = opts.gitRoot || dog.ROOT;
  const targetRef = input.target_ref || TARGET_DEFAULT;
  const branch = input.branch || null;
  const emit = opts.emit !== false;

  // ── (1) read-only resolution ───────────────────────────────────────────────────────────────────────
  const head = dog.resolveRef(targetRef, gitRoot);
  if (!head) return ({ ok: false, route: "none", decision: "BLOCKED", reason: "target-ref-unresolvable", detail: targetRef, classification: "usage" });

  let mergeCommit = input.merge_commit || null;
  let tip = null;
  if (!mergeCommit) {
    if (!branch) return ({ ok: false, route: "none", decision: "BLOCKED", reason: "branch-unresolvable", detail: "no <branch> and no --merge-commit", classification: "usage" });
    tip = dog.resolveRef(branch, gitRoot);
    if (!tip) return ({ ok: false, route: "none", decision: "BLOCKED", reason: "branch-unresolvable", detail: branch, classification: "usage" });
    if (tip === head) return ({ ok: false, route: "none", decision: "BLOCKED", reason: "already-merged", detail: `${branch} is already at ${targetRef}`, classification: "usage" });
    // Already an ancestor ⇒ nothing to land. Refusing beats minting an empty merge nobody asked for.
    if (dog.git(["merge-base", "--is-ancestor", tip, head], gitRoot).ok) {
      return ({ ok: false, route: "none", decision: "BLOCKED", reason: "already-merged", detail: `${branch} (${tip.slice(0, 8)}) is already an ancestor of ${targetRef}`, classification: "usage" });
    }

    // ── (2) build the merge object — NO ref is written ───────────────────────────────────────────────
    const built = buildMergeCommit({
      gitRoot,
      head,
      tip,
      message: input.message || `merge(${branch}): brokered land onto ${targetRef.replace("refs/heads/", "")}`,
    });
    if (!built.ok) {
      // A build failure is pre-broker. `merge-conflict` is a usage refusal (the ordinary route conflicts
      // too); `merge-tree-unsupported` is operational and CAN fall back — but there is no merge object to
      // land, so the fallback route is the ordinary `git merge` itself.
      return finish({ ok: false, decision: "BLOCKED", reason: built.reason, detail: built.detail }, { gitRoot, targetRef, branch, head, newHead: null, message: input.message, opts, seams, emit });
    }
    mergeCommit = built.sha;
  }

  // ── (3) the conductor lease ────────────────────────────────────────────────────────────────────────
  const spId = opts.spId || mcEnv.readEnv("SP_ID") || null;
  const held = dog.ensureLease(spId, opts.leaseRoot, seams.lease);
  if (!held.ok) {
    // No lease ⇒ the broker will refuse with `lease-not-held`, a SECURITY reason. Report it in the broker's
    // own vocabulary rather than inventing a softer one that might look fallback-eligible.
    return finish({ ok: false, decision: "BLOCKED", reason: "lease-not-held", detail: `conductor lease unavailable for ${spId || "(no --sp-id)"}: ${held.state}` }, { gitRoot, targetRef, branch, head, newHead: mergeCommit, message: input.message, opts, seams, emit });
  }

  try {
    // ── (4) the pinned bundle + the brokered call ────────────────────────────────────────────────────
    const bundle = dog.resolveBundleConfig(opts);
    if (!bundle.ok) {
      return finish({ ok: false, decision: "BLOCKED", reason: bundle.reason, detail: bundle.detail }, { gitRoot, targetRef, branch, head, newHead: mergeCommit, message: input.message, opts, seams, emit });
    }
    const loaded = dog.loadBroker(seams.broker);
    if (!loaded.ok) {
      return finish({ ok: false, decision: "BLOCKED", reason: loaded.reason, detail: loaded.detail }, { gitRoot, targetRef, branch, head, newHead: mergeCommit, message: input.message, opts, seams, emit });
    }

    if (opts.dryRun === true) {
      return ({ ok: true, route: "dry-run", decision: "DRY-RUN", merge_commit: mergeCommit, target_ref: targetRef, previous_head: head, branch, lease: held.state, would_call: "integrateBranchMerge" });
    }

    let res;
    try {
      res = loaded.broker.integrateBranchMerge(
        { merge_commit: mergeCommit, target_ref: targetRef },
        // NOTE: no anchor, no lease token — `sanitizeTransportOpts` would drop them anyway, and asking for
        // something the broker refuses to hear is how a caller starts believing it is trusted.
        { bundleManifestPath: bundle.bundleManifestPath, bundleRoot: bundle.bundleRoot, spId, leaseRoot: opts.leaseRoot, gitRoot },
      );
    } catch (e) {
      res = { ok: false, decision: "BLOCKED", reason: "broker-threw", detail: e.message };
    }

    if (res && res.ok === true) {
      const onTarget = dog.currentBranchRef(gitRoot) === targetRef;
      // GF-3b: the ref has ALREADY moved — read the informational count SAFELY so an unreadable ledger can
      // never turn a landed merge into an uncaught exception (nor substitute a false zero).
      const fbCount = dog.fallbackCountSafe(seams.logPath || dog.defaultLogPath(opts.root));
      const r = {
        ok: true,
        route: "brokered",
        decision: res.decision,
        transport: "branch-merge",
        merge_commit: mergeCommit,
        target_ref: targetRef,
        branch,
        receipt: res.receipt,
        lease: held.state,
        fallback_count: fbCount.count,
        fallback_count_unreadable: fbCount.unreadable,
        worktree_refresh_required: onTarget,
      };
      if (emit) {
        process.stdout.write(`✔ BROKERED LAND — ${targetRef} ${head.slice(0, 8)} → ${mergeCommit.slice(0, 8)} (suite ${res.receipt.suite_version}, bundle ${String(res.receipt.bundle_digest).slice(0, 12)}, hook_active=${res.receipt.hook_active})\n`);
        if (onTarget) {
          process.stdout.write(`  ⓘ ${targetRef} is the CHECKED-OUT branch: the ref moved but the index/worktree did not.\n    Refresh deliberately (e.g. \`git reset --hard ${targetRef.replace("refs/heads/", "")}\`) once you have confirmed there is nothing to lose.\n`);
        }
      }
      return r;
    }

    return finish(res || { ok: false, reason: "broker-threw", detail: "no result" }, { gitRoot, targetRef, branch, head, newHead: mergeCommit, message: input.message, opts, seams, emit });
  } finally {
    // GF-4: inspect the release outcome. release() self-surfaces a loud orphan banner on failure, so a
    // discarded lease can never be silent; this captures it rather than dropping it on the floor.
    const rel = held.release();
    if (rel && rel.ok === false && emit) {
      process.stderr.write(`  ⓘ lease cleanup did not confirm for ${spId || "(sprint)"} — see the orphan warning above.\n`);
    }
  }
}

/**
 * finish(refusal, ctx) — the ONE exit path for every non-LANDED outcome. Routes through
 * `dog.attemptFallback`, which is itself the only gate to the ordinary route. Centralised on purpose:
 * a second, ad-hoc "just fall back here" branch elsewhere in this file is exactly how the visibility
 * guarantee would rot.
 */
function finish(refusal, ctx) {
  const reason = refusal.reason || "broker-threw";
  const classification = dog.classifyRefusal(reason);

  const fb = dog.attemptFallback({
    reason,
    detail: refusal.detail || refusal.offending || null,
    transport: "branch-merge",
    targetRef: ctx.targetRef,
    gitRoot: ctx.gitRoot,
    newHead: ctx.newHead,
    expectedHead: ctx.head,
    branch: ctx.branch,
    message: ctx.message,
    logPath: ctx.seams.logPath,
    eventsPath: ctx.seams.eventsPath !== undefined ? ctx.seams.eventsPath : dog.resolveEventsPath(),
    now: ctx.seams.now,
    root: ctx.opts.root,
    allowFallback: ctx.opts.allowFallback,
    dryRun: ctx.opts.dryRun === true,
    emit: ctx.emit,
    actor: ctx.opts.actor,
  });

  if (fb.refused) {
    if (ctx.emit) process.stderr.write(`${dog.refusalBanner("branch-merge", reason, fb.classification || classification, refusal.detail || refusal.offending)}\n`);
    return {
      ok: false,
      route: "none",
      decision: "BLOCKED",
      transport: "branch-merge",
      reason,
      classification: fb.classification || classification,
      detail: refusal.detail || refusal.offending || null,
      fallback_refused: fb.reason || null,
      fallback_count: dog.fallbackCountSafe(ctx.seams.logPath || dog.defaultLogPath(ctx.opts.root)).count, // GF-3b: never throw on an already-decided refusal
    };
  }

  return {
    ok: fb.ok,
    route: fb.route,
    decision: fb.route === "dry-run" ? "DRY-RUN-WOULD-FALL-BACK" : fb.ok ? "LANDED-BY-FALLBACK" : "FALLBACK-FAILED",
    transport: "branch-merge",
    broker_reason: reason,
    classification,
    fallback_record: fb.record,
    fallback_count: fb.count,
    reason: fb.reason,
    detail: fb.detail,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  "usage: node scripts/dispatch/broker-merge.js <branch> [options]",
  "",
  "  Lands <branch> onto the target ref THROUGH the INC-1 brokered transport (integrateBranchMerge).",
  "",
  "  --merge-commit <sha>   use an already-built 2-parent merge commit instead of building one",
  "  --target-ref <ref>     default refs/heads/main",
  "  --sp-id <id>           sprint id for the conductor lease (default $MC_SP_ID)",
  "  --lease-root <dir>     lease store root",
  "  --git-root <dir>       repository root",
  "  --bundle-manifest <p>  promoted pinned-bundle manifest (or $MC_PINNED_BUNDLE_MANIFEST)",
  "  --bundle-root <dir>    promoted bundle root (or $MC_PINNED_BUNDLE_ROOT)",
  "  -m, --message <msg>    merge commit message",
  "  --no-fallback          refuse the ordinary route even for an operational miss (strict dogfood)",
  "  --dry-run              resolve + build + report, perform no write",
  "  --json                 machine-readable result on stdout",
  "",
  "  exit 0 = landed (brokered OR logged fallback) · 1 = refused/failed · 2 = usage error",
  "  fallback ledger: node scripts/dispatch/broker-dogfood.js --report",
].join("\n");

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "--merge-commit") o.mergeCommit = take();
    else if (a === "--target-ref") o.targetRef = take();
    else if (a === "--sp-id") o.spId = take();
    else if (a === "--lease-root") o.leaseRoot = take();
    else if (a === "--git-root") o.gitRoot = take();
    else if (a === "--bundle-manifest") o.bundleManifestPath = take();
    else if (a === "--bundle-root") o.bundleRoot = take();
    else if (a === "--message" || a === "-m") o.message = take();
    else if (a === "--no-fallback") o.allowFallback = false;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("-")) o.unknown = a;
    else o._.push(a);
  }
  return o;
}

function main(argv) {
  const a = parseArgs(argv);
  if (a.help) {
    console.log(USAGE);
    return 0;
  }
  if (a.unknown) {
    console.error(`broker-merge: unknown option ${a.unknown} (--help)`);
    return 2;
  }
  const branch = a._[0] || null;
  if (!branch && !a.mergeCommit) {
    console.error(USAGE);
    return 2;
  }

  const res = brokerMerge(
    { branch, merge_commit: a.mergeCommit, target_ref: a.targetRef || TARGET_DEFAULT, message: a.message },
    {
      gitRoot: a.gitRoot,
      spId: a.spId,
      leaseRoot: a.leaseRoot,
      bundleManifestPath: a.bundleManifestPath,
      bundleRoot: a.bundleRoot,
      allowFallback: a.allowFallback,
      dryRun: a.dryRun,
      actor: "alpha-merge-hand",
    },
    {},
  );

  if (a.json) console.log(JSON.stringify(res, null, 2));
  return res.ok ? 0 : 1;
}

module.exports = { brokerMerge, buildMergeCommit, parseArgs, main, TARGET_DEFAULT };

if (require.main === module) process.exit(main(process.argv.slice(2)));
