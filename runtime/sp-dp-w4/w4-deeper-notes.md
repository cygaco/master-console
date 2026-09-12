# E-DISPATCH-PERFECT-001 W4 (deeper increment) — residual origin-product vocab sweep

**Date:** 2026-06-17
**Scope (allowed files only):**
- `.claude/agents/_system/agent-system.md`
- `.claude/agents/engineering/security/reviewer.md`
- `runtime/sp-dp-w4/w4-deeper-notes.md` (this file)

No forbidden file was touched.

---

## DOMAIN_VOCAB advisory: before → after

| | count |
|---|---|
| `--full` advisory before | **40** |
| `--full` advisory after | **37** |
| reachable in my 2 allowed files (before) | 3 |
| reachable in my 2 allowed files (after) | **0** |

The advisory detector (`DOMAIN_VOCAB_TOKENS` in framework-purity.js) matches exactly
4 word-boundary tokens: `debitRockets`, `untrusted_job_data`, `masterResume`,
`targetedResumes`. Of the 40 full-tree hits, only **3** were inside my allowed-file
scope:
- `agent-system.md` — `masterResume` (line 966, §12 context-scoping table)
- `reviewer.md` — `untrusted_job_data` (line 158) + `debitRockets` (line 159)

All 3 cleared → 40 → 37. The remaining 37 live in forbidden / out-of-scope files
(ROADMAP.md, `_requirements/03-architecture/*`, etc.) that this increment may not touch.

## Gate status

- Commit gate (`--diff` / `--staged`, staged+unstaged of my changed files): **exit 0 / OK**,
  `client_slug: 0`, `domain_vocab: 0`.
- `--full` still exits 1 — this is PRE-EXISTING and unrelated: 74 `client_slug`
  violations across the whole tree (ROOT_LEAK_PENDING_SCRUB era). Not in scope; not
  introduced or removed by this increment.

---

## Representative swaps

### agent-system.md (§10/§11/§12/§13/§14 — pedagogy preserved, domain noun swapped)
- `masterResume` / `resumeStructured` → `primaryDocument` / `primaryDocumentStructured`
  (§12 context-scoping table, line 966) — clears the advisory hit.
- §12 worker table: `Resume Writer` → `Tailored-Document Writer`; `LinkedIn Writer` →
  `Profile Export Writer`; `Apply Assembler` → `Handoff Assembler`; "Raw resume text" →
  "Raw primary-document text"; "Resumes, raw job data" → "Tailored documents, raw ingested data".
- §11 step-expectation table: `8 (Resumes)` → `8 (Tailored docs)`; tolerance example
  "(resumes, LinkedIn)" → "(tailored documents, profile exports)".
- §13 step graph: `Step 8 (Resumes)` / `Step 9 (LinkedIn)` / `Step 10 (Apply)` →
  `Tailored docs` / `Profile export` / `Handoff`.
- §14 producer/consumer examples: `auth → rockets` → `auth → billing`;
  `resume-generation → linkedin` → `document-generation → profile-export`
  (Contract `SessionData.resumes (ResumeSet)` → `SessionData.documents (DocumentSet)`);
  `market-research → resume-generation` → `market-research → document-generation`.
- §14 foundation utilities: `src/lib/rockets.ts — balance operations` →
  `src/lib/billing.ts`; `fetchJobs()` → `fetchExternalData()`.
- §10 Fix Brief example: `Step1Resume.tsx` → `Step1Ingest.tsx` (file-scope list + 2 refs).

In every case only the domain noun changed; the lesson (context scoping prevents
hallucination, producer defines the shape, unified fix brief, golden tolerances) is intact.

### reviewer.md (threat model parameterized; W1 3-pass note block untouched)
- `<untrusted_job_data>` → `<untrusted_external_input>` (line 158, advisory hit).
- `debitRockets()` "Rocket billing" → "Metered billing — ... product's charge helper
  (e.g. `chargeCredits()`)" with an added clause: the concrete tag/helper names come from
  the product's canon (line 157 header note).
- Persona 9 procedure step 1: hardcoded "(job search, application, AI-assisted
  resume/cover letter generation)" → "(the product's primary user workflows — the concrete
  flows come from the product's canon, e.g. ingest of a primary document, AI-assisted
  generation of secondary documents)".
- Indirect-injection example: "(job listings, resumes, scraped content)" →
  "(third-party listings, user-uploaded documents, scraped content)".
- Enumeration: "other users, jobs, or internal resources" → "other users, the product's
  primary entities, or internal resources".
- AI-feature abuse: "via job-matching prompts" → "via the product's task-specific prompts".
- Payment bypass: "proper subscription check" → "a proper check against the product's
  billing/subscription model".
- Exempt-routes example list: trailing `jobs` → `<product's public read-only routes>`.
- **Left untouched (per instruction):** the "Note on the 3-pass review
  (E-DISPATCH-PERFECT-001 W1)" paragraph at line 21 — it is correct.

---

## Terms LEFT in place (conservative — legitimate non-domain meaning)

- agent-system.md "resume" as **continue-work** at lines 44, 579, 1133, 1306
  ("resume by reading store.json", "then resume", "[Resume] [Start over]", "resume all
  pending steps") — verb sense, not the document. Not a domain noun.
- "Chrome extension" / "extension" (agent-system.md §13 handoff; reviewer.md persona 11) —
  generic browser-extension term, not in the genericization target list; carries the
  out-of-process-handoff lesson. Left as-is.
- reviewer.md generic security terms (IDOR, payment bypass, rate abuse, CSRF, Stripe) —
  these are framework-neutral security concepts, not origin-product domain vocab.
- Persona / step counts, `marketAnalysis` field name, `miningResults`/`miningQuestions`
  — these are kept because (a) `marketAnalysis` is already a generic analytics noun, and
  (b) the broad step-pipeline rewrite is out of scope for "swap only the domain noun"; the
  advisory does not flag them. Flagged here for any future deeper increment.

## Out-of-scope residual (for a future increment)
The other 37 `--full` advisory hits (`masterResume`/`targetedResumes`/`debitRockets`/
`untrusted_job_data` across ROADMAP.md + `_requirements/03-architecture/*`) are in files
this increment's scopeContract does not allow. They remain for a later W4 pass.
