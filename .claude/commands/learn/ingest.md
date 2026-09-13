---
description: Ingest external knowledge from files, links, or YouTube videos and apply learnings to the system
---

# /learner — External Knowledge Ingestion

Takes a file, URL, or YouTube video and extracts actionable knowledge. Analyzes it for relevance to the current project and MC system. Proposes or auto-applies improvements to strategies, skills, hooks, linters, or specs.

## Usage

- `/learner path/to/file.md` — learn from a local file
- `/learner https://example.com/article` — learn from a web page
- `/learner https://youtube.com/watch?v=xxx` — learn from a YouTube video
- `/learner https://youtube.com/watch?v=xxx "focus on the part about testing"` — learn with focus hint

## Input Detection

Determine the input type and extract content accordingly:

### Local File
**Detection:** Input doesn't start with `http`
**Method:** Read the file directly with the Read tool
**Supported:** `.md`, `.txt`, `.pdf`, `.json`, `.js`, `.ts`, `.html`, any text file. **Office OOXML** (`.docx`, `.pptx`, `.xlsx`) is a ZIP of XML, not text — extract it first (below); never Read it raw.

**Office OOXML extraction (`.docx` / `.pptx` / `.xlsx`):** the text lives in XML parts inside the zip (`.docx` → `word/document.xml`; `.pptx` → `ppt/slides/slide*.xml`; `.xlsx` → `xl/sharedStrings.xml`). Extract to plain text: open the zip, read the XML part, replace `</w:p>` → newline, strip all `<…>` tags, decode XML entities (`&amp; &lt; &gt; &quot; &#39;`). Reference impl (cross-platform, no extra deps) — the PowerShell `System.IO.Compression.ZipFile` reader used to ingest the corpus of an external brand-building methodology (paid course, not redistributed) on 2026-05-31 (output in `_planning/ingest/source/`); a `node` script using any unzip lib, or `unzip -p <file> word/document.xml`, work too. **Caveat — text only:** content embedded as IMAGES/screenshots is NOT captured. If a file is large but extracts little text (e.g. a 200KB `.docx` → a few hundred chars), it's mostly screenshots → flag MEDIUM confidence and note the visual steps need a vision pass or the operator's notes.

### Web Page
**Detection:** Starts with `http` and is NOT a YouTube/youtu.be link
**Method:** Use WebFetch to retrieve the page content
**Fallback:** If WebFetch fails (paywall, JS-rendered), try:
1. WebSearch for the page title + "transcript" or "summary"
2. Ask user to paste the content manually

