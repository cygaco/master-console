#!/usr/bin/env node
"use strict";

const SIGNALS = Object.freeze(
  [
    {
      rank: 1,
      id: "completion_record",
      label: "an explicit completion/death record written by the dispatch itself",
      detail:
        "the SAME writer (recordCompletion / dispatch-record-fields) attests the dispatch reached a terminal state — the strongest possible evidence a reap decision can rest on.",
    },
    {
      rank: 2,
      id: "wake_marker",
      label: "a durable completion marker (wake-notification)",
      detail:
        "a robust re-wake signal was written independent of the primary completion record — corroborates a real completion even if the primary record write raced or failed.",
    },
    {
      rank: 3,
      id: "worktree_commit",
      label: "a worktree with a real committed change",
      detail:
        "git history shows the dispatch's work actually landed — strong indirect proof the work finished, even absent any record.",
    },
    {
      rank: 4,
      id: "stdout_captured",
      label: "non-empty stdout captured from the dispatch",
      detail:
        "the wrapper captured real output before the process vanished — evidence of activity/progress, weaker than a committed artifact.",
    },
    {
      rank: 5,
      id: "timeout_sigterm_record",
      label: "an outer-timeout SIGTERM record",
      detail:
        "the harness/wrapper logged that IT deliberately terminated the dispatch on a timeout — the absence that follows is EXPLAINED, not mysterious.",
    },
    {
      rank: 6,
      id: "wrapper_death_record",
      label: "the wrapper's own graceful-death record",
      detail:
        "the wrapper process logged its own planned exit (caught its termination signal, flushed, exited) — self-reported, and weaker than the dispatch's OWN terminal-state record (rank 1).",
    },
    {
      rank: 7,
      id: "stale_lock",
      label: "a stale concurrency lock past TTL",
      detail:
        "the concurrency-lock file for this dispatch is older than its STALE_AFTER_MS window — suggestive of abandonment, but a lock going stale is NOT proof of what happened to the process itself.",
    },
    {
      rank: 8,
      id: "process_absent",
      label: "process-absence",
      detail:
        "the OS process can no longer be found. WEAKEST signal by design: a vanished process may have completed normally, been reaped by the harness (leaving a still-working grandchild orphaned), or genuinely died. NEVER sufficient alone.",
    },
  ].map(Object.freeze),
);

const SIGNAL_IDS = Object.freeze(SIGNALS.map((s) => s.id));
const WEAKEST_SIGNAL_ID = "process_absent";
const STRONGEST_SIGNAL_ID = "completion_record";

function signalById(id) {
  return SIGNALS.find((s) => s.id === id) || null;
}

function rankedEvidence(signals) {
  const s = signals && typeof signals === "object" ? signals : {};
  return SIGNALS.map((sig) => ({
    rank: sig.rank,
    id: sig.id,
    label: sig.label,
    present: !!s[sig.id],
  }));
}

function shouldReap(signals) {
  const evidence = rankedEvidence(signals);
  const present = evidence.filter((e) => e.present);

  if (present.length === 0) {
    return {
      reap: false,
      reason:
        "no-evidence: none of the 8 ranked signals is present — nothing corroborates a reap decision",
      rankedEvidence: evidence,
    };
  }

  const processAbsentPresent = present.some((e) => e.id === WEAKEST_SIGNAL_ID);
  const corroborating = present.filter((e) => e.id !== WEAKEST_SIGNAL_ID);

  if (corroborating.length === 0) {
    return {
      reap: false,
      reason:
        "process-absence-alone: rank 8 (the WEAKEST signal) can never justify a reap by itself — a vanished process may have completed normally, been reaped by the harness leaving a still-working grandchild orphaned, or genuinely died. Corroboration from a stronger signal (rank 1-7) is required.",
      rankedEvidence: evidence,
    };
  }

  const strongest = corroborating.slice().sort((a, b) => a.rank - b.rank)[0];
  return {
    reap: true,
    reason:
      `corroborated by rank ${strongest.rank} signal (${strongest.id}): ${strongest.label}` +
      (processAbsentPresent
        ? " — process-absence was also observed, but is not load-bearing for this decision"
        : ""),
    rankedEvidence: evidence,
  };
}

const CONFORMANCE_FIXTURES = Object.freeze(
  [
    {
      name: "rank-1 completion_record alone -> reap allowed",
      signals: { completion_record: true },
      expectReap: true,
    },
    {
      name: "rank-2 wake_marker alone -> reap allowed",
      signals: { wake_marker: true },
      expectReap: true,
    },
    {
      name: "rank-3 worktree_commit alone -> reap allowed",
      signals: { worktree_commit: true },
      expectReap: true,
    },
    {
      name: "rank-4 stdout_captured alone -> reap allowed",
      signals: { stdout_captured: true },
      expectReap: true,
    },
    {
      name: "rank-5 timeout_sigterm_record alone -> reap allowed",
      signals: { timeout_sigterm_record: true },
      expectReap: true,
    },
    {
      name: "rank-6 wrapper_death_record alone -> reap allowed",
      signals: { wrapper_death_record: true },
      expectReap: true,
    },
    {
      name: "rank-7 stale_lock alone -> reap allowed",
      signals: { stale_lock: true },
      expectReap: true,
    },
    {
      name: "rank-8 process_absent ALONE -> reap REFUSED (the core rule)",
      signals: { process_absent: true },
      expectReap: false,
    },
    {
      name: "process_absent + the strongest corroborator (completion_record) -> reap allowed",
      signals: { process_absent: true, completion_record: true },
      expectReap: true,
    },
    {
      name: "process_absent + the weakest possible corroborator (stale_lock) -> reap allowed",
      signals: { process_absent: true, stale_lock: true },
      expectReap: true,
    },
    {
      name: "no signals at all -> reap REFUSED",
      signals: {},
      expectReap: false,
    },
  ].map(Object.freeze),
);

module.exports = {
  SIGNALS,
  SIGNAL_IDS,
  WEAKEST_SIGNAL_ID,
  STRONGEST_SIGNAL_ID,
  signalById,
  rankedEvidence,
  shouldReap,
  CONFORMANCE_FIXTURES,
};
