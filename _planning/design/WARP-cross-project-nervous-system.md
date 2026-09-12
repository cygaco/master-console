# WARP.md — The Cross-Project Nervous System

> **Status: DESIGN SPEC — NOT BUILT.** This is a vision + architecture artifact authored
> 2026-06-07 for the main thread to build later. Nothing here ships until specced into a
> roadmap epic + tracker. Where it says "we already have X," that X is verified to exist in
> canonical; where it says "build," that does not exist yet.
>
> Authored by: Alex α · session `s-q7gbsn` · 2026-06-07

---

## 0. One paragraph

**Warp** is the layer that lets WarpOS projects *talk to each other*, reach conclusions on
their own (e.g. "the framework shipped a broken system, here's the fix"), and run the
**flag → fix → mint → update** loop — **autonomously but safely**, inside a mandate the
operator pre-authorizes once and walks away from. It is the product face of the moat: the
bus is the nervous system, the loop is the reflex, the Charter is the leash.

The whole design rests on one invariant: **conversation flows freely between projects;
levers (anything irreversible) never move without either a live human signature OR a
pre-signed mandate with hard rails.**

---

## 1. Why — the motivating failure (a real one)

Verified-real gap in canonical as of 0.15.1 (the kind of thing Warp should self-heal):

> 0.15.1 shipped the **enforced-tracker (Epic) system** — `scripts/trackers/validate.js`
> (fail-closed), `/trackers:validate`, the tracker hooks, and the spec. But it shipped the
> **referee without the field**:
> - `scripts/trackers/` contains **only** `validate.js` — no initializer.
> - `.claude/commands/trackers/` contains **only** `validate.md` — no `/trackers:init`.
> - `framework/releases/0.15.1/release.json` has `migrations: []` — existing consumers get nothing on update.
> - The 10 templates exist in canonical (`trackers/templates/*`) but aren't generatable downstream.
>
> Result: a consumer that runs `/warp:update` to 0.15.1 gets a red, fail-closed validator
> with **no supported way to make it green**. The Epic system is unusable as shipped.

