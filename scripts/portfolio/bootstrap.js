#!/usr/bin/env node

/**
 * scripts/portfolio/bootstrap.js
 *
 * Orchestrator for the /portfolio:bootstrap skill.
 *
 * Inputs (CLI):
 *   --slug <name>                 Project slug (default: derived from cwd)
 *   --section-set minimal|extended (default: minimal)
 *   --docx-backend auto|pandoc|none (default: auto)
 *   --output-dir <path>           Override default _docs/briefs/<slug>/
 *   --rerun-policy overwrite|version|prompt (default: version)
 *   --answers-file <path>         JSON map of {section_id: drafted_content} for
 *                                 non-interactive runs. Required because the
 *                                 AskUserQuestion turns are driven by the Claude
 *                                 skill driver, not by this script.
 *   --title <string>              Optional title (default: derived from slug)
 *   --tagline <string>            Optional tagline
 *   --help                        Print help and exit 0.
 *   --probe                       Run env probe only (pandoc detection, slug
 *                                 validation, rerun-detect). Emits JSON. No writes.
 *
 * Outputs:
 *   _docs/briefs/<slug>/<slug>.brief.md
 *   _docs/briefs/<slug>/<slug>.brief.html
 *   _docs/briefs/<slug>/<slug>.brief.docx (when pandoc on PATH)
 *
 * Side effects:
 *   On first successful write: adds paths.briefs and paths.briefsCurrent to
 *   .claude/paths.json. Subsequent runs update paths.briefsCurrent only.
 *   Emits brief_started, section_completed, brief_emitted events to
 *   paths.eventsFile (fail-open).
 *
 * Exit codes (matches AC-S-5.x, AC-S-6.x):
 *   0  success (may include DOCX skip)
 *   2  invalid input (slug, section set, output dir, etc.)
 *   3  coverage QC failed
 *   4  output directory not writable
 *   5  --docx-backend pandoc requested but pandoc missing
 *
 * Sprint: SP-20260513-001 · Plan Contract: PC-20260513-0002
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");

// ── Resolve project root ─────────────────────────────────────────
// The skill is run from arbitrary cwds. Use CLAUDE_PROJECT_DIR when present,
// fall back to walking up from __dirname until we find package.json or .claude/.
const PROJECT = resolveProjectRoot();

function resolveProjectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  }
  // Walk up from __dirname looking for .claude/paths.json
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".claude", "paths.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ── Constants ────────────────────────────────────────────────────
const TEMPLATE_DIR = path.join(
  PROJECT,
  "_mc",
  "templates",
  "product-bootstrap",
);
const PATHS_JSON = path.join(PROJECT, ".claude", "paths.json");
const EVENTS_FILE = path.join(
  PROJECT,
  ".claude",
  "project",
  "events",
  "events.jsonl",
);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ANSWER_LEN = 4000;
const PANDOC_PROBE_TIMEOUT_MS = 2000;

// ── CLI parsing ──────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    slug: null,
    sectionSet: "minimal",
    docxBackend: "auto",
    outputDir: null,
    rerunPolicy: "version",
    answersFile: null,
    title: null,
    tagline: null,
    help: false,
    probe: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--slug":
        args.slug = next();
        break;
      case "--section-set":
        args.sectionSet = next();
        break;
      case "--docx-backend":
        args.docxBackend = next();
        break;
      case "--output-dir":
        args.outputDir = next();
        break;
      case "--rerun-policy":
        args.rerunPolicy = next();
        break;
      case "--answers-file":
        args.answersFile = next();
        break;
      case "--title":
        args.title = next();
        break;
      case "--tagline":
        args.tagline = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--probe":
        args.probe = true;
        break;
      default:
        if (a.startsWith("--")) {
          die(2, `unknown flag: ${a}`);
        }
        // Positional args are not used by this CLI; ignore quietly so the
        // skill driver can pass arbitrary $ARGUMENTS without breaking.
        break;
    }
  }
  return args;
}

function die(code, msg) {
  process.stderr.write(`product:bootstrap: ${msg}\n`);
  process.exit(code);
}

// ── Slug derivation + validation (IN-1, R-7) ─────────────────────
function deriveSlugFromCwd(cwd) {
  const base = path.basename(path.resolve(cwd || PROJECT));
  // Normalize: lowercase, replace non-[a-z0-9-] with `-`, collapse runs,
  // trim leading/trailing `-`, truncate to 64.
  let s = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s;
}

function normalizeSlug(input) {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function validateSlug(slug, raw) {
  if (!slug || !SLUG_RE.test(slug)) {
    const suggestion = normalizeSlug(raw || slug) || "<empty>";
    const msg = [
      `Slug \`${raw ?? slug}\` is not valid.`,
      "Slugs must start with a lowercase letter or digit, contain only",
      "lowercase letters, digits, and hyphens, and be 1-64 characters.",
      `Examples: agentic-web, tax-cpa-agent, mc-core.`,
      `Suggested: \`${suggestion}\``,
    ].join("\n");
    process.stderr.write(msg + "\n");
    process.exit(2);
  }
}

// ── pandoc probe (IN-7, R-6) ─────────────────────────────────────
function probePandoc() {
  // Cross-platform: try `where pandoc` on Windows, `which pandoc` elsewhere,
  // then fall back to `pandoc --version`. Timeout protects us if the shim
  // hangs on a corrupted PATH entry.
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";

  try {
    const r = spawnSync(finder, ["pandoc"], {
      timeout: PANDOC_PROBE_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return { present: true, path: r.stdout.trim().split(/\r?\n/)[0] };
    }
  } catch (e) {
    // Fall through to direct probe
  }

  try {
    const r = spawnSync("pandoc", ["--version"], {
      timeout: PANDOC_PROBE_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    if (r.status === 0) return { present: true, path: "pandoc" };
  } catch (e) {
    // Treat as absent
  }
  return { present: false, path: null };
}

// ── Output dir resolution (IN-4, R-7, RT-1) ──────────────────────
function resolveOutputDir(args, slug) {
  let dir;
  if (args.outputDir) {
    dir = path.resolve(PROJECT, args.outputDir);
  } else {
    dir = path.join(PROJECT, "_docs", "briefs", slug);
  }
  // Containment check: must stay inside project root.
  const projectAbs = path.resolve(PROJECT);
  const dirAbs = path.resolve(dir);
  const rel = path.relative(projectAbs, dirAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    die(2, "--output-dir must stay inside the project root.");
  }
  return dir;
}

// ── Section loading ──────────────────────────────────────────────
function loadSections(sectionSet) {
  const file = path.join(TEMPLATE_DIR, "sections.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (sectionSet === "minimal") return data.minimal.slice();
  if (sectionSet === "extended") {
    return data.minimal.concat(data.extended_additions);
  }
  die(2, `Unknown section set '${sectionSet}'. Use minimal or extended.`);
}

// ── Answers ingestion (IN-6) ─────────────────────────────────────
function loadAnswers(answersFile) {
  if (!answersFile) return {};
  let abs = path.resolve(PROJECT, answersFile);
  if (!fs.existsSync(abs)) abs = path.resolve(answersFile);
  if (!fs.existsSync(abs)) {
    die(2, `--answers-file not found: ${answersFile}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    die(2, `--answers-file is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    die(2, "--answers-file must be a JSON object keyed by section id");
  }
  const cleaned = {};
  for (const [k, v] of Object.entries(raw)) {
    cleaned[k] = sanitizeAnswer(v);
  }
  return cleaned;
}

function sanitizeAnswer(v) {
  if (v == null) return { content: "", status: "skipped_declined" };
  if (typeof v === "object" && !Array.isArray(v) && "content" in v) {
    return {
      content: sanitizeText(v.content),
      status: v.status || (v.content ? "drafted" : "skipped_declined"),
      source_turns: Array.isArray(v.source_turns) ? v.source_turns : [],
    };
  }
  const s = sanitizeText(typeof v === "string" ? v : JSON.stringify(v));
  return {
    content: s,
    status: s ? "drafted" : "skipped_declined",
    source_turns: [],
  };
}

function sanitizeText(s) {
  if (s == null) return "";
  let str = String(s);
  // Strip ANSI escapes
  str = str.replace(/\[[0-9;?]*[A-Za-z]/g, "");
  // Strip BOM
  str = str.replace(/^﻿/, "");
  // Cap length
  if (str.length > MAX_ANSWER_LEN) {
    str = str.slice(0, MAX_ANSWER_LEN);
  }
  return str.trim();
}

// ── Coverage QC (R-3) ────────────────────────────────────────────
function runCoverageQc(sections, answers) {
  const missing = [];
  for (const sec of sections) {
    const ans = answers[sec.id];
    if (!ans) {
      missing.push(sec.title);
      continue;
    }
    if (
      ans.status === "skipped_declined" ||
      ans.status === "skipped_disabled"
    ) {
      continue;
    }
    if (!ans.content || !ans.content.trim()) {
      missing.push(sec.title);
    }
  }
  return { ok: missing.length === 0, missing };
}

// ── Template engine (tiny mustache-like) ─────────────────────────
function renderTemplate(tmpl, vars) {
  return tmpl.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

// ── MD writer (R-4) ──────────────────────────────────────────────
function writeMd({
  outDir,
  slug,
  sections,
  answers,
  title,
  tagline,
  sectionSet,
  generatedAt,
  draft,
}) {
  const tmpl = fs.readFileSync(
    path.join(TEMPLATE_DIR, "brief.md.tmpl"),
    "utf8",
  );
  const sectionBlocks = sections.map((sec, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const heading = `## ${num} — ${sec.title}`;
    const ans = answers[sec.id];
    let body;
    if (!ans || ans.status === "skipped_declined") {
      body = "_Skipped — operator declined to answer this section._";
    } else if (ans.status === "skipped_disabled") {
      body = "_Skipped — section disabled for this run._";
    } else {
      body = ans.content.trim();
    }
    return `${heading}\n\n${body}\n`;
  });
  const out = renderTemplate(tmpl, {
    title,
    slug,
    tagline,
    section_set: sectionSet,
    generated_at: generatedAt,
    draft: String(draft || 1),
    sections: sectionBlocks.join("\n"),
  });
  // Normalize to LF + trailing newline (AC-S-3.1)
  const normalized = out.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  const file = path.join(outDir, `${slug}.brief.md`);
  fs.writeFileSync(file, normalized, { encoding: "utf8" });
  return file;
}

// ── HTML writer (R-5) ────────────────────────────────────────────
function htmlEscape(s) {
  // RT-4: HTML-escape user-provided text
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Apply inline markdown to already HTML-escaped text.
// Order matters: inline-code first (so its contents aren't reinterpreted),
// then bold (**), then italic (*).
function renderInlineMd(escapedText) {
  return escapedText
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
}

const BULLET_RE = /^\s*[-*•]\s+/;
const NUMBERED_RE = /^\s*\d+[.)]\s+/;

function renderBulletList(lines) {
  return (
    "<ul>" +
    lines
      .map(
        (l) =>
          "<li>" +
          renderInlineMd(htmlEscape(l.replace(BULLET_RE, ""))) +
          "</li>",
      )
      .join("") +
    "</ul>"
  );
}

function renderNumberedList(lines) {
  return (
    "<ol>" +
    lines
      .map(
        (l) =>
          "<li>" +
          renderInlineMd(htmlEscape(l.replace(NUMBERED_RE, ""))) +
          "</li>",
      )
      .join("") +
    "</ol>"
  );
}

function paragraphsToHtml(text) {
  // Split on blank lines into blocks; each block may be a paragraph,
  // a list, or an intro paragraph followed inline by a list.
  const blocks = String(text).split(/\n{2,}/);
  return blocks
    .map((b) => {
      const trimmed = b.trim();
      if (!trimmed) return "";
      const lines = trimmed.split(/\n/);

      const allBullets = lines.every((l) => BULLET_RE.test(l));
      if (allBullets && lines.length >= 1) {
        return renderBulletList(lines);
      }

      const allNum = lines.every((l) => NUMBERED_RE.test(l));
      if (allNum && lines.length >= 1) {
        return renderNumberedList(lines);
      }

      // Intro + bullets: leading non-bullet lines followed by all-bullets tail.
      const firstBulletIdx = lines.findIndex((l) => BULLET_RE.test(l));
      if (firstBulletIdx > 0) {
        const tailAllBullets = lines
          .slice(firstBulletIdx)
          .every((l) => BULLET_RE.test(l));
        if (tailAllBullets) {
          const intro = lines.slice(0, firstBulletIdx).join(" ");
          const bullets = lines.slice(firstBulletIdx);
          return (
            "<p>" +
            renderInlineMd(htmlEscape(intro)) +
            "</p>\n  " +
            renderBulletList(bullets)
          );
        }
      }

      // Intro + numbered list: same pattern, numbered tail.
      const firstNumIdx = lines.findIndex((l) => NUMBERED_RE.test(l));
      if (firstNumIdx > 0) {
        const tailAllNum = lines
          .slice(firstNumIdx)
          .every((l) => NUMBERED_RE.test(l));
        if (tailAllNum) {
          const intro = lines.slice(0, firstNumIdx).join(" ");
          const nums = lines.slice(firstNumIdx);
          return (
            "<p>" +
            renderInlineMd(htmlEscape(intro)) +
            "</p>\n  " +
            renderNumberedList(nums)
          );
        }
      }

      // Default: plain paragraph with <br> joins.
      return (
        "<p>" +
        lines
          .map((l) => renderInlineMd(htmlEscape(l)))
          .join("<br>") +
        "</p>"
      );
    })
    .filter(Boolean)
    .join("\n  ");
}

function writeHtml({
  outDir,
  slug,
  sections,
  answers,
  title,
  tagline,
  sectionSet,
  generatedAt,
  draft,
}) {
  const tmpl = fs.readFileSync(
    path.join(TEMPLATE_DIR, "brief.html.tmpl"),
    "utf8",
  );
  const sectionBlocks = sections.map((sec, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const ans = answers[sec.id];
    let bodyHtml;
    if (!ans || ans.status === "skipped_declined") {
      bodyHtml = `<p class="skipped-note">Skipped — operator declined to answer this section.</p>`;
    } else if (ans.status === "skipped_disabled") {
      bodyHtml = `<p class="skipped-note">Skipped — section disabled for this run.</p>`;
    } else {
      bodyHtml = paragraphsToHtml(ans.content);
    }
    return [
      `<section>`,
      `  <div class="section-label">${htmlEscape(num)} · ${htmlEscape(sec.title)}</div>`,
      `  <h2>${htmlEscape(sec.title)}</h2>`,
      `  ${bodyHtml}`,
      `</section>`,
    ].join("\n");
  });

  const generatedAtShort = generatedAt.slice(0, 10);
  const out = renderTemplate(tmpl, {
    title: htmlEscape(title),
    slug: htmlEscape(slug),
    tagline: htmlEscape(tagline),
    section_set: htmlEscape(sectionSet),
    generated_at: htmlEscape(generatedAt),
    generated_at_short: htmlEscape(generatedAtShort),
    draft: htmlEscape(String(draft || 1)),
    sections: sectionBlocks.join("\n\n"),
  });
  const file = path.join(outDir, `${slug}.brief.html`);
  fs.writeFileSync(file, out, { encoding: "utf8" });
  return file;
}

// ── DOCX writer (R-6, IN-3, IN-7) ────────────────────────────────
function writeDocx({ outDir, slug, mdPath, backend, pandocInfo }) {
  // backend: 'auto' | 'pandoc' | 'none'
  if (backend === "none") {
    return { status: "skipped_backend_none", path: null };
  }
  if (!pandocInfo.present) {
    if (backend === "pandoc") {
      // Strict: bail with exit 5 BEFORE any md/html were written. Caller
      // handles the ordering — this fn is only called after md/html write
      // if backend == 'auto'. If backend == 'pandoc' and absent, the caller
      // short-circuits to print the install hint.
      return { status: "missing_strict", path: null };
    }
    // auto + absent → soft skip
    return { status: "skipped_pandoc_missing", path: null };
  }
  // Pandoc present → shell out.
  const docxPath = path.join(outDir, `${slug}.brief.docx`);
  try {
    execFileSync(
      "pandoc",
      [mdPath, "-f", "markdown", "-t", "docx", "-o", docxPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
        windowsHide: true,
      },
    );
    return { status: "ok", path: docxPath };
  } catch (e) {
    const reason = (e.stderr && e.stderr.toString()) || e.message || "unknown";
    return { status: `error:${reason.slice(0, 200)}`, path: null };
  }
}

function pandocInstallHint() {
  return [
    "DOCX skipped — pandoc not found on PATH.",
    "Markdown and HTML are ready.",
    "To enable DOCX, install pandoc:",
    "  • Windows: `winget install --id JohnMacFarlane.Pandoc` or `choco install pandoc`",
    "  • macOS:   `brew install pandoc`",
    "  • Linux:   `apt install pandoc` / `dnf install pandoc`",
    "Then re-run with `--docx-backend pandoc` (or just /portfolio:bootstrap — auto will pick it up).",
  ].join("\n");
}

// ── Rerun / versioning (R-9, IN-5) ───────────────────────────────
function detectRerun(outDir, slug) {
  const md = path.join(outDir, `${slug}.brief.md`);
  return fs.existsSync(md);
}

// Count completed drafts in history/, return number of THIS draft.
// First emit (no history) → 1. After versioning prior to history → N+1.
function computeDraftNumber(outDir) {
  const histRoot = path.join(outDir, "history");
  if (!fs.existsSync(histRoot)) return 1;
  try {
    const entries = fs.readdirSync(histRoot, { withFileTypes: true });
    const dirCount = entries.filter((e) => e.isDirectory()).length;
    return dirCount + 1;
  } catch {
    return 1;
  }
}

function versionPriorBrief(outDir, slug) {
  // Move existing <slug>.brief.* into <slug>/history/<ISO>/
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const histDir = path.join(outDir, "history", stamp);
  fs.mkdirSync(histDir, { recursive: true });
  const entries = fs.readdirSync(outDir, { withFileTypes: true });
  let moved = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.startsWith(`${slug}.brief.`)) {
      const src = path.join(outDir, e.name);
      const dst = path.join(histDir, e.name);
      fs.renameSync(src, dst);
      moved++;
    }
  }
  return { dir: histDir, moved };
}

function overwritePriorBrief(outDir, slug) {
  const entries = fs.readdirSync(outDir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.startsWith(`${slug}.brief.`)) {
      fs.unlinkSync(path.join(outDir, e.name));
      removed++;
    }
  }
  return { removed };
}

// ── Lock file (RT-5) ─────────────────────────────────────────────
function acquireLock(outDir, slug) {
  const lock = path.join(outDir, `.${slug}.brief.lock`);
  try {
    const fd = fs.openSync(lock, "wx");
    fs.writeSync(
      fd,
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
    );
    fs.closeSync(fd);
    return { ok: true, lock };
  } catch (e) {
    if (e.code === "EEXIST") {
      // Stale-lock detection: if older than 10min, override.
      try {
        const st = fs.statSync(lock);
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > 10 * 60 * 1000) {
          fs.unlinkSync(lock);
          return acquireLock(outDir, slug);
        }
      } catch {
        // ignore
      }
      return { ok: false, reason: "another bootstrap run is in progress" };
    }
    return { ok: false, reason: e.message };
  }
}

function releaseLock(lock) {
  try {
    if (lock && fs.existsSync(lock)) fs.unlinkSync(lock);
  } catch {
    // best-effort
  }
}

// ── paths.json registration (R-8) ────────────────────────────────
function registerPaths(slug, outDirRel) {
  // R-8: add paths.briefs ("_docs/briefs/") and paths.briefsCurrent
  // ("_docs/briefs/<slug>/" or the resolved outDirRel). Update if exists.
  // Honors CLAUDE.md path-registry rule.
  let registered = { briefs: false, briefsCurrent: false };
  let json;
  try {
    const raw = fs.readFileSync(PATHS_JSON, "utf8");
    json = JSON.parse(raw);
  } catch (e) {
    // If paths.json doesn't exist, do not synthesize one — that's framework
    // territory. Skip registration and report.
    return { registered, error: `paths.json read failed: ${e.message}` };
  }

  const desiredBriefs = "_docs/briefs";
  const desiredCurrent = toForwardSlash(outDirRel);

  if (json.briefs !== desiredBriefs) {
    json.briefs = desiredBriefs;
    registered.briefs = true;
  }
  if (json.briefsCurrent !== desiredCurrent) {
    json.briefsCurrent = desiredCurrent;
    registered.briefsCurrent = true;
  }

  // Write back with stable formatting (2-space indent, trailing newline).
  fs.writeFileSync(PATHS_JSON, JSON.stringify(json, null, 2) + "\n", "utf8");
  return { registered, error: null };
}

function toForwardSlash(p) {
  return String(p).replace(/\\/g, "/");
}

// ── Events emission (TR-1/2/3, R-10) ─────────────────────────────
function emitEvent(type, payload) {
  // Fail-open per trace.md: a logger failure must NOT crash the user run.
  try {
    const dir = path.dirname(EVENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        type,
        ...payload,
      }) + "\n";
    fs.appendFileSync(EVENTS_FILE, line, "utf8");
  } catch {
    // swallow
  }
}

// ── Help text (C-1) ──────────────────────────────────────────────
function printHelp() {
  process.stdout.write(
    [
      "/portfolio:bootstrap — Bootstrap a thorough product brief from a guided discussion.",
      "",
      "Walks through 4-8 questions covering problem, jobs-to-be-done, value chain,",
      "competitive landscape, wedge, vision, wedge->full-vision arc, and MVP. Emits MD +",
      "HTML (always) and DOCX (when pandoc is installed) to `_docs/briefs/<slug>/`.",
      "",
      "Usage: /portfolio:bootstrap [--slug <name>] [--section-set minimal|extended] " +
        "[--docx-backend auto|pandoc|none] [--output-dir <path>] " +
        "[--rerun-policy overwrite|version|prompt]",
      "",
      "Intended as the first command run in a new project.",
      "",
    ].join("\n"),
  );
}

// ── Greeting (C-2) ───────────────────────────────────────────────
function printGreeting() {
  process.stdout.write(
    [
      "Bootstrapping your product brief. I'll ask 4-8 focused questions covering",
      "problem, JTBDs, value chain, competitive landscape, wedge, vision, and MVP.",
      "After that I'll draft the brief, run coverage QC, and write MD + HTML (and",
      "DOCX if pandoc is on PATH) to `_docs/briefs/<slug>/`. Ready when you are.",
      "",
    ].join("\n"),
  );
}

// ── Main ─────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate flag enums first (cheaper than probing pandoc).
  if (!["minimal", "extended"].includes(args.sectionSet)) {
    die(
      2,
      `Unknown section set '${args.sectionSet}'. Use minimal or extended.`,
    );
  }
  if (!["auto", "pandoc", "none"].includes(args.docxBackend)) {
    die(
      2,
      `Unknown docx backend '${args.docxBackend}'. Use auto, pandoc, or none.`,
    );
  }
  if (!["overwrite", "version", "prompt"].includes(args.rerunPolicy)) {
    die(
      2,
      `Unknown rerun policy '${args.rerunPolicy}'. Use overwrite, version, or prompt.`,
    );
  }

  // Resolve slug (IN-1)
  let rawSlug = args.slug;
  let slug = rawSlug || deriveSlugFromCwd(process.cwd());
  if (rawSlug && rawSlug !== slug) {
    // user-provided slug that doesn't match: still validate the raw value
  }
  if (!rawSlug && !SLUG_RE.test(slug)) {
    // Derived slug not valid — synthesize a hint
    slug = normalizeSlug(slug);
  }
  validateSlug(slug, rawSlug);

  // Probe pandoc
  const pandocInfo = probePandoc();

  // Resolve output dir
  const outDir = resolveOutputDir(args, slug);
  const outDirRel = toForwardSlash(
    path.relative(PROJECT, outDir) || `_docs/briefs/${slug}`,
  );

  // Detect re-run
  const rerunDetected = fs.existsSync(outDir) && detectRerun(outDir, slug);

  // --probe short-circuit (used by the skill driver to gate on env)
  if (args.probe) {
    process.stdout.write(
      JSON.stringify(
        {
          slug,
          section_set: args.sectionSet,
          docx_backend: args.docxBackend,
          output_dir: outDirRel,
          rerun_policy: args.rerunPolicy,
          rerun_detected: rerunDetected,
          pandoc_present: pandocInfo.present,
          pandoc_path: pandocInfo.path,
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(0);
  }

  // Strict pandoc + absent → exit 5 BEFORE we touch the filesystem.
  if (args.docxBackend === "pandoc" && !pandocInfo.present) {
    process.stderr.write(pandocInstallHint() + "\n");
    process.exit(5);
  }

  printGreeting();

  // Load sections + answers
  const sections = loadSections(args.sectionSet);
  const answers = loadAnswers(args.answersFile);

  // If no answers file was provided, this script is being invoked outside
  // the interactive skill driver. Print guidance and bail with exit 2 — the
  // discussion must happen in the Claude harness via AskUserQuestion.
  if (!args.answersFile) {
    process.stderr.write(
      [
        "No --answers-file supplied.",
        "",
        "/portfolio:bootstrap is intended to be invoked through the Claude",
        "harness, which runs the AskUserQuestion discussion and passes the",
        "answers in via --answers-file. To run the generator non-interactively",
        "(tests, CI), provide a JSON map keyed by section id, e.g.:",
        '  { "problem": "...", "jtbds": "...", ... }',
        "and pass --answers-file <path>.",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }

  const title =
    args.title ||
    slug
      .split("-")
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  const tagline = args.tagline || `Product brief for ${slug}.`;
  const generatedAt = new Date().toISOString();
  const startedAt = generatedAt;
  const t0 = Date.now();

  // Emit brief_started (TR-1)
  emitEvent("brief_started", {
    slug,
    section_set: args.sectionSet,
    docx_backend: args.docxBackend,
    output_dir: outDirRel,
    rerun_policy: args.rerunPolicy,
    rerun_detected: rerunDetected,
    pandoc_present: pandocInfo.present,
    started_at: startedAt,
  });

  // Coverage QC (R-3) — BEFORE any disk writes.
  const qc = runCoverageQc(sections, answers);
  if (!qc.ok) {
    const msg = [
      "Brief coverage check failed. The following sections have no usable content:",
      ...qc.missing.map((m) => `  - ${m}`),
      "No files were written. You can either: re-run and answer the prompts for those sections,",
      "or pass `--section-set minimal` to drop optional sections.",
    ].join("\n");
    process.stderr.write(msg + "\n");
    // emit terminal brief_emitted with failure outcome
    emitEvent("brief_emitted", {
      slug,
      output_dir: outDirRel,
      formats: { md: "not_written", html: "not_written", docx: "not_written" },
      format_counts: { ok: 0, skipped: 0, error: 0 },
      rerun_action: "none",
      paths_registered: { briefs: false, briefsCurrent: false },
      total_elapsed_ms: Date.now() - t0,
      outcome: "failure",
      failure_reason: "coverage_qc_missing_sections",
    });
    process.exit(3);
  }

  // Output dir create + writability + lock
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    process.stderr.write(
      `Cannot create output dir \`${outDir}\`: ${e.message}\n`,
    );
    process.exit(4);
  }
  // Writability probe
  try {
    fs.accessSync(outDir, fs.constants.W_OK);
  } catch (e) {
    process.stderr.write(
      `Cannot write to \`${outDir}\`: ${e.message}. Common causes: directory is open in another program, antivirus is holding files, or the path is read-only. Free the directory and re-run, or pass --output-dir <other-path>.\n`,
    );
    process.exit(4);
  }

  const lockResult = acquireLock(outDir, slug);
  if (!lockResult.ok) {
    process.stderr.write(
      `Cannot acquire lock on \`${outDir}\`: ${lockResult.reason}.\n`,
    );
    process.exit(4);
  }

  let rerunAction = "none";
  try {
    // Rerun policy handling
    if (rerunDetected) {
      let effectivePolicy = args.rerunPolicy;
      if (effectivePolicy === "prompt") {
        // Non-interactive fallback (AC-S-6.5). The Claude harness drives
        // the prompt at the skill layer; this generator falls back to version.
        if (!process.stdin.isTTY) {
          process.stderr.write(
            "Re-run policy is `prompt` but stdin is not a TTY; falling back to `version`.\n",
          );
          effectivePolicy = "version";
        } else {
          // We do not block here — the skill driver should pass overwrite
          // or version explicitly after the user's choice. Default to version.
          effectivePolicy = "version";
        }
      }
      if (effectivePolicy === "version") {
        const v = versionPriorBrief(outDir, slug);
        rerunAction = "versioned";
        process.stdout.write(
          `Versioned ${v.moved} prior file(s) into ${path.relative(PROJECT, v.dir)}\n`,
        );
      } else if (effectivePolicy === "overwrite") {
        const v = overwritePriorBrief(outDir, slug);
        rerunAction = "overwritten";
        if (v.removed > 0) {
          process.stdout.write(`Overwrote ${v.removed} prior file(s).\n`);
        }
      }
    }

    // Per-section emit + write (TR-2)
    const sectionEvents = [];
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const ans = answers[sec.id] || {
        content: "",
        status: "skipped_declined",
      };
      const wc = ans.content
        ? ans.content.trim().split(/\s+/).filter(Boolean).length
        : 0;
      const evt = {
        slug,
        section_id: sec.id,
        section_index: i + 1,
        word_count: wc,
        source_turns: ans.source_turns || [],
        status: ans.status,
        elapsed_ms: Date.now() - t0,
      };
      sectionEvents.push(evt);
      emitEvent("section_completed", evt);
    }

    // Write MD + HTML
    const draft = computeDraftNumber(outDir);
    const mdPath = writeMd({
      outDir,
      slug,
      sections,
      answers,
      title,
      tagline,
      sectionSet: args.sectionSet,
      generatedAt,
      draft,
    });
    const htmlPath = writeHtml({
      outDir,
      slug,
      sections,
      answers,
      title,
      tagline,
      sectionSet: args.sectionSet,
      generatedAt,
      draft,
    });

    // DOCX (R-6)
    const docxResult = writeDocx({
      outDir,
      slug,
      mdPath,
      backend: args.docxBackend,
      pandocInfo,
    });
    let docxStatus = docxResult.status;
    if (docxStatus === "skipped_pandoc_missing") {
      process.stdout.write("\n" + pandocInstallHint() + "\n\n");
    }

    // paths.json registration (R-8)
    const pathsReg = registerPaths(slug, outDirRel);

    // Success summary (C-8)
    const docxLine =
      docxStatus === "ok"
        ? `  • DOCX: ${path.basename(docxResult.path)}`
        : docxStatus === "skipped_backend_none"
          ? `  • DOCX: skipped (--docx-backend none)`
          : docxStatus === "skipped_pandoc_missing"
            ? `  • DOCX: skipped — pandoc not found`
            : `  • DOCX: ${docxStatus}`;
    process.stdout.write(
      [
        `Brief ready at ${outDirRel}/:`,
        `  • MD:   ${path.basename(mdPath)}`,
        `  • HTML: ${path.basename(htmlPath)}`,
        docxLine,
        "",
        "`paths.briefsCurrent` now points here. Next commands that read it: /sprint:plan, /oneshot:start.",
        "",
      ].join("\n"),
    );

    // Final emit (TR-3)
    const formats = {
      md: "ok",
      html: "ok",
      docx: docxStatus,
    };
    const counts = { ok: 0, skipped: 0, error: 0 };
    for (const v of Object.values(formats)) {
      if (v === "ok") counts.ok++;
      else if (typeof v === "string" && v.startsWith("error")) counts.error++;
      else counts.skipped++;
    }
    emitEvent("brief_emitted", {
      slug,
      output_dir: outDirRel,
      formats,
      format_counts: counts,
      rerun_action: rerunAction,
      paths_registered: pathsReg.registered,
      total_elapsed_ms: Date.now() - t0,
      outcome: counts.error === 0 ? "success" : "partial",
    });
  } finally {
    releaseLock(lockResult.lock);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  // Exported for tests
  normalizeSlug,
  validateSlug: (s, r) => {
    try {
      validateSlug(s, r);
      return true;
    } catch {
      return false;
    }
  },
  probePandoc,
  resolveOutputDir,
  loadSections,
  loadAnswers,
  runCoverageQc,
  htmlEscape,
  paragraphsToHtml,
  registerPaths,
  detectRerun,
  versionPriorBrief,
  overwritePriorBrief,
  sanitizeAnswer,
  sanitizeText,
  SLUG_RE,
  MAX_ANSWER_LEN,
};
