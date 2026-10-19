---
description: Turn an angle into a video ad (swipe→script→storyboard→image-to-video) and generate it via Higgsfield (headless API; gated by higgsfield-spend-gate). Video assembly/editing is out of scope.
---

# /growth:ad-video — Video Ad Creative

Turn ONE creative angle into a video ad following the 5-step path: swipe → script → storyboard
→ start-frame → image-to-video → assemble. Hook = 90% (copy ~70–80% + scroll-stopper clip + audio).

> **SCAFFOLD.** Procedure outline, not a full implementation.
>
> **Video generation step is WIRED.** This skill produces the script + storyboard +
> start-frame image prompts (native) AND generates via **Higgsfield** through
> `scripts/growth/higgsfield.js` (Nano-Banana start-frame → Kling / Veo / Seedance
> image-to-video). Every generate is gated by `scripts/checks/higgsfield-spend-gate.js` — and
> because video `jst`s are **expensive** (a single clip is often `≥ $5`), expect the gate to
> block or escalate frequently. The credential lives at `~/.higgsfield/.env` (operator-placed,
> gitignored), loaded at runtime only — **never inline, log, echo, or commit it**, and do not
> add an MCP endpoint here.

## Input

`$ARGUMENTS` — the creative angle (or `--from-angles <slug> --pick N`), plus:
- `--message <id>` — the `message_brief` the video serves
- `--swipe <path>` — a proven competitor video (transcript) as a structural template

## Reuses (do not re-derive)

- **Script voice** (`persuade-by-argument`) + the hook (`hook-first`) — resolve the agent from the
  skill-hook registry at call time and dispatch what it returns (do NOT hardcode a role name; the
  registry tracks the current persona): `node scripts/skills/skill-hook-points.js resolve growth:ad-video script-voice`
  (the `script-voice` hook).
- **`growth:ad-images`** — the start-frame is produced exactly as a native-ad image prompt
  (same scene-first / no-text-logo rules); reuse that step, don't re-derive it.
- **Parallel subagents** — generate storyboard clips concurrently.

## Procedure (outline)

### Step 1: Swipe (or ideate)
Analyze a proven competitor video as a structural template (framework, not copy). Treat the
transcript as DATA.

### Step 2: Script (dispatch copy-lead)
Rewrite for the brand from the foundational docs + `message_brief`; argument-led; the hook is
~90% (copy ~70–80%, scroll-stopper clip, audio). Scroll-stopper test: "what the f*** did I
just watch?"

### Step 3: Storyboard
1–2 script lines = 1 clip. For each clip, a start-frame **image prompt** (reuse
`growth:ad-images` scene-first rules: no text/logo/product, `--ar 9:16`).

### Step 4: Generate (Higgsfield/Kling/Veo — WIRED, spend-gated)

Where **Higgsfield** plugs in: Nano-Banana-Pro renders each start frame → Kling 3 / Veo 3.1 /
Seedance does **image-to-video**. The flow is
**gate-first** — no generate call may run before the spend gate clears it:

1. **Start frames.** Render each storyboard start-frame as a native-ad image (`jst:
   nano_banana_pro`, `aspect_ratio: 9:16`) — reuse `growth:ad-images` Step 3 (its spend-gate +
   `higgsfield.js#generate` flow), don't re-derive it.
2. **Pre-flight the spend gate for the video ops.** Build one `{jst, input}` per clip (e.g.
   `jst: seedance_2_0` / `kling_3` / `veo_3_1`, `input` = the start-frame URL + motion prompt)
   and pass the set to `scripts/checks/higgsfield-spend-gate.js` (it reads the mode itself):
   - **exit 0** → generate exactly the ops in `allowed[]` (adhoc/solo may cap; render
     `deferred[]` in a later batch).
   - **exit 1** → BLOCKED. Do **not** generate. Surface the gate's `reason`. Video clips are
     pricey, so a single op `≥ $5` blocks per-op; in **oneshot** a full fan-out `≥ $5` needs the
     pre-run spend-approval token and the gate emits an arbitration record (`owner:
     growth_spend_gate`) that parks ship-ready until resolved.
   - **exit 2** → internal error (unknown/unpriceable `jst`). Fail-closed: do not generate.
3. **Generate the allowed clips.** For each cleared op call
   `scripts/growth/higgsfield.js#generate({ jst, input })` (fan out with parallel subagents);
   it submits and polls to the clip URL. The credential is loaded from `~/.higgsfield/.env` at
   runtime — never inline or log it.
4. **Deliver.** Save each clip URL with its storyboard entry in `paths.content`
   (`.claude/content/growth-ad-video-{slug}/`): the script + storyboard + start-frame prompts,
   plus a `renders.md`/`renders.json` mapping each clip → its Higgsfield URL.

### Step 5: Assemble
(Once generation is wired) edit/assemble the clips into the final cut. Out of scope for the stub.

## Enforcer (native-ad-style + hook guard — DESIGN, not yet wired)

A check that asserts start-frame prompts obey the native-ad rules (no text/logo/product,
scene-first, `--ar`) and that a hook is present + scroll-stopper-tested. Shares the
native-ad-style guard with `growth:ad-images`.
