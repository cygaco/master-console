# MC — Your Agent Company

> Plain-language map of who's who. Snapshot: 2026-07-16. (Source files at the bottom; the keystone is `.claude/agents/_org/role-registry.json`, with the org & runtime & model-spread decisions recorded in ADR-0007 / ADR-0009 / ADR-0016 under `president/_system/policy/adr/`.)

---

## In three lines

It's a **company you run.** **You're the Founder & CEO** — direction + the big, irreversible calls. **Alex is your President** — the AI who runs the company day-to-day. Below Alex: three **departments**, plus a **shared knowledge** layer everyone draws from.

---

## The org chart

```
                              YOU — Founder & CEO
                                       │
                              ALEX — President
                          faces:  α run · β check · γδε deliver
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
     DIRECTOR OF               DIRECTOR OF                     DIRECTOR OF
      PRODUCT                  ENGINEERING                     GROWTH
   ├ Product Lead           ├ Frontend Lead                 ├ Research Lead
   ├ Design Lead            ├ Backend Lead                  ├ Copy Lead
   └ Quality Lead           └ Security Lead                 ├ Conversion Lead
      dispatches QA           each pod Lead dispatches:     └ Marketing Lead
      Reviewers ·             Builder · Reviewer · Fixer
      design-quality ·        (Reviewer verdict BINDING —
      visual-review           the Lead can't override a FAIL)

   ══ SHARED  _knowledge/  (DATA — fed by the leads, drawn by all) ═══════════
   audience ← Research Lead · copy ← Copy Lead · design ← Design Lead · state ← per sprint
```

---

## Alex — one person, faces

**Alex is the President.** "Alex" is his name (the hidden true-name — call him Alex anytime); "President" is his role. He shows up in **faces** by mode — a face is a *mode of one person*, not a separate identity:

| Face | What Alex is doing |
|---|---|
| **α** | **running it** — turning your ideas into plans, dispatching the work |
| **β** | **checking it** — the independent second opinion ("is this wise?") |
| **γ / δ / ε** | **delivering it** — γ a feature (adhoc) · δ a whole app (oneshot) · ε a sprint |

> Why β is its own face: *you can't be your own second opinion.* The face that makes a call can't also judge it. (For quick throwaway work you skip β — that's "solo mode.")

---

## The departments (the colleagues — *not* Alex)

### 🟦 Product — *what to build, for whom, is it good* (Director of Product)
- **Product Lead** — the spec: requirements, stories, acceptance criteria, backlog.
- **Design Lead** — the experience: UI/UX, flows, the mockup the build follows.
- **Quality Lead** — the verdict on *quality* — does it work **and** is it good to use. **Dispatches QA Reviewers** (traceability · integrity · functional) + owns **design-quality** + **visual-review**. *(Design Lead authors; Quality Lead judges — verdict binding.)*

### 🟩 Engineering — *how it's built well* (Director of Engineering)
Three self-contained pods. Each **Lead dispatches a Builder + Reviewer + Fixer**:
- **Frontend Lead** → FE Builder (screens) · FE Reviewer (code quality) · FE Fixer
- **Backend Lead** → BE Builder (the engine) · BE Reviewer (code quality) · BE Fixer
- **Security Lead** → Security Builder (hardening) · Security Reviewer(s) (attacks it) · Security Fixer

**The guard that keeps pods honest:** the Reviewer's verdict is **binding** — the Lead (and the Director of Engineering) **cannot override a FAIL**, and can't hand-pick a friendly reviewer (roster is registry-fixed). The Fixer authors fixes, so the Reviewer **re-runs after every fix** (a fix can open a new hole). Independence comes from the *binding verdict*, not from separating the org.

### 🟧 Growth — *the message, the audience & how it grows* (Director of Growth)
- **Research Lead** — who the customers really are (audience dossiers → `_knowledge/audience`).
- **Copy Lead** — the words: the argument, the hooks, the voice (→ `_knowledge/copy`).
- **Conversion Lead** — converting pages (copy + design): one job, one CTA, hook→proof→CTA.
- **Marketing Lead** — paid traffic / campaigns; scores SCALE/TEST/SKIP; LTV:CAC.
- The Director owns **message coherence** (does it cohere with avatar / proof / beliefs / objections).

---

## Which AI runs each seat (provider-by-department)

The company runs a **model spread** — different seats run on different AI labs, so a reviewer is never the same mind as the builder it checks (ADR-0016 / DISPATCH.md §8). In plain terms:

- **Engineering builds on Claude.** Builders + fixers run `claude-sonnet-5`; the pod Leads run `claude-opus-4-8` and the Director runs `claude-fable-5` (the top brain). Their **code-quality reviewers run on OpenAI GPT** — a different lab, so the review isn't blind to Claude's own blind spots.
- **Product & Growth think on GPT.** The Directors and most leads (Product, Design, Copy, Conversion, Marketing) run the `gpt-5.6` family for judgment and authoring; the Research Lead runs Gemini (via the Antigravity `agy` CLI).
- **Quality stays Claude.** The Quality Lead + design-quality + visual-review are **Claude-pinned** — they fan out helpers in-process, which only Claude can do.
- **Security is a 3-lab panel.** A Claude planner + judge (`claude-fable-5`) runs three hunter labs — Gemini, GPT, and Claude — and **fails closed** (blocks) if it ever loses a lab, so a security pass is never single-lab.
- **Alex's own tools consult GPT.** β (the second opinion) runs on GPT as an on-demand consult, and the President keeps two GPT-run tools of his own: the **Cabinet (ζ)** — freeform outside counsel — and the **Ops-Analyst (η)** — the between-cycles auditor. (These two, plus the five faces, are the only seats that carry a Greek letter — call-signs live in the President's office only.)

