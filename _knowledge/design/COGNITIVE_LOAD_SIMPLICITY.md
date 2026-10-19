---
guide: COGNITIVE_LOAD_SIMPLICITY
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [visual-hierarchy, component-usage, layout, copy]
sources:
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
  - "https://lawsofux.com/hicks-law/"
  - "https://lawsofux.com/millers-law/"
  - "https://lawsofux.com/teslers-law/"
  - "https://lawsofux.com/cognitive-load/"
  - "https://www.nngroup.com/articles/progressive-disclosure/"
  - "https://cxl.com/blog/does-offering-more-choices-actually-tank-conversions/"
---

# Cognitive Load & Simplicity

**Cognitive load** is the mental effort an interface demands to be understood and used. **Simplicity** is the discipline of minimizing that effort — fewer choices, fewer steps, chunked information, recognition over recall, and showing only what's needed when it's needed — *without* hiding what the user actually requires. The governing instinct: **subtract before you add.**

> One-line test: *on this screen, can the user tell — in under a second — what the one thing to do is, and do it without holding anything in their head? If they must read everything, count options, or remember a value from a prior screen, the load is too high.*

---

## 1. Why it matters

Every element, choice, and step is a tax the user pays on every visit. A first-time user (cold start) tolerates almost none; a returning power user tolerates a little. Excess load shows up as hesitation, errors, abandonment, and "I'll do it later." Reducing load is the highest-leverage usability move because it compounds across every interaction.

For the **agents this guide trains**:

