---
description: Create a Contra portfolio post with carousel images — write copy, design slides, render PNGs
---

# /content:contra — Contra Portfolio Post Creator

Create a Contra portfolio post with carousel slide images. Handles copy writing, slide design, HTML rendering, and PNG output via Puppeteer.

## Input

`$ARGUMENTS` — Topic, angle, or title for the post. Can include:
- A project or system to showcase
- Specific features to highlight
- Audience context (recruiters, devs, founders)
- "update" to refresh stats in an existing post

## Voice & Anti-Slop Rules

### Writing voice (from user profile mining)

- Lead with a concrete image or situation, not an abstract claim
- Short sentences for emphasis; longer ones for nuance
- Technical terms used precisely, never dumbed down
- Metaphors do real work (illuminate structure, not decoration)
- Be honest about what's unresolved or uncertain
- Assume the reader is smart and busy — no filler
- No exclamation marks (one per 1,000 words max)
- No forced enthusiasm or cute language
- Problems are information, not failures

### Banned words

**Verbs:** delve, leverage, utilize, harness, streamline, underscore, illuminate, facilitate, bolster, foster, navigate, spearhead, elevate, empower, embark

**Adjectives:** pivotal, robust, innovative, seamless, cutting-edge, groundbreaking, comprehensive, multifaceted, meticulous, intricate, commendable, versatile, transformative, holistic, dynamic, nuanced

**Nouns:** landscape, tapestry, realm, synergy, beacon, testament, paradigm, underpinnings, ecosystem (metaphorical), journey (non-literal), game-changer

**Transitions:** furthermore, moreover, consequently, notably, importantly, additionally, "it's important to note", "it's worth mentioning"

### Banned patterns

- "In today's fast-paced world/landscape"
- "At its core..."
- "Here's the thing" / "Here's what stood out"
- "This is not just X, it's Y"
- "Let that sink in" / "Full stop." / "Period."
- Numbered listicles with bold headers (the most recognizable AI layout)
- Uniform paragraph length
- Compulsive rule of three ("adjective, adjective, and adjective")
- Every paragraph starting with a transition
- Mechanical bold emphasis on every key term
- Emoji bullet points
- "I'm excited to announce..."
- The humble-brag-to-lesson pipeline
- Ending with "Agree?" / "Thoughts?" / engagement bait
- Fake vulnerability with neat resolution

### What to do instead

- Write like you talk. Read it aloud.
- Use specific numbers, names, tools, dates.
- Let some sentences be ugly. Imperfection signals humanity.
- Have an actual opinion.
- Vary sentence length aggressively.
- Skip the conclusion/CTA. Just stop when you're done.
- Always assume a cold reader who has no context.

## Procedure

### Step 1: Research

Gather concrete facts for the post:

- If showcasing a system: read its actual source files, count real stats (commits, files, hooks, events, agents, etc.)
- If showcasing a project: read the PROJECT.md, recent git log, feature specs
- Read the user's existing content in `.claude/content/` for voice consistency
- Read `.claude/agents/president/_system/beta/judgement-model.md` for the user's principles (these reveal what they value)

### Step 2: Plan the deck

Based on input, plan slides. A good Contra portfolio post is 8-14 slides:

| Slide type | Purpose |
|------------|---------|
| **Cover** | Hook + visual identity. One line that stops scrolling. |
| **Problem** | What pain this solves. Concrete, not abstract. |
| **Architecture** | How the system/project is structured. |
| **Detail slides** | Deep dives on specific features (1 per slide). |
| **Numbers** | Hard stats. Social proof that it works. |

Don't add slides that repeat the same point in different words.

### Step 3: Write post copy

Draft the full text post for Contra. Follow all voice and anti-slop rules above.

**Structure:** Story first, specifics second, numbers third. No intro paragraph. Start in the middle of something happening.

**Length:** 800-2,500 words depending on topic complexity. Long enough for substance, short enough to finish.

Save to `.claude/content/contra-{slug}/post.md`

### Step 4: Design slides

Each slide is an HTML file using a shared CSS stylesheet for consistent dark terminal aesthetic.

**Shared CSS** (`slides/shared.css`):
- Background: `#060810` with radial gradient glows (blue, purple, green — subtle)
- Grid texture overlay (60px grid, masked to center, very faint)
- Font: JetBrains Mono for labels/code, Inter for body text
- Section labels: pink (`#d07ce8`), uppercase, letterspaced, with gradient underline
- Titles: `42px`, white (`#e8eaf4`), bold
- Cards: glass effect with `rgba(12, 16, 30, 0.85)` background, `rgba(30, 40, 80, 0.5)` border
- Color palette: cyan `#00d4f0`, pink `#d07ce8`, green `#00d787`, gold `#e8c44a`, red `#e05050`, blue `#0088b8`
- Stat numbers get `text-shadow` glow matching their color
- Slide number in top-right: `"NN / NN"` format, very dim
- Watermark bottom-right: `mc.dev` (or project domain)
- No corner accent brackets — they cause artifacts in Puppeteer

**Per-slide HTML:**
- Links `shared.css` via `<link rel="stylesheet">`
- Adds slide-specific styles in `<style>` block
- Canvas is `1200x900px` (4:3)
- All content inside `.canvas` div

**Critical CSS rules:**
- When using `nth-child()` selectors on elements interleaved with arrows/separators, use explicit classes instead (`.s1`, `.s2`, etc.) — nth-child counts ALL siblings including non-target elements
- Don't use `.sep` class from shared.css inside custom elements — it has gradient + box-shadow that causes artifacts
- Colors should be applied via explicit classes, not positional selectors

Save to `.claude/content/contra-{slug}/slides/`

### Step 5: Render images

Use Puppeteer to screenshot each HTML slide:

```javascript
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  // 4:3 at 2x for retina-crisp output (2400x1800)
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

  const slidesDir = path.join(__dirname, 'slides');
  const outDir = path.join(__dirname, 'images');
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(slidesDir)
    .filter(f => f.endsWith('.html'))
    .sort();

  for (const file of files) {
    await page.goto('file://' + path.join(slidesDir, file), { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({
      path: path.join(outDir, file.replace('.html', '.png')),
      fullPage: false,
    });
    console.log('Rendered:', file);
  }

  await browser.close();
})();
```

If Puppeteer isn't installed: `npm install puppeteer --no-save`

Save render script to `.claude/content/contra-{slug}/render-all.js`
Save rendered PNGs to `.claude/content/contra-{slug}/images/`

### Step 6: Verify

Read back 3-4 rendered PNGs to verify:
- Colors are correct (no missing nth-child colors)
- No visual artifacts (corner brackets, gradient bars)
- Slide numbers are sequential and correct
- Text is readable, not clipped

Fix any issues and re-render affected slides.

### Step 7: Output summary

Report:
```
Contra post ready: .claude/content/contra-{slug}/

  post.md              — copy text
  slides/shared.css    — shared stylesheet
  slides/*.html        — {N} slide sources
  images/*.png         — {N} rendered slides (2400x1800, 4:3)
  render-all.js        — re-render script

Slides: {N}
Word count: {N}
```

## Content directory convention

All Contra content lives under `.claude/content/contra-{slug}/`:
```
.claude/content/
  contra-alex-banner/     — "ALEX: The AI That Builds Software While I Sleep"
    post.md
    slides/
      shared.css
      01-cover.html
      ...
    images/
      01-cover.png
      ...
    render-all.js
  contra-{next-slug}/     — next post
    ...
```

## Reference

Existing post for style reference: `.claude/content/contra-alex-banner/`
