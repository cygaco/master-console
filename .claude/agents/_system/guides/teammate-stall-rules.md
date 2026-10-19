# Teammate Stall Rules — the fire-and-poll pattern

**Status:** LIVE doctrine. This is the canonical source for the
"TEAMMATE STALL RULES" in
`.claude/agents/president/epsilon.md`, and is cross-referenced from
`paths.agentDispatchGuide` (`.claude/agents/_system/guides/agent-dispatch-guide.md`).
THIS file is the canonical stall doctrine.

## The failure it prevents

A teammate-ε (or any teammate) that launches **background** subprocesses and
then goes idle "waiting for returns" waits **forever**. The harness re-wakes a
teammate ONLY on an incoming `SendMessage` — a subprocess completing does **not**
trigger a re-wake, and an in-process `Agent(…, run_in_background:true)` return
is a different lane. The belief "the harness re-wakes me when my subprocess
finishes" is FALSE.

## Why not block everything

Dispatching every subprocess BLOCKING/foreground is safe but serializes
everything — a conductor that must fan out N reviewers can only run them
one-at-a-time in the foreground, and cannot overlap a long build with anything
else.

## The pattern: FIRE-AND-POLL

You do not have to choose between "block foreground" and "idle forever." The
correct shape is **fire the work, then actively poll a durable signal** in the
SAME turn — you never yield control to an event that will not fire.

1. **FIRE** — launch the subprocess(es). Background fan-out is allowed *provided
   you poll* (below). For a single dependency, a bounded blocking/foreground
   dispatch is still the simplest correct choice.
