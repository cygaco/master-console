# FRICTION_TRUST_FORMS — Claude Deep Research Report (3-round WebSearch+WebFetch)

**Engine:** Claude (Opus) iterative search — 3 rounds. Date: 2026-06-01.

## Executive Summary
A form converts intent into a completed action; friction (extra fields, ambiguity, harsh validation, wrong mobile inputs, missing trust) is measurable abandonment. The core moves: minimize/justify fields (Baymard: avg checkout asks ~2× the needed fields), single-column top-aligned visible labels (never placeholder-as-label — NN/g/Baymard show it raises errors & time; top-aligned ~2× faster than left-aligned), forgiving validation (on-blur not keystroke; clear plain-language errors stating the fix), accessible error wiring (aria-invalid + aria-describedby + role=alert), correct mobile inputs (type/inputmode/autocomplete), trust at the point of commitment, and respecting the ad→lander→offer scent.

## Phase 1: Landscape
- **Field count is the strongest lever**; the real driver of abandonment is *unnecessary* fields + confusing layout, not raw count. Baymard: avg checkout ~11.3 fields vs ~8 needed; 18% abandon due to complex/confusing layout. [HIGH] — Baymard
- **Placeholder-as-label is harmful:** vanishes on type; users delete input to re-read the label; raises errors & completion time across demographics; a11y/contrast problems. [HIGH] — NN/g form-design-placeholders; Baymard inline-labels
- **Top-aligned labels:** ~2× faster completion than left-aligned (Wroblewski eye-tracking, widely replicated); reflow cleanly on mobile. [HIGH] — Baymard label-position

## Phase 2: Mechanics
- **Validation timing:** on-blur (after meaningful interaction), NOT on every keystroke for errors (feels like "yelling," SR noise); exceptions where live feedback helps = password strength + username availability; clear the error live as the user fixes it; on submit, focus first invalid field. [HIGH] — Baymard inline-validation; a11yblog
- **Error messages:** specific + actionable + adjacent + polite; "Enter an email with @ and a domain" not "Invalid input." [HIGH]
- **Accessible errors:** aria-invalid="true" after failure (not on pristine required); aria-describedby → message; role="alert"/aria-live for dynamic; post-submit error summary on long forms. [HIGH] — w3.org ARIA21 / WAI forms tutorial; MDN aria-invalid
- **Required/optional:** mark explicitly with text/symbol + required/aria-required; not color-only. [HIGH]
- **Mobile inputs:** correct type (email/tel/url/number) + inputmode + autocomplete tokens (name/email/tel/street-address/postal-code/cc-number/one-time-code) for right keyboard + autofill. [HIGH] — MDN autocomplete; Smashing mobile forms
- **Trust at commitment:** reassurance near sensitive fields/submit; specific submit label ("Create my account"); submit feedback (loading/disabled → no double-submit) + clear success/error. [HIGH] — CXL

## Phase 3: Failure Modes
Placeholder-as-label; no required/optional marking; validate-on-keystroke; vague errors; error not tied to field (no aria-describedby/aria-invalid/role=alert); too many/unjustified fields; wrong input type / no autocomplete on mobile; form wiped on error; no submit feedback/double-submit; sensitive ask with no trust context; cold ad→offer jump (scent break); multi-column/scattered layout. [HIGH/MEDIUM]

## Phase 4: Contrarian / nuance
- **"Fewer fields always wins" is not absolute** — abandonment is driven by *unnecessary* fields + confusing layout, not raw count; a clear form asking what's needed beats a "minimal" one that hides required steps. [HIGH] — Baymard
- **Multi-step vs single-page depends on length:** multi-step tends to beat single-page once total fields ≥5 (HubSpot data cited: multi-step ~86% higher in some sets); for <5 fields single-step wins (extra clicks = pure friction). Progress indicators can cut abandonment 20–30% on long flows but also make time-investment salient. [MEDIUM] — ivyforms/zuko/Baymard
- **Good friction exists:** intentional confirmation friction is correct for destructive/irreversible actions (delete, pay) — removing it would be the defect. Friction-reduction applies to acquisition flows. [HIGH]
- **Floating labels** are a contested middle ground; plain top-aligned is the safer default. [MEDIUM]

## Source Registry
- baymard.com (inline-labels, label-position, inline-validation, one-page-checkout) — primary usability research, 5/5
- nngroup.com form-design-placeholders — primary UX research, 5/5
- w3.org/WAI/tutorials/forms + ARIA21 — primary spec/technique, 5/5
- developer.mozilla.org autocomplete — primary docs, 5/5
- cxl.com form-design-best-practices — practitioner, 4/5
- smashingmagazine.com mobile form design — practitioner, 4/5