If a non-Claude seat's AI is down it **falls back to Claude** — except security, which blocks rather than lose its cross-lab guarantee. Full per-role chart: `AGENTS.md § Dispatch Topology & Model Spread`; the source of truth is the role registry.

---

## The shared knowledge (`_knowledge/`) — DATA, fed by the leads, drawn by all

Not an org box — the company's **brain**, contributed-to by the leads and read by everyone:
- **audience** ← Research Lead · **copy/voice** ← Copy Lead · **design principles** ← Design Lead · **live state-of-record** ← updated per sprint.

Product grounds in it (what to build), Growth grounds in it (who / what message), Alex grounds in it (strategy). Copy reaches builders as a **`COPY.md` contract** (authored from `_knowledge/copy`), never invented at build time. So Research and Copy are *real roles* (under Growth), but the *knowledge they produce is shared*.

---

## Two rules that make it trustworthy

1. **Nobody grades their own homework.** No one renders a verdict on work *they authored*, and no boss can override a reviewer's FAIL — enforced by **binding verdicts**, not org walls. (That's why a Reviewer can sit inside a pod: it grades, it didn't author.)
2. **Workers fan out, managers are singletons.** A Lead can run *several* Builders/Reviewers/Fixers in parallel (each in its own worktree); there's exactly **one** of each Alex face · Director · Lead. A Lead scales by fanning out workers, never by cloning itself.

---

## What's landed

The org rewrite (ADR-0007) and the **ε** sprint runtime (ADR-0009) are **both landed on `main`** — what this doc describes is the live system, not a plan:

- **All five faces are real & running:** Alex (α run · β check) + the three delivery faces (γ adhoc · δ oneshot · **ε sprint**), builders + reviewers + per-pod fixers, the directors + their teams — all under the department-based folders and the current role names.
- **The keystone is wired:** the **role registry** (`_org/role-registry.json`) is the single role↔spec source of truth, and dispatch routes derive from it · the department folders (`engineering`/`product`/`growth`) + `president/` (faces) replaced the old mode-duplicated folders · `_knowledge/` is the shared brain · the skill- and sprint-hook-point registries live alongside the keystone in `_org/`.
- **ε actually dispatches both route classes:** CLI builders + reviewers (via `dispatch-claude.js` / `dispatch-agent.js`) and the in-process roster (via the harness Agent tool + evidence-bound `record-inprocess`), conducting the full sprint lifecycle (plan→design→build→gauntlet→release→retro) through `scripts/sprint/epsilon-runtime.js`.

Master plan + recovery anchor: `DUMP.md`.

---

## Where each piece lives (today)

| Piece | File |
|---|---|
| Alex's faces (α/β/γ/δ/ε) | `.claude/agents/president/{alpha,beta,gamma,delta,epsilon}.md` |
| Departments & teams | `.claude/agents/{engineering,product,growth}/` (builders · reviewers · fixers · leads · directors) |
| **The keystone — role↔spec source of truth** | **`.claude/agents/_org/role-registry.json`** (dispatch routes derive from it) |
| Machine-readable org | `.claude/agents/_org/org-map.json` |
| Department rulebooks | `.claude/agents/_principles/registry.json` |
| Decision policy + ADRs | `.claude/agents/president/_system/policy/` (ADRs under `…/adr/`) |
| Model spread (provider-by-department) | ADR-0016 · `AGENTS.md` § Dispatch Topology & Model Spread · source of truth = the role registry |
| ε sprint runtime | `scripts/sprint/epsilon-runtime.js` (ADR-0009) |
| Master plan + recovery anchor | `DUMP.md` |