2. **POLL a durable signal, in-turn** — do not `await` an inbox that will not
   wake. Poll one of these until your bound elapses:
   - **The signal board** (`scripts/teams/signal-board.js`, guide
     `signal-channel.md`): `wait <topic> --timeout <s> --poll <ms>` blocks the
     poller in-process and returns exit 0 with the ruling the moment a teammate
     posts it, exit 3 on timeout. This is the accelerator for **teammate
     rulings/verdicts** (β at a phase boundary, a Director's call).
   - **The completion ledger** (`gauntlet-verify` / `epsilon-liveness.js`): for
     **dispatched worker** returns, the ground truth is the durable completion
     record, not narration. Poll the ledger / re-run `gauntlet-verify` for the
     run window; absence of an `ok:true` well-formed record IS the death signal.
3. **BOUND every poll.** A poll without a timeout is just a stall with extra
   steps. On timeout, take a recovery action (re-dispatch, or report state to
   the lead), never silently keep waiting.
4. **Report state before any UNAVOIDABLE idle point.** If you must yield, first
   `SendMessage` the lead concrete state: what is outstanding and where its
   evidence will land, so the lead can watchdog and recover (idle ≠ dead — a
   `SendMessage` wakes an idle teammate; no readiness ping after spawn ≈ reaped
   → re-spawn).

## Why fire-and-poll is safe (it closes the wake-gap by construction)

The stall bug is a **missing wake event**. Polling removes the dependency on a
wake event entirely: the poller drives the clock itself and observes the
durable artifact (a posted signal, or a completion record) directly. You are
never parked on an event the harness will not deliver.

## The paired-waiter protocol — the lead-side accelerator (wake-drop kill)

Fire-and-poll closes the wake-gap from the *teammate's* side, but a teammate's
own poll interval is coarse (10s–minutes) and the harness re-wake it leans on for
a lead relay can itself DROP.
The structural accelerator is a **paired waiter on the
lead's side**, so a completion relays in *seconds* rather than on the teammate's
next poll tick. Four rings, each independent:

1. **The dispatch envelope MUST carry the `dispatch_id` + the expected artifact
   path.** Every time a teammate fires a background dispatch, its status
   `SendMessage` to the team-lead names (a) the `dispatch_id` and (b) the absolute
   path of the completion record / evidence artifact the dispatch will write. An
   envelope missing these two fields **cannot be waited on** — it is a silent-drop
   waiting to happen. (This is the arming input; without it, ring 2 is impossible.)
2. **The team-lead immediately arms a harness-tracked bg waiter.** On receiving
   the envelope the lead launches a background Bash loop that blocks on the durable
   artifact and relays the instant it appears:
   ```bash
   until grep -q '"dispatch_id":"<id>".*"completed_at"' "$COMPLETIONS_LEDGER"; do sleep 10; done
   # then: SendMessage the teammate "<id> completed → <artifact path>"
   ```
   (`$COMPLETIONS_LEDGER` = `paths.dispatchCompletionsFile`.) Because the lead's bg
   Bash is **harness-tracked**, its exit re-wakes the lead deterministically, and
   the lead's relay `SendMessage` re-wakes the idle teammate deterministically —
   **two reliable wakes replacing the one that drops.**
3. **The teammate keeps its own in-turn poller (defense-in-depth).** The lead's
   waiter is primary; the teammate's fire-and-poll (above) is the backup, so a
   dropped lead relay still resolves on the teammate's next tick. Neither path is
   trusted alone; together they are two independent routes to the same signal.
4. **Watchdog ticks remain the OUTER fallback.** The adaptive watchdog cadence
   (below) is the third ring — it catches the case where BOTH the lead waiter and
   the teammate poll somehow miss.

The paired waiter converts
a single fragile wake into a redundant pair — the wake-drop kill.

**Enforcer (debt):** the arm-a-waiter half is behavioral — nothing asserts
the lead armed a waiter for each outstanding dispatch, nor that the envelope carried
the two required fields.

## Shared-ledger write discipline — the ledger-side sibling of the paired-waiter

Parallel lanes writing to the SAME runtime append-log (`paths.enforcementDebt` =
`.claude/project/memory/enforcement-debt.jsonl`, and any shared `.jsonl` ledger)
race the same way a dispatched worker's wake does — and the fix is the same shape:
make the write atomic-by-construction, never rely on a stale read.

1. **APPEND with the next-free id read AT write time — never pre-announce an id as
   final.** Ids are MINTED at write time, not reserved by announcement. If two lanes
   read the same highest id early and each plan the next one, the second append
   creates a transient duplicate id. Re-read the ledger immediately before the
   write, take the ACTUAL next-free, and report the REAL minted id in your
   envelope — never the pre-announced one. **Caveat:** read-next-free-at-write-time
   only SHRINKS the collision window (to the read→append gap); it does NOT close it
   — two lanes can each read the same next-free and both append it (write-atomic,
   id-colliding). Only atomic ALLOCATION closes the class (see Enforcer).
2. **NEVER read-filter-rewrite a shared ledger — repair is ALWAYS
   single-writer-coordinated.** A whole-file rewrite (to dedup or renumber) reads
   the file, edits in memory, and writes it back — clobbering any concurrent append
   that landed in the window (lost-update race). You cannot reliably OBSERVE that no
   other lane is appending (the operator or another agent may), so the rule is
   UNCONDITIONAL, not "while another lane is active": never self-heal a shared ledger
   in place. `O_APPEND` gives WRITE-atomicity (two concurrent appends both LAND,
   neither clobbers — exactly what a rewrite loses); it does NOT give id-allocation
   atomicity (that residual is discipline 1's, closed only by the Enforcer's
   allocator). **Dedup / repair is a SINGLE-WRITER maintenance action** — coordinate
   it through the team lead (one writer, no live co-writer), never a mid-flight
   self-heal.
3. **Verify ledger state by direct READ, never a grep-count.** Confirm
   which ids are live by Read before reporting or repairing.

**Enforcer — two tiers:**
- **Cheap, self-detecting (build first): a ledger duplicate-id lint — keyed on
  GENESIS records, NOT bare id-count.** A ledger is APPEND-ONLY (discipline 2), so an
  ED is CLOSED (or amended) by APPENDING a record with the SAME id — every closed ED
  legitimately carries its id ≥2× (an open genesis + a closure). So flag an id only
  when it has **>1 GENESIS record** — a record that is NOT a closure/status-update/
  amendment (exclude any record carrying `status:closed`, `closure_receipt`,
  `closed_ts`, or an `amends` / `record_kind:amendment` marker). One open + N
  closures/amendments = OK (lifecycle); TWO genesis records with the same id = the
  real cross-lane collision. **Read-based, not a grep-count**,
  wired into `/scan:full`. Its test MUST plant BOTH:
  a closed ED (open+closure pair) that PASSES, and a seeded same-id two-genesis
  fixture that REDs. A bare "id appears ≥2× = dup" lint would false-RED on EVERY
  closed ED — e.g. a legitimately-closed ED (open genesis + closure
  which must PASS) — and flood `/scan:full`: the
  over-broad-detector-that-gets-dismissed (the false-green inverse), worse than no
  lint. It is the named enforcer that closes the hygiene bar without waiting on the root fix.
- **Root fix: atomic id-allocation** — a lock or a
  monotonic allocator so two lanes cannot mint the same id (the only thing that
  CLOSES discipline 1's residual, per the caveat above). Concrete trigger to build
  the allocator: the **SECOND** real collision, OR **any** collision
  causing actual DATA LOSS (not a transient renumber).

## Poll patience — the 540s clamp bound

Do not declare a dispatch dead early. Three deterministic
signals about WHEN a worker is actually gone:

- **Long reviewers die at the clamp, not at random.** `backend-reviewer`
  runs die at **exactly the 540s timeout clamp** (`elapsed_ms` ≈ 540000 on the
  completion record — deterministic, not a random reap). A death right at the clamp is a
  *timeout*, a distinct failure class from an early silent reap.
- **"Reaped" often means "not done yet."** A dispatch the conductor
  declares reaped can have actually **COMPLETED late** — its artifact lands
after the conductor has already written it off. The narration can be
  wrong; the artifact is the truth.
- **Short lanes are not the risk; long lanes near the clamp are.**

**The bound:** nothing is dead before **540s + margin**. Before declaring a
long-running dispatch dead:

1. Keep polling until at least the clamp bound (`DISPATCH_BUILDER_TIMEOUT_MS`,
   ~540s) plus a margin has elapsed — an earlier "no return yet" is expected,
   not death.
2. **Check for the artifact before declaring death** — look for the completion
   record / evidence file the dispatch was told to write. A late-landing
   artifact beats a premature "reaped" verdict every time.
3. Only after the bound has passed AND no artifact exists is the lane a genuine
   death (re-dispatch). A death *at* the clamp is a timeout — re-dispatch with a
   larger bound or a smaller unit, not an identical retry.

## Rule of thumb — which channel

| Waiting on… | Poll | Why |
|---|---|---|
| A teammate's ruling/verdict (β, Director) | signal board `wait <topic>` | rulings are posted; beats inbox-batching latency |
| A dispatched worker's output | completion ledger / `gauntlet-verify` | narration lies; the record is ground truth |
| A single hard dependency | bounded foreground dispatch | simplest correct shape; no fan-out to overlap |

## Enforcer

The stall-adherence enforcer is `scripts/checks/epsilon-liveness.js`: for
each stale outstanding subprocess it checks the completion ledger and flags an
idle-with-outstanding-work stall. The signal-board half is self-tested by
`scripts/teams/signal-board.test.js`. This fire-and-poll doctrine is mirrored in `epsilon.md` TEAMMATE STALL RULES and the
`agent-dispatch-guide.md` cross-reference, and both cite this file as the canonical source of record.

## Coordination cadence & handoff

Three behavioral rules that extend fire-and-poll — cheap levers that the not-yet-landed
structural fixes (the awaited-dispatch watchdog, the conductor lease) do
not yet cover. Doctrine only; artifact-first re-wake (above) stays the method — never reap
on silence.

**Adaptive watchdog cadence — retune after the SECOND stall of a class.** A fixed, long
poll interval wastes dead wait across repeated dropped re-wakes.
A recurring stall class costs `interval/2 × occurrences`; match the cadence to the
actual work-unit duration (reviewer lanes run 2–9 min → a 6-min probe, not 20). The trigger
is the second stall of the same class in a session — one stall is noise, two is a cadence
signal.

**Receipt-confirmation for load-bearing orders — batching guarantees delivery-on-next-yield,
NOT delivery-before-a-relief.** Inbox batching
delivers on the recipient's next yield and loses nothing — but an idle/relieved/committed
teammate never yields, so a verdict can land after its consumer is gone. For a load-bearing
order or verdict: confirm receipt explicitly ("confirm the order was received") or watch for the
acting-on-it signal. When a verdict lands AFTER its consumer was relieved or committed, the
**orchestrator** owns folding it durably into the tracked plan.

**Conductor-relief protocol (behavioral spec for the conductor lease).** Relieving an in-flight
conductor cleanly, without collisions, requires: (1) relieve with **explicit terms** — a no-fire order + read-only
reference + a **named** successor; (2) spawn the fresh conductor; (3) forward the predecessor's
load-bearing notes. Honor a conductor's own **context-depth self-report immediately** — a deep-context
flag is the cheapest collision predictor. This is the behavioral spec the durable mechanism must
encode: a lease/claim-file on an atomic-FS primitive (O_EXCL / atomic rename + a monotonic fencing
token), NOT a start-time guard, which is insufficient.