- **design-lead** — this is the home of the owned `kiss` principle ("the simplest interface that does the job wins; subtract before you add") and the `cognitive-load` decision lens. It also enforces the cohort-limitation floor (#1 `build-for-audience-incl-limitations`): low-literacy or older cohorts have *less* working memory headroom and need recognition, defaults, and fewer steps.
- **conversion-lead** — the conversion page has one job; every extra field, link, or choice is a leak. Choice and friction reduction are direct conversion levers.
- **design-quality** gauntlet — backs the **`visual-hierarchy`** axis (clarity = simplicity at the layout altitude) and **`component-usage`** (recognition affordances, progressive disclosure realized with the right primitives).
- **visual-review** — backs the **`layout`** category (dense, overloaded screens) and the **`copy`** category (jargon and walls of text are load).

**Cognitive basis.** Working memory is tiny and fragile (Miller: ~7±2 items, modern estimates ~4±1) and decision time grows with the number and complexity of choices (Hick). Load splits into **intrinsic** (the task's inherent difficulty), **extraneous** (effort wasted on a confusing interface — the part design controls), and **germane** (effort that builds understanding). The job of simplicity is to **drive extraneous load to zero** and chunk the rest.

---

## 2. Core principles & techniques

### 2.1 Hick's Law — fewer/simpler choices, faster decisions

"The time it takes to make a decision increases with the number and complexity of choices" (Hick & Hyman, 1952). Implications:
- **Minimize choices when response time matters** (checkout, primary actions, navigation).
- **Emphasize a recommended option** so the user doesn't have to evaluate all of them (a highlighted default short-circuits the decision).
- **Decompose complex tasks** into smaller steps.
- **Caveat:** Hick's Law applies to *deliberate choice among comparable options*, not to scanning a familiar, well-categorized list. Don't use it to justify removing necessary capability (see Tesler, §2.7).

### 2.2 Miller's Law — chunk, don't cap at 7

"The average person can only keep 7 (±2) items in working memory." The real lever is **chunking**: "segment information into smaller, meaningful groups." Group form fields into labeled sections, break long numbers (phone, card) into chunks, cluster nav into a few labeled categories. **Do not** misuse 7±2 as a hard limit on menu items or content — the warning is explicit in the source.

### 2.3 Recognition over recall (NN/g #6)

"Minimize the user's memory load by making elements, actions, and options visible." Don't make users remember information across screens. Prefer:
- Dropdowns, autocomplete, and pickers over free-text recall.
- Showing the value on-screen instead of asking the user to remember it from a previous step.
- Familiar, consistent patterns (users recognize a standard pattern; they have to learn a novel one).

### 2.4 Aesthetic & minimalist design (NN/g #8)

"Interfaces should not contain information that is irrelevant or rarely needed." Every extra unit of content competes with the relevant content for the same finite attention budget. Minimalism here means *content* discipline, not a visual style — remove what doesn't serve the user's current goal.

### 2.5 Progressive disclosure — two tiers, no more

"Initially, show users only a few of the most important options. Offer a larger set of specialized options upon request." Hard constraints from NN/g:
- **Disclose everything users frequently need up front.**
- **Make the progression obvious** (clear "Advanced", "More options", expand affordance with strong information scent).
- **Never exceed 2 disclosure levels** — "designs that go beyond 2 disclosure levels typically have low usability because users get lost."

### 2.6 Subtract before you add; default the obvious

When asked to add a control, mode, or option, first ask whether something can be **removed or defaulted** instead. Smart defaults eliminate a decision entirely. Pre-fill what's known. Collapse the rare path behind progressive disclosure rather than putting it on the main screen.

### 2.7 Tesler's Law — the contrarian guardrail

"For any system there is a certain amount of complexity which cannot be reduced" (Larry Tesler, Xerox PARC). The corollary: irreducible complexity must be **absorbed by the design**, not deleted or dumped on the user. **Oversimplification is a failure mode**: hiding a critical action to look minimal, removing power-user efficiency, or splitting one simple task into many "clean" screens *adds* steps and load. Simplicity is minimizing *extraneous* load — not amputating necessary capability.

### 2.8 Trade-offs to name

- **Choice overload is real but not universal.** The famous jam study (24 options → 3% bought; 6 → 30%) is widely cited, but meta-analysis (Scheibehenne et al.) found the effect inconsistent — *quality of defaults and categorization* often matters more than raw option count. So: prefer fewer options and a clear default, but don't treat "more options" as automatically fatal.
- **Novice vs expert.** Progressive disclosure serves both: novices get the simple surface, experts reach the full set on request. The tension is resolved by *layering*, not by deleting.
- **Steps vs density.** Splitting to reduce per-screen density can *increase* total steps. Optimize total effort-to-goal, not per-screen tidiness.

---

## 3. Concrete examples (build terms — Next / Tailwind / Radix / shadcn)

**DO — one primary decision, recommended default highlighted**
```tsx
<RadioGroup defaultValue="pro">
  <Card><RadioGroupItem value="pro" /> Pro <Badge>Recommended</Badge></Card>
  <Card><RadioGroupItem value="basic" /> Basic</Card>
</RadioGroup>
<Button>Continue</Button>  {/* one primary next step */}
```

**DON'T — wall of equal options, no default (choice overload)**
```tsx
{plans.map(p => <Card key={p.id}><RadioGroupItem value={p.id}/> {p.name}</Card>)}
{/* 9 equal plans, nothing recommended → decision paralysis */}
```

**DO — progressive disclosure, 2 tiers**
```tsx
<form>
  {/* tier 1: what everyone needs */}
  <Input name="email" /> <Input name="name" />
  <Collapsible>
    <CollapsibleTrigger>Advanced options</CollapsibleTrigger>
    <CollapsibleContent>{/* rare fields */}</CollapsibleContent>
  </Collapsible>
</form>
```

**DON'T — every field visible at once (wall of options)**
```tsx
<form>{/* 22 fields including rare/advanced ones all on screen */}</form>
```

**DO — recognition over recall (pick, don't remember)**
```tsx
<Select> {/* user recognizes their option */}
  <SelectTrigger>Choose country</SelectTrigger>
  <SelectContent>{countries.map(c => <SelectItem key={c}>{c}</SelectItem>)}</SelectContent>
</Select>
```

**DON'T — force recall**
```tsx
<Input placeholder="Enter the confirmation code from the previous screen" />
{/* the code is no longer visible — pure recall load */}
```

**DO — chunk a long form into labeled groups (Miller)**
```tsx
<fieldset><legend>Contact</legend>{/* 3 fields */}</fieldset>
<fieldset><legend>Shipping</legend>{/* 3 fields */}</fieldset>
```

**DON'T — 12 ungrouped fields in one flat list.**

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect it |
|---|---|---|
| **Choice overload** | Decision paralysis; "I'll decide later" / bounce. | A single decision point offers many equal-weight options with no recommended default (e.g. ≥6 co-equal CTAs/plans/links and no "Recommended"). |
| **Multiple competing primary actions** | "Which do I click?"; hesitation. | >1 primary/`default`-variant action in one decision context (couples to VISUAL_HIERARCHY VH-3). |
| **Mandatory recall** | User flips back, errors, gives up. | A required input references a value not present on the current screen. |
| **Wall of options / dense screen** | Overwhelm; scanning fails. | All advanced/rare controls shown at once; no progressive disclosure; high simultaneous interactive-element count. |
| **>2 disclosure levels** | Users get lost in nested expanders/menus. | Disclosure nesting depth > 2. |
| **Redundant steps / over-fragmentation** | "Why so many screens for this?" | A trivial task split across many screens, each with one field. |
| **Jargon / wall of text** | Re-reading; misunderstanding; abandonment. | Long unbroken copy blocks; domain jargon with no plain-language alternative (couples to `copy`). |
| **Oversimplification (Tesler)** | Power user can't find a needed action; capability lost. | A known-necessary action is hidden/removed to look minimal, with no path to it. |

---

## 5. Relationship to other axes

- **`VISUAL_HIERARCHY.md`** — one clear focal point is *both* lower load and stronger hierarchy; the principles reinforce. A flat hierarchy is also a load problem.
- **`TYPOGRAPHY.md`** — readable, chunked type lowers reading load; walls of long-measure text raise it.
- **`copy`** (CONTENT_MICROCOPY) — plain language and specific labels reduce comprehension load.
- **Conversion** — choice/field reduction is a direct conversion lever; this guide is the load half of FRICTION_TRUST_FORMS.

---

## 6. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** (`visual-hierarchy`, `component-usage`) and **visual-review** (`layout`, `copy`) gauntlets can mechanically apply.

> Finding format: `axis|category` · `severity` · `observed` vs `expected`.

### CL-1 — One primary action per decision context  *(critical)*
- **Axis/Category:** `visual-hierarchy` / `layout`
- **Assertion:** each screen/step/decision cluster presents exactly one primary action (the obvious next step).
- **Detect:** count primary/`default`-variant actions per decision context. FAIL if >1 (or 0 where an action is expected).
- **Finding:** `layout · critical · "checkout step shows 3 equally-weighted primary buttons" · expected "one primary next step; others demoted or removed"`

### CL-2 — Choice sets offer a recommended default  *(high)*
- **Axis/Category:** `component-usage` / `layout`
- **Assertion:** when a decision presents ≥4 comparable options, one is pre-selected or marked Recommended (Hick's Law mitigation).
- **Detect:** option group with ≥4 items and no `defaultValue`/`Recommended`/`checked` marker. FAIL.
- **Finding:** `layout · high · "9 plans, none recommended/pre-selected" · expected "highlight a recommended default to short-circuit the decision"`

### CL-3 — No mandatory recall  *(high)*
- **Axis/Category:** `component-usage` / (`copy`)
- **Assertion:** users are never asked to remember information not visible on the current screen; offer recognition (picker/autocomplete) or show the value.
- **Detect:** required input whose label/placeholder references prior-screen data, or free-text where a known set exists. FAIL.
- **Finding:** `component-usage · high · "input asks for 'code from previous screen' — code not shown" · expected "display the value or use a picker (recognition over recall)"`

### CL-4 — Progressive disclosure for rare/advanced options  *(medium)*
- **Axis/Category:** `component-usage` / `layout`
- **Assertion:** advanced/rare controls are collapsed behind a clear, ≤2-level disclosure; frequent needs stay on the primary surface.
- **Detect:** count simultaneously-visible interactive controls; if a screen shows many rare/advanced controls inline with no disclosure, FAIL. Also FAIL if disclosure nesting depth > 2.
- **Finding:** `layout · medium · "all 22 form fields incl. advanced shown at once" · expected "collapse rare fields behind one 'Advanced' disclosure (max 2 levels)"`

### CL-5 — Long forms are chunked (Miller)  *(medium)*
- **Axis/Category:** `component-usage` / `layout`
- **Assertion:** forms beyond ~6–7 fields are grouped into labeled sections (`fieldset`/`legend` or headed groups).
- **Detect:** count fields; if > ~7 and no grouping structure, FAIL.
- **Finding:** `layout · medium · "12 ungrouped fields in a flat list" · expected "chunk into labeled sections (Contact / Shipping / Payment)"`

### CL-6 — No over-fragmentation (steps justified)  *(low)*
- **Axis/Category:** `layout`
- **Assertion:** a multi-step flow doesn't split a trivial task into many one-field screens.
- **Detect:** multi-step flow where steps carry ~1 field each and could combine. FAIL → flag for consolidation.
- **Finding:** `layout · low · "5-step wizard, each step one field" · expected "consolidate; minimize total steps-to-goal, not per-screen tidiness"`

### CL-7 — Plain language, no walls of text  *(medium)*
- **Axis/Category:** `copy` / `layout`
- **Assertion:** primary copy is scannable (short blocks, plain language), not dense jargon walls.
- **Detect:** long unbroken paragraph blocks in primary content; unexplained jargon in labels/CTAs. FAIL.
- **Finding:** `copy · medium · "value prop is one 90-word jargon paragraph" · expected "scannable plain-language copy; chunk and lead with the benefit"`

### CL-8 — Necessary capability not hidden (Tesler guard)  *(high)*
- **Axis/Category:** `component-usage` / `layout`
- **Assertion:** a known-necessary action is reachable, not removed/buried for the sake of minimalism.
- **Detect:** spec/brief lists a required action absent from the rendered UI or unreachable. FAIL (this is the anti-oversimplification check).
- **Finding:** `component-usage · high · "spec requires an Edit action; none present on the item" · expected "absorb complexity in the design, don't delete required capability"`

---

## 7. Sources (provenance / evidence only)

- Nielsen Norman Group — 10 Usability Heuristics (#6 Recognition over recall, #8 Aesthetic & minimalist): https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group — Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- Laws of UX — Hick's Law: https://lawsofux.com/hicks-law/
- Laws of UX — Miller's Law: https://lawsofux.com/millers-law/
- Laws of UX — Tesler's Law (Conservation of Complexity): https://lawsofux.com/teslers-law/
- Laws of UX — Cognitive Load: https://lawsofux.com/cognitive-load/
- CXL — The Paradox of Choice: Do More Options Really Tank Conversions? (choice-overload contrarian): https://cxl.com/blog/does-offering-more-choices-actually-tank-conversions/

*Sources cited for provenance only. This guide teaches the principle so the agent applies it directly in the build — it does not direct anyone to a third-party product.*
