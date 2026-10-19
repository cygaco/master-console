# Echo-Trap Monitoring

Reference doc on detecting and surfacing **echo traps** — situations where an agent (Alpha, Beta, Gamma, or Delta) repeats the same reasoning, tool sequence, or dispatch within a short window.

## Why this matters

An LLM in a loop can produce 30 messages of plausible-looking work without making forward progress. Echo traps are the most common cause of:

- Builder cycles that fail-then-redispatch on the same brief without learning
- Beta returning the same DECIDE/DIRECTIVE for variants of the same question
- /fix:fast escalating to /fix:deep then back to /fix:fast (verdict ping-pong)
- Reviewer repeatedly catching the same issue in different files without proposing a class-fix

The hard cost is tokens; the soft cost is that humans stop trusting the orchestrator output because it stops mapping to forward state.

## Signals

Each signal has a deterministic detector that can run cheaply against `paths.eventsFile` and `paths.tracesFile`. The thresholds below are **starting** values — tune via `/scan:patterns` as evidence accumulates.

### 1. Tool-call echo

Same `tool_name` + same `tool_input` (or hash thereof) appearing **3+ times in a 20-call window** with no intervening write tool. Excludes Read/Grep/Glob (legitimate to repeat) and any tool with `tool_response` < 200 bytes.

### 2. Agent-dispatch echo

Same `subagent_type` dispatched with prompt-similarity ≥ 0.85 (token-set Jaccard or simple bigram overlap) **2+ times in a 10-dispatch window**. Excludes successful chained dispatches (e.g., builder → reviewer → compliance — different subagent_type each).

### 3. Trajectory entropy

Compute Shannon entropy over the last 30 tool-call types. If entropy is **< log2(3)** (i.e., the agent is cycling through ≤ 3 distinct tools), flag. Healthy entropy is typically 2.5–3.5 bits.

### 4. Reasoning-trace ping-pong

In `paths.tracesFile`, two trace entries with `quality_score ≤ 2` AND `framework` swapping between two values within the same session AND covering the same problem hash. Sign of verdict instability — the agent is re-deciding the same question.

### 5. Beta DECIDE/DIRECTIVE recurrence

In `paths.betaEvents`, the same DIRECTIVE issued **3+ times in the same calendar day** with the same problem signature. Indicates Beta is being consulted on a class of question that should be encoded as a rule.

### 6. Hook-block recurrence

A hook block firing the same `block_reason` **5+ times in 7 days** without any commits referencing the block_reason in their message. The agent keeps tripping the guard but never addressing the root cause.

## Where this is wired

| Where | What |
|---|---|
| `/scan:patterns` (`diagnose` mode) | Steps 1-2 already cluster signals. Add step "Echo-trap audit" that runs detectors 1-6 and reports any active traps. |
| `scripts/hooks/response-size-guard.js` | Already logs `response_size` events. Future extension: also emit `echo_trap` events when detector 1 or 2 fires on the just-completed Agent dispatch. |
| `scripts/check-guard-promotion.js` | Already runs detector 6 (block recurrence) for warn-only guards. Reused. |
| `/oneshot:retro` | Detector 4 (reasoning ping-pong) belongs here, since retros already pull traces. |

## Anti-pattern: false-positive echo trap

Some sequences look like echoes but are not:

- **Polling a long-running build**: same `Bash` call to `git status` 10 times is the agent waiting, not looping. Filter on `tool_response` length variance and on intervening writes.
- **Parallel survey**: Explore agents legitimately query the same Glob multiple times in parallel. Cap detection to **sequential** repeats (no concurrent-dispatch detection).
- **User-driven repeats**: if `cat: user_message` events appear between repeats, the user is steering — do not flag.

## How to act on a fired trap

1. **First fire** — emit advisory only. The orchestrator may genuinely need to retry once.
2. **Second fire in same session** — Beta is consulted with `class: echo-trap, signature: <hash>`. Beta returns DIRECTIVE on whether to abort the loop or continue.
3. **Third fire in same session** — hard-stop the orchestrator's current sub-task and surface to the user via Beta ESCALATE.

This is a **trapdoor**, not a guard. Echo traps must surface eventually; if a session ends with an unresolved trap, the next session's startup hook should re-emit the warning so it cannot quietly drop.

## See also

- `/scan:patterns` — runs the detectors listed here
- `paths.reference/reasoning-frameworks.md` — quality scoring rubric
- `paths.maps/enforcements.jsonl` — current coverage map for related guards
