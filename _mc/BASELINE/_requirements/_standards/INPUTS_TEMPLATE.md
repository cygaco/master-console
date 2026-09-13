# INPUTS.md — Template & Writing Guide

Every feature folder in `_requirements/04-features/{feature}/` should have an `INPUTS.md` that documents all user-facing input fields. This is the spec agents use to build UI and wire data.

## When to write one

- If the feature has any user-editable fields, selection controls, toggles, text inputs, or interactive elements — it needs an INPUTS.md.
- If the feature is purely display, system-level, or has no user interaction — it does NOT need one. Note this in the feature's PRD instead.

## File structure

```markdown
# {Feature Name} — Inputs

One-line description of what this feature collects from the user.

**Global notes:**
- Any notes that apply to all screens in this feature (auto-save behavior, navigation, etc.)

**Data contracts:** See [DATA-CONTRACTS.md](../04-architecture/DATA-CONTRACTS.md) for wiring rules.

---

## {Screen Name}

> **Depends on:** What must be true before this screen is reachable

### {Control or Section Name}

Description of the control.

| Option/Field | {Relevant columns} |
|---|---|
| ... | ... |

**Default:** What is pre-selected or pre-filled

### Conditional field (if any)

- **Trigger:** What causes it to appear
- **Control:** What type of input
- ...

### Downstream data contracts

| Field(s) | Consumed by |
|---|---|
| ... | ... |

### Exit gate

What must be true before the user can advance.
```

## Control types

Use these consistently across all INPUTS files:

| Control | When to use | Signal to user |
|---|---|---|
| **Cards** | Choices that deserve attention (full phrases, consequential) | "Stop and think" |
| **Pills** | Simple attributes/tags, quick toggles | "Tag and go" |
| **Dropdown** | Long option lists (6+) that don't need to be visible at once | "Pick one" |
| **Text input** | Short free-text (names, URLs, numbers) | "Type a value" |
| **Textarea** | Longer free-text (descriptions, directions) | "Explain something" |
| **Combobox** | Type-to-filter from a large list, with optional free-text fallback | "Search or type" |
| **Toggle/checkbox** | Binary on/off | "Yes or no" |
| **De-selectable chips** | AI-generated lists the user curates by removing items | "Remove what doesn't fit" |

### How to choose a control type

When the INPUTS file doesn't specify a control type explicitly, agents should use this decision framework:

**Step 1: How many options?**
- 2–3 options → pills or cards (go to step 2)
- 4–6 options → cards, pills, or dropdown (go to step 2)
- 7+ options → dropdown or combobox
- Unlimited/dynamic list → de-selectable chips (if AI-generated) or combobox (if user-searched)

**Step 2: How much cognitive weight?**
- Options are full sentences or need reading → **cards** (slows the user down intentionally)
- Options are single words or short labels → **pills** (keeps the user moving)
- Options are consequential (exclusions, identity-level choices, things that affect many downstream features) → **cards**
- Options are simple attributes (filters, tags, parameters) → **pills**

**Step 3: Selection model?**
- Pick exactly one → single-select (cards, pills, or dropdown)
- Pick one or more → multiselect (cards or pills — never multiselect dropdown)
- Toggle on/off independently → cards (if the labels are phrases) or pills (if short)
- AI-generated, user curates by removing → de-selectable chips

**Step 4: Special cases**
- Options have a warning/exclusion meaning → use a distinct visual treatment (e.g., reddish cards for dealbreakers)
- Options come from a large known dataset (cities, majors, schools) → combobox with type-to-filter
- Options are AI-assessed and user corrects → dropdown with pre-selected AI value (e.g., seniority, degree)

**When the INPUTS file specifies a control type, that overrides this framework.** The framework is a fallback for unspecified controls.

## Required columns by context

**For selection controls (cards, pills, dropdowns):**

| Column | Required | Notes |
|---|---|---|
| Option | Yes | The label the user sees |
| Mutually exclusive with | Yes | N/A if none. Keeps the question visible even when the answer is "no exclusions" |
| Default | Yes | What is pre-selected. "None" if nothing |

**For form fields (text inputs, textareas):**

| Column | Required | Notes |
|---|---|---|
| Field | Yes | The label |
| Control | Yes | Input type |
| Required | Yes | Yes/No, or "Required if {condition}" for hierarchical requirements |

**For de-selectable chips:**

| Column | Required | Notes |
|---|---|---|
| Field | Yes | What the chip group represents |
| Chip style | Yes | Primary or secondary/muted |
| Notes | Yes | Source of the data, de-select behavior |

## Downstream data contracts

Every screen with editable fields must have a "Downstream data contracts" table. Format:

| Field(s) | Consumed by |
|---|---|
| The session field name or description | Feature + specific usage (e.g., "Meal plans — ingredients section") |

Rules for these contracts live in `_requirements/03-architecture/DATA-CONTRACTS.md`.

## Exit gates

Every screen must document its exit gate — what conditions must be met before the user can advance. Format as a sentence, not a bullet list. Examples:

- "At least one option selected. If conditional field is visible, it must meet min length."
- "All required fields filled. Validates URL format if provided."
- "None — user can proceed with all defaults."

## Conditional fields

When a user's selection triggers additional inputs:

- **Trigger:** Which option(s) cause the field to appear
- **Deselect behavior:** What happens when the trigger is deselected (usually: hide but retain value in state)
- **Required:** Whether the conditional field blocks advancement while visible

## Hierarchical requirements

When a section is optional but its children have requirements:

> "The {section} itself is optional — zero entries is valid. But if an entry exists, fields marked 'Required if entry exists' must be filled before saving that entry."

## Loading states

If a screen has async dependencies (API calls, AI generation, parsing), document the loading states:

- **What the user sees** while waiting
- **Error states** and what actions are available (retry, go back, etc.)
- **Success transition** — how the screen changes when data arrives

## Features with no user inputs

If a feature is purely computational, display-only, or system-level, it does not need an INPUTS.md. Examples:
- **Competitiveness scoring** — computed from other data, no user input
- **Shell** — navigation and layout, no editable fields

Note this in the feature's PRD: "This feature has no user-facing input fields. See related features for upstream inputs."

## Platform language

INPUTS files describe **what** the user does, not **how** they do it on a specific platform. Use platform-neutral language by default:

- Say "select" not "click" or "tap"
- Say "enter" not "type"
- Say "advance" not "click Next"
- Say "dismiss" not "swipe away" or "press Escape"

**When to be platform-specific:** Only when the behavior genuinely differs by platform and that difference matters to the builder. Examples:
- Desktop vs mobile interaction patterns (combobox vs full-screen sheet)
- Keyboard shortcuts (only exist on desktop)
- Touch targets and minimum sizes (only matter on mobile)
- Extension-specific Chrome APIs

If you find yourself writing "click" or "tap", ask: does the platform matter here? Usually it doesn't.

## Naming conventions

- File: always `INPUTS.md` in the feature folder
- Screen names: use descriptive names (e.g., "Query Editor", "Category Lock"), not step numbers
- Field names: match the user-facing label, not the code variable name
