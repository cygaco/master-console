---
description: Create a LinkedIn post with carousel images — write copy, design slides, render PNGs
---

# /content:linkedin — LinkedIn Post Creator

Create a LinkedIn post with optional carousel images. Handles copy, slide design, image rendering, and output files.

## Input

`$ARGUMENTS` — Topic, angle, or title for the post. Can include:
- A title or hook idea
- A topic to write about
- "carousel" to include image slides
- Specific instructions (tone, audience, length)

## Procedure

### Step 1: Determine shape

Based on the input, classify:

| Type | When | Output |
|------|------|--------|
| **Text-only** | Simple thought, take, or update | `post.md` with copy text |
| **Carousel** | Visual content, multi-point story, dream paintings, technical showcase | `post.md` + HTML slides + rendered PNGs |

If unclear, default to carousel — visual content gets 2-3x engagement on LinkedIn.

### Step 2: Write post copy

Draft the LinkedIn post text following these rules:

**Hook (first 3 lines):** These appear before "...see more". Must stop the scroll.
- Lead with the most provocative or surprising claim
- No filler, no throat-clearing ("I've been thinking about...")
- Specific > generic. Numbers > adjectives.

**Body:**
- Tell a story, don't lecture. Show what happened, not what you think.
- Include concrete details (numbers, before/after, specific tools)
- If referencing internal work, add context for cold readers
- Short paragraphs. One idea per block. Use whitespace.
- Use → or — for lists, not bullet points (LinkedIn renders them poorly)

**Close:**
- End with a question that invites genuine response, not "like if you agree"
- Or end with a bold statement that stands on its own

**Hashtags:** 5-8, mix of broad (#AI, #SoftwareEngineering) and specific (#ClaudeCode, #BuildInPublic)

**Length:** 1,500-2,500 characters (under 3,000 limit, long enough for substance)

Save to `.claude/content/linkedin-{slug}/post.md`

### Step 3: Design carousel slides (if carousel)

For each slide, create an HTML file with:
- Dark terminal aesthetic (background: #0d1117, monospace font)
- Color-coded syntax highlighting (green headers, orange labels, blue highlights)
- Tight padding (40-50px), no wasted space
- Content centered, readable at mobile size

**Slide types:**
- **Title slide** — hook text, terminal prompt aesthetic
- **Code/art slide** — ASCII art, code snippets, terminal output
- **Text slide** — key insight with labeled sections (WHAT EMERGED, HIDDEN TENSION, etc.)
- **Quote slide** — single powerful line, large text, centered

**Slide count:** 3-10 slides. LinkedIn carousel sweet spot is 5-8.

Save to `.claude/content/linkedin-{slug}/slide-N-{name}.html`

### Step 4: Render images

Use Puppeteer to screenshot each HTML slide:

```javascript
const puppeteer = require('puppeteer');
// Viewport: 700x700 at 2x = 1400x1400px output (crisp on retina)
await page.setViewport({ width: 700, height: 700, deviceScaleFactor: 2 });
await page.goto('file://' + slidePath);
await page.screenshot({ path: outPath, fullPage: false });
```

If Puppeteer isn't installed: `npm install puppeteer --no-save`

Save rendered PNGs to `.claude/content/linkedin-{slug}/images/`

### Step 5: Output summary

Report:
```
LinkedIn post ready: .claude/content/linkedin-{slug}/

  post.md          — copy text (paste into LinkedIn)
  images/          — {N} carousel slides (upload to LinkedIn)
    slide-1-*.png
    slide-2-*.png
    ...

Character count: {N}/3000
Slides: {N}
```

## Content directory convention

All LinkedIn content lives under `.claude/content/linkedin-{slug}/`:
```
.claude/content/
  linkedin-{example-slug}/  — an example post
    post.md
    images/
    slide-*.html
    generate-images.js
  linkedin-{next-slug}/     — next post
    ...
```