### Google Workspace links (Docs / Sheets / Slides) — JS-gated, use the EXPORT endpoint
**Detection:** host is `docs.google.com` / `drive.google.com` with `/document/`, `/spreadsheets/`, `/presentation/`, or `/file/d/`.
**Why:** the normal page is JS-rendered — a plain WebFetch returns an empty shell, NOT the document text. (This is the 2026-05-30 failure: a fetch + Scribd-mirror attempt hit the JS wall and the agent fell back to reconstructing structure from web-search snippets → MEDIUM confidence + a re-share request. Don't repeat that.) Google serves the real content from an EXPORT endpoint that needs no JS.
**Method:** extract the doc id (`/d/<ID>/`) and WebFetch the export URL directly:
- Docs → `https://docs.google.com/document/d/<ID>/export?format=txt` (use `format=docx` if you need structure/headings, then parse per Local File → Office OOXML)
- Sheets → `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv`
- Slides → `https://docs.google.com/presentation/d/<ID>/export?format=txt`
- Drive file → `https://drive.google.com/uc?export=download&id=<ID>`
**If the export returns a login/HTML page** (doc is private, not link-shared): ask the operator to **File → Download → `.docx` (or `.txt`)** and point `/learn:ingest` at the downloaded file — the skill now parses `.docx` (see Local File → Office OOXML). Capture which downloaded file maps to which in-file `[HERE]`/upload link. **Never silently degrade to snippet reconstruction** — flag it and use the export/download path.

### Web Page — Crawl Mode (`--crawl` or auto-detect)

Generic, topic-agnostic. If the page looks like an **index / hub / catalog / overview** for anything (documentation tree, course syllabus, model catalog, glossary, library index, spec directory, conference schedule, blog archive), the crawl unpacks it — fetches the links, fetches any referenced external tools, and aggregates.

**When to crawl:** auto-detect if any of these are true, or if the user passes `--crawl` explicitly:
- URL path looks index-like: ends in or contains `/docs`, `/models`, `/api`, `/reference`, `/guides`, `/tutorials`, `/articles`, `/posts`, `/catalog`, `/index`, or terminates in a trailing slash on a short path
- The fetched page content contains **>5 outbound links that share the same domain or the same URL prefix** as the input URL
- Page title contains words like "Overview", "Index", "Catalog", "All …", "Directory"
- Explicit `--crawl` flag regardless of heuristics

When in doubt, **ask the user once**: "This looks like a hub page — want me to crawl sub-pages (y/N)?"

---

**Crawl procedure (works for any topic):**

1. **Fetch the hub page** via WebFetch. Use this prompt verbatim — it's designed to extract links regardless of topic:
   ```
   List every link on this page. For each link, include:
     - anchor text (or title if different)
     - absolute URL (resolve relative links against the page URL)
     - whether it appears to be a sub-page under this page's topic (same host AND path prefix overlaps, OR same documentation tree)
     - whether it references an external tool, CLI, SDK, library, or dependency by name

   Also give:
     - topic: one sentence describing what this page is
     - dependencies: any tools/libraries/services the page says you need to use it (name + why)

   Return JSON:
   { topic: "...", links: [{text, url, is_subpage, is_dependency}], dependencies: [{name, reason}] }
   ```

   Do not skip links. The heuristics at this step are conservative on purpose — **extract everything, filter later.**

2. **Filter sub-pages** from the extracted links:
   - Same host as the hub URL, OR
   - Same URL path prefix (e.g. hub is `/docs/` → keep `/docs/*`)
   - Dedupe by URL
   - Cap at 20 fetches per crawl to avoid runaway runs (user can raise with `--max=50`)
   - If >20, sort by shortest path depth first (top-level sections before deep leaves) and take the top 20

3. **Fetch each sub-page in parallel**. Use WebFetch with this focused prompt:
   ```
   What does this page document or describe? (one paragraph)
   List every literal identifier on the page — names, IDs, flags, config keys, function signatures, model IDs, CLI options — with their exact strings.
   Include every code example verbatim.
   Note any caveats, deprecations, version constraints, or warnings.
   Return JSON: { summary, identifiers: [...], examples: [...], caveats: [...] }
   ```

4. **Follow dependencies** — for each entry in the hub's `dependencies`:
   - If the dependency has a canonical docs URL mentioned on the hub, use that
   - Otherwise `WebSearch` for `"<dependency name> official docs"` and use the top result
   - `WebFetch` that URL with the same prompt as step 3
   - If the page itself looks like a hub (apply the same heuristics), treat it as a nested crawl — recurse with `depth = depth + 1`, **cap recursion at depth 2** from the original hub
   - If the dependency is a CLI tool, **always** try to also fetch the CLI reference page (common URL patterns: `/reference`, `/cli`, `/commands`, `/cli/reference`)

5. **Aggregate** — produce a single merged knowledge object:
   ```json
   {
     "hub": { "url": "...", "topic": "...", "crawled_at": "<ISO>" },
     "subpages": [
       { "url": "...", "title": "...", "summary": "...", "identifiers": [...], "examples": [...], "caveats": [...] }
     ],
     "dependencies": [
       { "name": "...", "reason": "...", "docs_url": "...", "identifiers": [...], "cli_syntax": "...", "cli_reference_url": "..." }
     ],
     "failed_fetches": [ { "url": "...", "reason": "..." } ]
   }
   ```

6. **Recap banner** (always print before analysis — user can redirect):
   ```
   ┌─ CRAWL RECAP ─────────────────────────
   │ Hub:          <topic>
   │ URL:          <hub url>
   │ Sub-pages:    <N> fetched / <M> discovered
   │ Dependencies: <D> followed (+ <C> CLI references)
   │ Failed:       <F> pages skipped (see failed_fetches)
   │ Recursion:    depth <depth> / cap 2
   └────────────────────────────────────────
   ```
   Then proceed to the Analysis Pipeline treating **all fetched pages** (hub + subpages + dependencies) as the input corpus.

**Rate-limit / failure safety:** if any `WebFetch` fails, returns empty, or times out, log it to `failed_fetches` and continue. Never abort the whole crawl for one failed page.

---

**Fixture examples (this is the pattern, not a hardcoded flow):**

- **Technical docs hub** (what we tested): `https://platform.openai.com/docs/models` → crawl discovers `gpt-5.4`, `gpt-5.4-mini`, etc., each sub-page extracts model IDs + context sizes + strengths. Hub mentions "Codex CLI" as a dependency → follow to `https://developers.openai.com/codex/cli/reference` and extract exact flags.
- **Library overview**: `https://react.dev/reference/react` → crawl extracts every hook signature and example.
- **API index**: `https://docs.anthropic.com/en/api` → crawl extracts every endpoint with its payload schema and example.
- **Blog archive**: `https://kentcdodds.com/blog` → crawl each post, extract the thesis + each technique mentioned.
- **Glossary**: any `GLOSSARY.md` or `/terms` page → each defined term becomes an identifier; cross-references become dependencies.

The crawl logic doesn't care about the topic. It cares about: find links, classify them, fetch them, aggregate. **Any topic, any hub, any depth up to 2.**

### YouTube Video
**Detection:** URL contains `youtube.com/watch`, `youtu.be/`, or `youtube.com/shorts`
**Method (try in order):**

1. **yt-dlp transcript extraction** (best quality — preferred path). Ensure the
   tool is present and **auto-install it if missing** (yt-dlp is a free CLI; a
   "best-quality" method that isn't provisioned silently degrades the ingest):
   ```bash
   # check + auto-install if absent (python -m pip is more reliable than bare `pip`)
   python -m yt_dlp --version >/dev/null 2>&1 || python -m pip install --quiet --disable-pip-version-check yt-dlp
   # extract auto + manual subs as .vtt; pass MULTIPLE URLs to batch in one call:
   python -m yt_dlp --write-auto-sub --write-sub --sub-lang en --sub-format vtt \
     --skip-download --no-warnings -o "<outdir>/%(id)s.%(ext)s" "URL" ["URL2" ...]
   ```
   Then read each generated `<id>.en.vtt` and clean VTT formatting (below).
   **Long videos:** fan the transcripts out to parallel sub-agents to distill
   (return summaries) rather than reading multi-hundred-KB transcripts into the
   main context. Extract to a gitignored scratch dir (e.g. under `.mc/`).
   If yt-dlp truly can't be installed (no network / no pip), fall through to (2).

2. **WebFetch on transcript service:**
   Try fetching from a transcript extraction service or the YouTube page itself and parsing the captions.

3. **Manual fallback:**
   Tell the user: "I couldn't get the transcript automatically. Options:
   - Install yt-dlp: `python -m pip install yt-dlp`
   - Paste the transcript manually
   - Share the video title so I can WebSearch for a summary"

### VTT/SRT Transcript Cleanup

Raw VTT files have timestamps and duplicated lines. Clean them:
```
1. Remove WEBVTT header and metadata
2. Remove timestamp lines (00:00:00.000 --> 00:00:03.000)
3. Remove duplicate consecutive lines (VTT repeats lines across segments)
4. Remove HTML tags (<c>, </c>, etc.)
5. Join into flowing paragraphs (every ~5 sentences)
```

## Analysis Pipeline

After extracting content, analyze it through these lenses:

### Step 1: Relevance Scan
Ask: "What in this content is relevant to our project and the MC system?"

Categories to look for:
- **Prompting techniques** — better ways to communicate with AI
- **Agent patterns** — multi-agent coordination, evaluation, guard rails
- **Code quality** — testing, linting, error handling patterns
- **Architecture** — state management, data flow, API design
- **Process** — spec writing, review workflows, CI/CD
- **Security** — vulnerability patterns, auth best practices
- **UX/Design** — wizard patterns, progressive disclosure, error states
- **Meta/System** — self-improving systems, feedback loops, observability

### Step 2: Extract Insights
For each relevant section, extract:
```json
{
  "insight": "Plain English description of what was learned",
  "category": "prompting|agents|code|architecture|process|security|ux|meta",
  "confidence": "high|medium|low",
  "applicable_to": ["which parts of the system this applies to"],
  "source": "URL or file path",
  "source_context": "quote or summary from the original"
}
```

### Step 3: Map to System Components
For each insight, determine where it should be applied:

| Category | Target Files | Action Type |
|----------|-------------|-------------|
| prompting | smart-context.js, memory/learnings.jsonl | New enhancement strategy or learned tip |
| agents | .claude/agents/*.md, AGENT-SYSTEM.md | Agent behavior update, new agent proposal |
| code | scripts/lint-*.js, HYGIENE.md | New lint rule, hygiene pattern |
| architecture | _requirements/03-architecture/*.md, SPEC_GRAPH.json | Architecture doc update, new graph edge |
| process | .claude/commands/*.md, _docs/03-*/*.md | Skill update, process doc update |
| security | _docs/07-security/*.md, scripts/hooks/*-guard.js | Security policy, new guard hook |
| ux | _requirements/01-design-system/*.md, _requirements/04-features/*/COPY.md | Design pattern, copy improvement |
| meta | _requirements/00-canonical/*.md, CLAUDE.md, .claude/project/memory/ | System-level improvement |

### Step 4: Generate Proposals

For each applicable insight, generate a concrete proposal:

```
📚 Learning: [insight in plain English]
📖 Source: [URL/file, with relevant quote]
📍 Apply to: [target file]
🔧 Change: [specific change to make]
⭐ Confidence: [high/medium/low]
✅ Approve  ❌ Skip
```

### Step 5: Apply (based on mode)

**Read `_requirements/00-canonical/MODE.json`** to determine the current mode (`light` or `dark`).

**Light mode:** Present proposals, wait for approval
**Dark mode:** Auto-apply high-confidence proposals, queue medium/low for review

### Step 6: Route and Log

Each insight goes to one of two destinations based on what it is:

**Prompt tips** (category: `prompting`) → `.claude/project/memory/learnings.jsonl`
These are surfaced by the smart-context in future sessions. They don't need building.
```json
{
  "ts": "2026-04-01",
  "intent": "external_learning",
  "source": "https://youtube.com/watch?v=xxx",
  "category": "prompting",
  "tip": "When user asks about testing, inject reminder to check HYGIENE.md first",
  "effective": null,
  "pending_validation": true
}
```

**Build proposals** (category: `agents`, `code`, `architecture`, `process`, `security`, `ux`, `meta`) → `.claude/project/memory/learnings.jsonl`
These are actionable insights that will be surfaced in future sessions via the prompt enhancer.
```json
{
  "id": "PROP-xxx",
  "ts": "2026-04-01T10:00",
  "source": "learner",
  "learning": "Skills should have eval/ folders with binary assertion files",
  "category": "agents",
  "origin": "https://youtube.com/watch?v=xxx",
  "confidence": "high",
  "status": "pending",
  "action": "build"
}
```

**Always log to** `.claude/project/events/events.jsonl` regardless of destination:
```json
{
  "id": "EVT-xxx",
  "ts": "2026-04-01T10:00",
  "file": "external",
  "change": "Ingested knowledge from [source]",
  "direction": "inbound",
  "trigger": "learner",
  "source": "URL",
  "routed_to": "learnings",
  "propagated": false
}
```

## Proactive Invocation

This skill can be invoked proactively in these situations:

1. **When a bug recurs** — same bug class 3+ times, search for solutions:
   ```
   "Strict mode ref bugs keep recurring. Searching for solutions..."
   → WebSearch "React strict mode useRef useEffect cleanup pattern"
   → /learn:ingest [top result URL]
   → Proposes: add ESLint rule based on learned pattern
   ```

2. **When /eval:automation finds no automation for a rule** — search for how others solve it:
   ```
   "HYGIENE Rule 33 (event wiring) has no linter. Searching..."
   → WebSearch "detect unused custom events JavaScript linter"
   → /learn:ingest [relevant article]
   → Proposes: hook or linter based on technique found
   ```

3. **When user shares a resource in conversation** — auto-detect and offer to learn:
   ```
   User: "I saw this great talk: https://youtube.com/watch?v=xxx"
   → "Want me to learn from this video? I'll extract the transcript and find applicable insights."
   ```

## Examples

### Example 1: Blog Post About Testing Patterns
```
/learner https://kentcdodds.com/blog/testing-implementation-details

📚 Learning: "Test behavior, not implementation. Query by role/label, not class/id."
📖 Source: Kent C. Dodds blog — "The more your tests resemble the way your software is used..."
📍 Apply to: the retro directory (check manifest.json projectPaths.retro for location)/03/HYGIENE.md (new rule)
🔧 Change: Add Rule 40: "Tests should assert on user-visible behavior, not internal state"
⭐ Confidence: high
```

### Example 2: YouTube Video on Agent Architecture
```
/learner https://youtube.com/watch?v=dQw4w9WgXcQ "focus on evaluation"

[Extracting transcript via yt-dlp...]
[Cleaning VTT format...]
[Analyzing 4,523 words...]

📚 Learning: "Evaluators should test against golden fixtures, not just acceptance criteria"
📖 Source: YouTube — "Building Reliable AI Agents" at 14:32
📍 Apply to: .claude/agents/evaluator.md
🔧 Change: Add golden fixture comparison step to evaluator protocol
⭐ Confidence: medium
```

### Example 3: Local Research File
```
/learner _docs/09-agentic-system/research/03-wrong-kind-of-agent.md

📚 Learning: "Builder agents should be stateless — context via files, not conversation history"
📖 Source: Local research doc, section "The Stateless Builder Hypothesis"
📍 Apply to: .claude/agents/builder.md, AGENT-SYSTEM.md
🔧 Change: Add explicit instruction: "Do not rely on prior conversation. Read files fresh each cycle."
⭐ Confidence: high (internal research, already validated)
```

## Anti-Shortcutting

The learner must not:
- Accept insights at face value without checking relevance
- Apply generic advice that doesn't fit the project (e.g., "use TypeScript" when we already do)
- Log duplicate learnings (check existing memory/learnings.jsonl first)
- Auto-apply low-confidence insights in dark mode (always queue those)

Confidence scoring:
- **High:** Source is authoritative (official docs, established expert), insight directly maps to a known problem
- **Medium:** Source is credible, insight is applicable but needs adaptation
- **Low:** Source is general, insight might apply but needs validation

## Important

- Always cite the source with a specific quote or timestamp
- Never fabricate insights — only extract what's actually in the content
- Deduplicate against existing learnings before logging
- `/learn:self` validates learnings over time (mark `effective: true/false` based on evidence)
- Large content (>10k words) should be chunked and analyzed in sections