This is the **2nd occurrence of the same bug class** ("shipped the enforcer, not the thing
it enforces") after WI-50 (the dead `/portfolio:new` installer). That recurrence is the
proof that the loop needs a *named enforcer*, not just a one-off patch (see §6 + §7).

**The dream Warp makes real:** the consumer project *notices* this, *tells* WarpOS, WarpOS
*verifies + fixes + mints 0.15.2*, the consumer *updates* — and the operator reads one
digest in the morning instead of driving every step.

---

## 2. What already exists (the ~70% — the unrecognized seeds)

Warp is mostly **assembly**, not invention. The parts exist; nobody wired them into one fabric.

| Existing piece | What it does today | What it's missing for Warp |
|---|---|---|
| **Cross-session inbox** (`/session:write`, `/session:read`; `scripts/hooks/lib/logger.js` → `events.jsonl` `cat=inbox`) | Append-only broadcast bus; sessions see messages on next prompt; 24h TTL | Scoped to **one repo's** `events.jsonl`. **Poll-on-prompt**, not live. One-way. |
| **`/portfolio:run`** (`scripts/portfolio/dispatch.js`) | Cross-repo dispatch — spawns a Claude subprocess in another product's tree, argv-array `shell:false`, gates skill+args against shell metacharacters | **One-shot.** Returns an exit code, not a live channel. |
| **`/warp:flag` → `/warp:reconcile`** (WARPOS.md gap register) | Products report framework gaps *upstream*; reconcile re-verifies + fixes in canonical | One direction (product→framework), batch, not real-time, manually driven. |
| **`/warp:release`** | Promote, bump, regen, build capsule, run gates, ff-merge, tag — one command | No autonomous trigger; no signing (see §5). |
| **`/warp:update` / `/portfolio:sync`** | Pull a release into a consumer / across all products | Silent loop; no live status; no canary/halt; verifies checksum (corruption) not signature (tamper). |
| **`/session:turbo` safety floor** (`scripts/turbo/apply.js`, `scripts/hooks/authorization-gate.js`) | Bounded pre-auth with a floor that's NEVER bypassed | Scoped to *this Claude session's* tool calls, not a cross-project mandate. |
| **`/sprint:full --autonomy turbo` preset** (`paths.sprintFullAutonomy`) | Declarative preset that widens autonomy with an uncrossable floor | Pointed at one sprint, not the cross-project loop. |
| **Beta (α/β company model)** | Independent judge; under batch-autonomy, *every* decision routes through Beta | Not yet wired as the "night-shift on-call" for an unattended Warp run. |

---

## 3. The three gaps to close

1. **Cross-repo scope.** The inbox lives in each repo's `events.jsonl`. The Warp bus must
   live one level up — at the machine home (`~/.warpos/bus/`, alongside the existing
   `~/.warpos/portfolio.json` registry) — so every product writes to and reads from the
   *same* log.
2. **Live, not polled.** "Debugging live during updates" needs a *tail/subscribe* model
   (`fs.watch` + a long-running console), not the inbox's per-prompt poll.
3. **Bidirectional + addressable.** Products must stream structured status *back* while they
   work (`applying migration X`, `step 3/7 ok`, `FAILED: hook foo`), addressable by slug —
   not just fire-and-forget with an exit code.

---

## 4. Architecture — "how tf"

**Do not invent a daemon.** Promote the pattern that already works (the inbox) from
per-repo to per-machine. Three new parts:

- **`warp:emit`** (a tiny lib + hook) — any product appends a structured event to
  `~/.warpos/bus/<date>.jsonl`. Mechanically identical to `logger.js`'s inbox write,
  pointed at the machine-level path. Crash-safe, cross-platform, no process to babysit.
- **`warp:watch`** — a long-running console that `fs.watch`es the bus and renders a live
  board (rows = projects, columns = state). **This** is the "live" part — the console is
  the tail, not the per-prompt poll.
- **Staged `warp:update` / `portfolio:sync`** — instead of looping products silently, each
  product emits to the bus as it applies a migration. The console shows the wave move.

### Transport decision (the one real fork)

```
Option A — File-bus (~/.warpos/bus/*.jsonl + fs.watch)        ◀ RECOMMENDED
  + Reuses the exact inbox pattern that already works
  + No daemon, no ports, no Windows socket quirks, crash-safe
  − "Live" = ~100ms fs.watch latency, not true push (fine for humans)

Option B — Local daemon (warpd, sockets/HTTP pub-sub)
  + True real-time push, request/response RPC-style debugging
  − A daemon to start/stop/babysit; lifecycle + port + Windows quirks

Option C — Harness teams (TeamCreate + SendMessage)
  + Real live agent-to-agent messaging, already exists
  − Session-to-session within ONE harness run, NOT repo-to-repo across
    separate Claude processes — wrong granularity for this
```

**Build A first.** It's the inbox move, hoisted one directory up, plus a watch console.

### Killer use case — canary `warp:update`

1. Operator runs `warp:update --staged` across the portfolio.
2. Product 1 applies the migration, streaming each step to the bus → `warp:watch` shows green.
3. Product 2 hits a broken hook → emits `FAILED` → the console **halts the wave** before 3..N apply.
4. Operator `portfolio:run product-2 /fix:deep` against the *one* broken product, watching
   its events live, fixes it, resumes the rollout.

That is a **staged rollout + live observability** layer on top of `portfolio:sync`.

---

## 5. The autonomous loop

Every stage already has a skill. Warp **chains** them and streams status to the bus:

```
project hits gap → /warp:flag        (append to WARPOS.md)              [exists]
WarpOS verifies  → /warp:reconcile   (RE-VERIFY in canonical first!)    [exists]
WarpOS fixes     → builder + gauntlet in a worktree                     [exists]
WarpOS mints     → /warp:release     (bump, capsule, gates, sign, tag)  [exists, +sign]
project updates  → /warp:update --apply / /portfolio:sync               [exists, +verify-sig]
```

**Critical: re-verify, don't trust the flag.** Memory ED-008 + this very session: ~half of
flagged gaps are already fixed upstream, and flag *content drifts* (the tracker flag said "9
templates"; there are 10). The loop MUST confirm each gap reproduces in canonical before building.

### Gated autonomy — NOT full autonomy

The tracker gap is the argument for this. The *correct* fix isn't "make the validator green"
— it's (1) an initializer, (2) a migration, **and (3) a release gate so the bug class can't
recur.** A naive autonomous loop would do (1) and stop, missing the enforcer that is the
entire point. So:

- **Auto (reversible):** flag → verify-reproduces → classify *mechanical vs. design* →
  draft fix in a worktree → run gauntlet → stream to bus.
- **Gated (irreversible / design-class):** minting a release, shipping to consumers, and any
  *design*/enforcer-level change wait for a signature — live OR pre-signed via the Charter (§6).
- **Consumer side:** `warp:update` verifies the **signed** capsule before applying.

---

## 6. Security model

**Headline: WarpOS today is single-tenant-by-assumption.** It is safe because it is one
trusted operator on one machine. "Other people using it" breaks that assumption in exactly
three places: the **update channel** (supply chain), the **hooks** (code-exec-on-install +
`smart-context.js` sends prompt+memory to Haiku — a privacy disclosure), and any
**auto-acting bus/loop** (confused deputy). None are blockers; all must be designed before multi-tenant.

### The 5 rules (each with a named enforcer — per CLAUDE.md policy hygiene)

| # | Rule (ELI5) | Formal | Enforcer (to build) |
|---|---|---|---|
| 1 | **Notes aren't commands.** Reading a message never pulls a lever. | The bus carries *events (facts)*, not commands. Nothing `eval`s a bus message. | Bus consumer has no exec path; lint that flags any "run/apply/exec" keyed off a bus record. |
| 2 | **A grown-up signs the irreversible.** | Mint/ship/force-push wait for a live signature OR a Charter pre-auth (§6). | `authorization-gate.js` extended to the Warp loop; safety floor uncrossable. |
| 3 | **Check the tamper-proof sticker.** | Releases are **signed**; `warp:update` verifies the signature before applying. Checksums catch corruption, NOT tampering. | **Signing + verify-on-apply.** ← the ONE security upgrade needed before strangers. |
| 4 | **The mail slot is narrow.** | Every cross-boundary input (bus msg, flag content) is untrusted + gated, like `portfolio:run` already gates skill+args. | Input gate on bus + flag content; redaction (no secrets/PII cross a repo boundary). |
| 5 | **Nobody grades their own homework.** | No agent renders a verdict on work it authored; FAIL is binding; dispatcher can't override. | Existing gauntlet invariant (RT-2026-06-02-doe-dispatch-independence) extended to the loop. |

### The 3 walls that keep it off the operator's canonical (GitHub)

Other people run the loop on **their own** copy — never the operator's `cygaco/WarpOS`:

1. **The repo lock.** No push access to the operator's GitHub. Not a WarpOS feature — GitHub auth. Holds even if everything else fails.
2. **Notes aren't commands.** A flag "upstream" is a *suggestion* in a channel the operator controls; the operator runs reconcile, not the downstream.
3. **The closed engine.** Per the locked productization model, the engine is the moat and stays the operator's; consumers get the cockpit + updates, not the source.

**The asymmetry to internalize:** the risk was never *them reaching up to you* (git blocks
that). It's *you broadcasting down to them*. So the trust to earn is **their** trust that
your package is authentic — which is why Rule 3 (signed releases) is the load-bearing upgrade.

---

## 7. The Warp Charter — pre-authorizing a Warp session

The operator's ask: *"pre-auth a Warp session and let the projects duke it out, update, ship
— without me managing approvals."* This is a **mandate**, not `/session:turbo` (which only
pre-auths the current Claude session's tool calls).

**Analogy:** a corporate card with a spending limit, a category whitelist, a hard "never"
list, and a "call me if…" rule. You set the card's rules once and walk away — you don't
approve each purchase.

### The 6 dials (set once, up front)

| Dial | Plain English | Example | Backed by |
|---|---|---|---|
| **1. Who's in the room** | Which projects may talk + be changed | "all portfolio" / "companycam + masterconsole" | `~/.warpos/portfolio.json` |
| **2. What they may do** | Escalating power ladder | *talk/propose* (free) → *fix+test in sandbox* (free) → **mint update** (pre-signed) → **ship to projects** (pre-signed) | extends `sprint:full` autonomy preset |
| **3. What they may NEVER do** | Floor that survives any mandate | never force-push, never delete `backup/*`/`pre-*`, never spend ≥ $X, never leave the room, never ship a failed gauntlet | turbo safety floor + `authorization-gate.js` |
| **4. How far it goes** | Budget | time (2h) / $ (API spend) / "until the loop goes quiet" — first to hit | new: Warp session budget tracker |
| **5. When to wake you** | Circuit-breakers | unfixable after N tries · a *design*-class change · a release that would break a consumer · **Beta ESCALATE** | Beta as night-shift on-call |
| **6. What you get back** | The morning digest | one report: what they argued, what they decided, what shipped, what's parked | new: Warp session report (extends `/report`) |

Dials 1/2/4 = how far the gate opens. Dials 3/5 = the rails that never open. Dial 6 = the receipt.

### Beta is the night manager

While the operator sleeps, the company isn't unsupervised: **Alpha runs the loop; Beta holds
the page-the-CEO authority.** Under batch-autonomy every judgment routes through Beta, not
the orchestrator (learning 2026-06-05). Beta decides "act on this" vs. "wake the boss" per
Dial 5. The operator isn't gone — just asleep with a pager that only rings for §5 items.

---

## 8. Build plan (suggested order for the main thread)

1. **Thin slice — prove the bus.** Build `warp:emit` (machine-level append) + `warp:watch`
   (fs.watch board) and wire them into the *existing* `portfolio:sync` so you can SEE a live
   board this session. ~an afternoon. A live board beats a spec doc for conviction.
2. **Fix the motivating gap (and prove the loop by hand).** Build `/trackers:init` +
   the `0.15.1→0.15.2` migration + add templates to the capsule manifest + **the release
   gate enforcer** (§7 below) → run gauntlet → hold at `/warp:release` for operator signature.
   This both fixes a real shipped-broken system and walks the loop once manually.
3. **Chain the loop.** flag → reconcile (verify-reproduces) → fix+gauntlet → release (gated)
   → update, with each stage streaming to the bus. Gated autonomy from §5.
4. **The Charter.** Implement the 6-dial mandate as a declarative preset (model it on the
   `sprint:full` autonomy preset + turbo floor) + the Warp session budget + the morning digest.
5. **Signing.** Sign releases + verify-on-apply (Rule 3) — required before any multi-tenant use.

### The release-gate enforcer (closes the recurring bug class)

> **Gate:** if a release adds a fail-closed validator that declares required paths
> (§33-style), the capsule MUST deliver those paths OR ship an initializer for them.

Same bug class as WI-50 + the tracker gap — "shipped the enforcer, not the field." Wire it
into the release gates so attempt #3 self-detects. This is itself an instance of CLAUDE.md's
"every policy needs a named enforcer."

---

## 9. Open decisions (for the operator / main thread)

- **D1 — Distribution model.** Fork-and-own (consumers get a full independent canonical) vs.
  vendor-broadcast (consumers consume the operator's signed releases; engine stays closed).
  The locked Master Console model points at vendor-broadcast; confirm.
- **D2 — Bus transport.** A (file-bus) recommended; confirm we're not reaching for B (daemon) early.
- **D3 — Default mandate floor.** What's the *default* "never" list (Dial 3) for a Warp
  session, before per-run overrides?
- **D4 — Where the bus lives.** `~/.warpos/bus/` proposed (machine home, next to portfolio.json). Confirm.

---

## 10. References (real, existing)

- Inbox / bus pattern: `scripts/hooks/lib/logger.js`, `.claude/commands/session/write.md`, `.claude/commands/session/read.md`
- Cross-repo dispatch: `scripts/portfolio/dispatch.js`, `.claude/commands/portfolio/run.md`
- Flag/reconcile loop: `.claude/commands/warp/flag.md`, `.claude/commands/warp/reconcile.md`, `WARPOS.md`
- Release/update: `.claude/commands/warp/release.md`, `.claude/commands/warp/update.md`, `.claude/commands/portfolio/sync.md`
- Pre-auth + floor: `scripts/turbo/apply.js`, `scripts/hooks/authorization-gate.js`, `.claude/commands/session/turbo.md`
- Autonomy preset: `paths.sprintFullAutonomy`
- Portfolio registry: `~/.warpos/portfolio.json` (HOME-anchored; resolver `scripts/portfolio/registry.js` — the old project-local paths key was removed in T-20260611-309)
- The motivating gap: `scripts/trackers/validate.js`, `framework/releases/0.15.1/release.json`, `trackers/templates/*`
- Productization shape (memory): closed local engine + hosted cockpit + cloud brain; engine = moat
