#!/usr/bin/env node

/**
 * scripts/portfolio/clone.js
 *
 * Generator for the /portfolio:clone skill — competitor-product intel.
 *
 * Mirrors `scripts/portfolio/bootstrap.js` architecturally. The skill body (the
 * Claude session that invokes /portfolio:clone) drives the live WebFetch /
 * WebSearch / LLM extraction passes; this generator owns:
 *
 *   • CLI flag parsing + validation (IN-1..IN-8, AC-1.1..1.3, AC-4.3)
 *   • Slug derivation/validation (IN-5)
 *   • SSRF guardrails (IN-2, AC-1.3, redteam SCENARIO-1)
 *   • Output dir resolution + writability probe + traversal-block (IN-4)
 *   • Source cache layout under `_docs/clones/<slug>/_raw/<sha>.{html,meta.json}`
 *     (AC-5.1, AC-5.2, R-5, R-6)
 *   • Partial-deliverable rendering with `[GAP — ...]` markers (R-10, AC-14.x)
 *   • Telemetry: clone_started, product_identified, urls_discovered,
 *     source_fetched, source_failed, attribution_stripped,
 *     extraction_completed, clone_emitted — appended to paths.eventsFile
 *     (fail-open) (R-9, AC-13.x, TR-1..TR-7)
 *   • Output emission: <slug>.clone.{md,html,docx} (R-7, AC-11.1..11.3)
 *   • Paths registration deferred to a future opt-in flag — see the
 *     `registerPaths` export. THE SKILL DRIVER calls registerPaths after the
 *     parallel-build main thread adds `paths.clones` / `paths.clonesCurrent`
 *     keys to .claude/paths.json.
 *
 * Exit codes (PRD R-1):
 *   0  success (may include [GAP] markers in permissive mode)
 *   2  invalid input (slug, URL, flag value)
 *   3  zero-source corpus (no fetchable source — AC-14.3)
 *   4  output dir not writable
 *   5  strict-mode partial failure (AC-14.2)
 *
 * Sprint: SP-20260520-001 · Plan Contract: PC-20260521-0017
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");

// ── Resolve project root ─────────────────────────────────────────
const PROJECT = resolveProjectRoot();

function resolveProjectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  }
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
  "product-clone",
);
const PATHS_JSON = path.join(PROJECT, ".claude", "paths.json");
const EVENTS_FILE = path.join(
  PROJECT,
  ".claude",
  "project",
  "events",
  "events.jsonl",
);
const DEFAULT_OUTPUT_BASE = path.join("_docs", "clones");
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PANDOC_PROBE_TIMEOUT_MS = 2000;
const MAX_NAME_LEN = 200;
const PRODUCT_DISCOVERY_HARD_CAP = 8; // R-3
const MAX_REVIEW_SOURCES_RANGE = [1, 8]; // IN-6
const REVIEW_HOSTS = [
  "g2.com",
  "producthunt.com",
  "reddit.com",
  "news.ycombinator.com",
  "twitter.com",
  "x.com",
  "dev.to",
  "medium.com",
];

// Section ordering MUST match D-2 / AC-11.3. Stable headings → downstream
// /portfolio:bootstrap --from-clone or /sprint:plan can ingest by heading id.
const SECTION_ORDER = [
  "product_identity",
  "jtbds",
  "feature_list",
  "voice_of_customer",
  "gaps",
  "opportunities",
  "source_attribution_log",
];

const EXTRACTION_PASS_SECTIONS = [
  "jtbds",
  "feature_list",
  "voice_of_customer",
  "gaps",
  "opportunities",
];

// ── CLI parsing ──────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    name: null,
    url: null,
    video: null,
    outputDir: null,
    slug: null,
    maxReviewSources: 3,
    noCache: false,
    strict: false,
    help: false,
    probe: false,
    draftFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--name":
        args.name = next();
        break;
      case "--url":
        args.url = next();
        break;
      case "--video":
        args.video = next();
        break;
      case "--output-dir":
        args.outputDir = next();
        break;
      case "--slug":
        args.slug = next();
        break;
      case "--max-review-sources": {
        const raw = next();
        const n = Number(raw);
        if (!Number.isInteger(n)) {
          die(2, `--max-review-sources must be an integer; got '${raw}'`);
        }
        if (
          n < MAX_REVIEW_SOURCES_RANGE[0] ||
          n > MAX_REVIEW_SOURCES_RANGE[1]
        ) {
          die(
            2,
            `--max-review-sources must be in [${MAX_REVIEW_SOURCES_RANGE.join(", ")}]; got ${n}`,
          );
        }
        args.maxReviewSources = n;
        break;
      }
      case "--no-cache":
        args.noCache = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--probe":
        args.probe = true;
        break;
      case "--draft-file":
        // Optional JSON payload pre-built by the skill driver. Maps section
        // ids → markdown body (already-attributed, post-presence-check).
        args.draftFile = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a && a.startsWith("--")) {
          die(2, `unknown flag: ${a}`);
        }
        // Ignore positional args silently.
        break;
    }
  }
  return args;
}

function die(code, msg) {
  process.stderr.write(`product:clone: ${msg}\n`);
  if (code === 2) {
    process.stderr.write("\n" + helpText() + "\n");
  }
  process.exit(code);
}

// ── Help / banner copy (C-1, C-2) ────────────────────────────────
function helpText() {
  return [
    "/portfolio:clone — competitor-product intel skill",
    "",
    "Usage:",
    "  /portfolio:clone [--name <product>] [--url <url>] [--video <url>] [--slug <slug>]",
    "                 [--output-dir <path>] [--max-review-sources <n>]",
    "                 [--no-cache] [--strict] [--help]",
    "",
    "At least one of --name, --url, --video is required. Output is written to",
    "_docs/clones/<slug>/ as MD + HTML (always), DOCX (when pandoc on PATH).",
    "",
    "Exit codes: 0 success (may include [GAP] markers), 2 invalid input,",
    "3 no usable sources found, 4 output dir not writable, 5 strict-mode partial failure.",
  ].join("\n");
}

function startBanner({
  target,
  slug,
  outputDirRel,
  mode,
  maxReviewSources,
}) {
  return [
    `/portfolio:clone — target: ${target}`,
    `slug: ${slug}  ·  output: ${outputDirRel}/  ·  mode: ${mode}  ·  max-review-sources: ${maxReviewSources}`,
  ].join("\n");
}

// ── Input validation (IN-1..IN-3) ────────────────────────────────
function validateName(name) {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (!trimmed) die(2, "--name must be non-empty after trim");
  if (trimmed.length > MAX_NAME_LEN) {
    die(2, `--name length ${trimmed.length} exceeds max ${MAX_NAME_LEN}`);
  }
  // Disallow ASCII control chars except TAB.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0a-\x1f]/.test(trimmed)) {
    die(2, "--name contains disallowed control characters");
  }
  return trimmed;
}

function validateUrl(rawUrl, flagName) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    die(2, `${flagName} is not a valid URL: ${e.message}`);
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme === "file") {
    die(
      2,
      `${flagName} uses disallowed scheme 'file://' (SSRF guard, IN-2)`,
    );
  }
  if (scheme === "javascript" || scheme === "data" || scheme === "ftp") {
    die(
      2,
      `${flagName} uses disallowed scheme '${scheme}:' (IN-2 allows only http/https)`,
    );
  }
  if (scheme !== "http" && scheme !== "https") {
    die(
      2,
      `${flagName} scheme must be http or https; got '${scheme}'`,
    );
  }
  const host = parsed.hostname || "";
  if (!host) {
    die(2, `${flagName} has empty hostname`);
  }
  if (isBlockedIpLiteral(host)) {
    die(
      2,
      `${flagName} hostname '${host}' is an IP-literal / private / loopback / link-local address — blocked to prevent SSRF (IN-2). Use a public DNS hostname.`,
    );
  }
  return parsed;
}

function isBlockedIpLiteral(host) {
  // IPv6 loopback and link-local
  const lower = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  // IPv4 dotted-quad detection
  const m = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map((s) => Number(s));
  if (oct.some((n) => n > 255)) return true;
  const [a, b] = oct;
  // 0.0.0.0/8 (current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (private)
  if (a === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local — incl. AWS metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (private)
  if (a === 192 && b === 168) return true;
  return false;
}

// ── Slug derivation + validation (IN-5) ──────────────────────────
function normalizeSlug(input) {
  if (input == null) return "";
  return String(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function deriveSlug({ slug, name, urlObj }) {
  if (slug) return slug;
  if (name) return normalizeSlug(name);
  if (urlObj) {
    // Use the hostname's primary label.
    const host = urlObj.hostname.replace(/^www\./, "");
    return normalizeSlug(host);
  }
  return "";
}

function validateSlug(slug, raw) {
  if (!slug || !SLUG_RE.test(slug)) {
    const suggestion = normalizeSlug(raw || slug) || "<empty>";
    const msg = [
      `Slug '${raw ?? slug}' is not valid (regex ${SLUG_RE}).`,
      "Slugs must start with a lowercase letter or digit, contain only",
      "lowercase letters, digits, and hyphens, and be 1-64 characters.",
      `Suggested: '${suggestion}'`,
    ].join("\n");
    die(2, msg);
  }
}

// ── Output dir resolution (IN-4) ─────────────────────────────────
function resolveOutputDir(args, slug) {
  let dir;
  if (args.outputDir) {
    dir = path.resolve(PROJECT, args.outputDir);
  } else {
    dir = path.join(PROJECT, DEFAULT_OUTPUT_BASE, slug);
  }
  const projectAbs = path.resolve(PROJECT);
  const dirAbs = path.resolve(dir);
  const rel = path.relative(projectAbs, dirAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    die(2, "--output-dir must stay inside the project root.");
  }
  return dir;
}

// ── Pandoc probe ─────────────────────────────────────────────────
function probePandoc() {
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
    /* fall through */
  }
  try {
    const r = spawnSync("pandoc", ["--version"], {
      timeout: PANDOC_PROBE_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    if (r.status === 0) return { present: true, path: "pandoc" };
  } catch (e) {
    /* absent */
  }
  return { present: false, path: null };
}

function probeYtDlp() {
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  try {
    const r = spawnSync(finder, ["yt-dlp"], {
      timeout: PANDOC_PROBE_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return { present: true, path: r.stdout.trim().split(/\r?\n/)[0] };
    }
  } catch (e) {
    /* fall through */
  }
  return { present: false, path: null };
}

function pandocInstallHint() {
  // C-5 — keep terse, matches bootstrap's tone.
  return "note: pandoc not on PATH — skipping DOCX output. Install pandoc to enable.";
}

function ytDlpFallbackNotice() {
  // C-10
  return "note: yt-dlp not on PATH — video transcript unavailable. Falling back to WebSearch on the video title.";
}

// ── Source cache layout (R-5, AC-5.1, AC-5.2) ────────────────────
function cacheDirFor(outDir) {
  return path.join(outDir, "_raw");
}

function cacheKeyFor(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex");
}

function cachePathsFor(outDir, url) {
  const key = cacheKeyFor(url);
  const dir = cacheDirFor(outDir);
  return {
    key,
    htmlPath: path.join(dir, `${key}.html`),
    metaPath: path.join(dir, `${key}.meta.json`),
  };
}

function readCacheIfFresh(outDir, url, { noCache }) {
  if (noCache) return null;
  const { htmlPath, metaPath } = cachePathsFor(outDir, url);
  if (!fs.existsSync(htmlPath) || !fs.existsSync(metaPath)) return null;
  try {
    const body = fs.readFileSync(htmlPath, "utf8");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return { body, meta, cached: true };
  } catch {
    return null;
  }
}

function writeCache(outDir, url, body, meta) {
  const dir = cacheDirFor(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const { htmlPath, metaPath } = cachePathsFor(outDir, url);
  fs.writeFileSync(htmlPath, body == null ? "" : String(body), "utf8");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        url,
        retrieved_at: meta.retrieved_at,
        http_status: meta.http_status,
        bytes: meta.bytes ?? (body ? Buffer.byteLength(body, "utf8") : 0),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return { htmlPath, metaPath };
}

// ── URL discovery (R-3, AC-3.1..3.3) ─────────────────────────────
const DISCOVERY_PRIORITY_PATHS = [
  /\/pricing(\/|$)/i,
  /\/features?(\/|$)/i,
  /\/docs?(\/|$)/i,
  /\/about(\/|$)/i,
  /\/blog(\/|$)/i,
  /\/changelog(\/|$)/i,
  /\/customers(\/|$)/i,
];

function categorizeDiscoveredUrl(url) {
  const u = String(url).toLowerCase();
  if (/\/pricing(\/|$)/.test(u)) return "pricing";
  if (/\/features?(\/|$)/.test(u)) return "features";
  if (/\/docs?(\/|$)/.test(u)) return "docs";
  if (/\/about(\/|$)/.test(u)) return "about";
  if (/\/blog(\/|$)/.test(u)) return "blog";
  if (/\/changelog(\/|$)/.test(u)) return "changelog";
  if (/\/customers(\/|$)/.test(u)) return "customers";
  return "other";
}

function priorityScore(url) {
  for (let i = 0; i < DISCOVERY_PRIORITY_PATHS.length; i++) {
    if (DISCOVERY_PRIORITY_PATHS[i].test(url)) return i;
  }
  return DISCOVERY_PRIORITY_PATHS.length;
}

function filterDiscoveredUrls(seedUrl, candidates, { cap }) {
  // candidates: array of absolute URL strings
  let seedHost;
  try {
    seedHost = new URL(seedUrl).hostname.toLowerCase();
  } catch {
    return { kept: [], dropped: candidates.slice(), discoveredCount: candidates.length, droppedReason: "invalid_seed" };
  }
  const seen = new Set();
  const sameHost = [];
  const dropped = [];
  for (const c of candidates) {
    if (!c || typeof c !== "string") continue;
    let cu;
    try {
      cu = new URL(c, seedUrl);
    } catch {
      dropped.push({ url: c, reason: "invalid_url" });
      continue;
    }
    if (cu.hostname.toLowerCase() !== seedHost) {
      dropped.push({ url: c, reason: "external_host" });
      continue;
    }
    const normalized = cu.origin + cu.pathname;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    sameHost.push(normalized);
  }
  // Stable-sort by priority then by original order.
  const sortable = sameHost.map((u, idx) => ({ url: u, score: priorityScore(u), idx }));
  sortable.sort((a, b) => a.score - b.score || a.idx - b.idx);
  const kept = sortable.slice(0, cap).map((s) => s.url);
  const overflow = sortable.slice(cap).map((s) => s.url);
  for (const u of overflow) dropped.push({ url: u, reason: "over_cap" });
  return {
    kept,
    dropped,
    discoveredCount: sameHost.length + dropped.filter((d) => d.reason !== "over_cap" && d.reason !== "external_host" && d.reason !== "invalid_url").length + sameHost.length,
    // Discovered count = unique same-host URLs before the cap.
    sameHostCount: sameHost.length,
    categories: kept.reduce((acc, u) => {
      const cat = categorizeDiscoveredUrl(u);
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ── Template engine (mustache-lite) ──────────────────────────────
function renderTemplate(tmpl, vars) {
  return tmpl.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

// ── HTML helpers ─────────────────────────────────────────────────
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToBasicHtml(md) {
  // Lightweight MD→HTML renderer matching bootstrap's paragraphsToHtml
  // capabilities, extended for tables and headings used inside section bodies.
  // Splits on blank lines; each block becomes a <p>, <ul>, <ol>, <h3>, or table.
  const blocks = String(md).split(/\n{2,}/);
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split(/\n/);
    // Table block: starts with `|`, second line is `|---`
    if (lines.length >= 2 && /^\|/.test(lines[0]) && /^\|\s*[-:]/.test(lines[1])) {
      out.push(renderTableHtml(lines));
      continue;
    }
    // h3 / h4 (subheadings under the section)
    if (/^####\s+/.test(lines[0])) {
      out.push("<h4>" + htmlEscape(lines[0].replace(/^####\s+/, "")) + "</h4>");
      const rest = lines.slice(1).join("\n").trim();
      if (rest) out.push(markdownToBasicHtml(rest));
      continue;
    }
    if (/^###\s+/.test(lines[0])) {
      out.push("<h3>" + htmlEscape(lines[0].replace(/^###\s+/, "")) + "</h3>");
      const rest = lines.slice(1).join("\n").trim();
      if (rest) out.push(markdownToBasicHtml(rest));
      continue;
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      out.push(
        "<ul>" +
          lines
            .map(
              (l) =>
                "<li>" + escapeInlineMd(l.replace(/^\s*[-*•]\s+/, "")) + "</li>",
            )
            .join("") +
          "</ul>",
      );
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      out.push(
        "<ol>" +
          lines
            .map(
              (l) =>
                "<li>" + escapeInlineMd(l.replace(/^\s*\d+[.)]\s+/, "")) + "</li>",
            )
            .join("") +
          "</ol>",
      );
      continue;
    }
    out.push("<p>" + escapeInlineMd(block).replace(/\n/g, "<br>") + "</p>");
  }
  return out.join("\n");
}

function renderTableHtml(lines) {
  const splitRow = (l) =>
    l
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const headers = splitRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitRow);
  const thead =
    "<thead><tr>" +
    headers.map((h) => `<th>${escapeInlineMd(h)}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    bodyRows
      .map(
        (r) =>
          "<tr>" + r.map((c) => `<td>${escapeInlineMd(c)}</td>`).join("") + "</tr>",
      )
      .join("") +
    "</tbody>";
  return `<table>${thead}${tbody}</table>`;
}

function escapeInlineMd(s) {
  // Escape HTML, then turn [GAP — ...] tokens into <span class="gap-marker">.
  let html = htmlEscape(s);
  html = html.replace(
    /\[GAP\s+—\s+[^\]]+\]/g,
    (m) => `<span class="gap-marker">${m}</span>`,
  );
  return html;
}

// ── Section rendering ────────────────────────────────────────────
function loadSectionsConfig() {
  const file = path.join(TEMPLATE_DIR, "sections.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  // sanity check: ensure declared section order matches SECTION_ORDER.
  const declared = data.sections.map((s) => s.id);
  const okOrder = declared.every((id, i) => id === SECTION_ORDER[i]);
  if (!okOrder) {
    throw new Error(
      `_mc/templates/product-clone/sections.json order mismatch — expected ${JSON.stringify(SECTION_ORDER)}, got ${JSON.stringify(declared)}`,
    );
  }
  return data;
}

function loadSectionDefaults() {
  const file = path.join(TEMPLATE_DIR, "section-defaults.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gapMarker(sourceClass, reason, url) {
  if (url) return `[GAP — ${sourceClass} — ${reason}: ${url}]`;
  return `[GAP — ${sourceClass} — ${reason}]`;
}

function buildSectionBody(section, draft, defaults) {
  const draftStr = draft == null ? "" : String(draft).trim();
  if (draftStr) return draftStr;
  const tmpl = defaults[section.id] || `[GAP — extraction — no signal in source material for ${section.id}]`;
  return tmpl.replace(/\{\{gap_pass\}\}/g, section.id).trim();
}

function renderMd({
  sectionsCfg,
  drafts,
  defaults,
  vars,
}) {
  const tmpl = fs.readFileSync(
    path.join(TEMPLATE_DIR, "clone.md.tmpl"),
    "utf8",
  );
  const blocks = sectionsCfg.sections.map((sec, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const heading = `## ${num} — ${sec.title}`;
    const body = buildSectionBody(sec, drafts[sec.id], defaults);
    const trailer = `\n\n<!-- bootstrap-feed: ${sec.feed_id} -->`;
    return `${heading}\n\n${body}${trailer}\n`;
  });
  const out = renderTemplate(tmpl, {
    ...vars,
    sections: blocks.join("\n"),
  });
  return out.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
}

function renderHtml({
  sectionsCfg,
  drafts,
  defaults,
  vars,
}) {
  const tmpl = fs.readFileSync(
    path.join(TEMPLATE_DIR, "clone.html.tmpl"),
    "utf8",
  );
  const blocks = sectionsCfg.sections.map((sec, idx) => {
    const num = String(idx + 1).padStart(2, "0");
    const body = buildSectionBody(sec, drafts[sec.id], defaults);
    const bodyHtml = markdownToBasicHtml(body);
    return [
      "<section>",
      `  <div class="section-label">${htmlEscape(num)} · ${htmlEscape(sec.title)}</div>`,
      `  <h2>${htmlEscape(sec.title)}</h2>`,
      `  ${bodyHtml}`,
      "</section>",
    ].join("\n");
  });
  const generatedAt = vars.generated_at || new Date().toISOString();
  const out = renderTemplate(tmpl, {
    title: htmlEscape(vars.title || ""),
    slug: htmlEscape(vars.slug || ""),
    tagline: htmlEscape(vars.tagline || ""),
    mode: htmlEscape(vars.mode || ""),
    target_name: htmlEscape(vars.target_name || ""),
    target_url: htmlEscape(vars.target_url || ""),
    generated_at: htmlEscape(generatedAt),
    generated_at_short: htmlEscape(generatedAt.slice(0, 10)),
    gap_count: htmlEscape(String(vars.gap_count ?? 0)),
    sections: blocks.join("\n\n"),
  });
  return out;
}

// ── DOCX via pandoc ──────────────────────────────────────────────
function writeDocx({ outDir, slug, mdPath, pandocInfo }) {
  if (!pandocInfo.present) return { status: "skipped_pandoc_missing", path: null };
  const docxPath = path.join(outDir, `${slug}.clone.docx`);
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

// ── Telemetry (R-9, fail-open) ───────────────────────────────────
let _eventsWarned = false;
function emitEvent(type, payload, { runId } = {}) {
  try {
    const dir = path.dirname(EVENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const evt = {
      ts: new Date().toISOString(),
      type,
      id: runId || null,
      ...payload,
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(evt) + "\n", "utf8");
  } catch (e) {
    if (!_eventsWarned) {
      _eventsWarned = true;
      try {
        process.stderr.write(
          `product:clone: warn — events file write failed (${e.code || e.message || "err"}); continuing fail-open.\n`,
        );
      } catch {
        /* even stderr is broken; give up silently */
      }
    }
  }
}

function newRunId() {
  // RFC4122 v4-ish without bringing in `crypto.randomUUID` for Node <14.17.
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto
    .randomBytes(16)
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

// ── Source-attribution log (R-6, AC-5.1, AC-13.2) ────────────────
function renderSourceAttributionLog(records) {
  if (!records.length) return "_No sources fetched in this run._\n";
  const ok = records.filter((r) => r.status === "ok");
  const failed = records.filter((r) => r.status !== "ok");
  const headers = "| # | URL | Class | HTTP | Bytes | Retrieved |";
  const sep = "|---|-----|-------|------|-------|-----------|";
  const okRows = ok.map((r, i) =>
    `| ${i + 1} | ${r.url} | ${r.source_class} | ${r.http_status} | ${r.bytes ?? ""} | ${r.retrieved_at} |`,
  );
  const lines = [headers, sep, ...okRows];
  let out = "### Fetched\n\n" + lines.join("\n") + "\n";
  if (failed.length) {
    out += "\n### Failed\n\n";
    out += "| # | URL | Class | Reason | Attempts |\n|---|-----|-------|--------|----------|\n";
    out += failed
      .map(
        (r, i) =>
          `| ${i + 1} | ${r.url} | ${r.source_class} | ${r.failure_reason} | ${r.attempts ?? 1} |`,
      )
      .join("\n");
    out += "\n";
  }
  return out;
}

// ── paths.json registration (R-8, AC-12.x) ───────────────────────
// NOTE: paths registration for paths.clones / paths.clonesCurrent is gated on
// the keys being present in .claude/paths.json. The main thread of the
// parallel sprint build adds those keys; this generator only UPDATES them
// (idempotent, atomic) when present. If absent, we print a single C-12 note
// stating registration was skipped pending main-thread paths bootstrap.
function registerPaths(slug, outDirRel, { firstEmit }) {
  let json;
  let raw;
  try {
    raw = fs.readFileSync(PATHS_JSON, "utf8");
    json = JSON.parse(raw);
  } catch (e) {
    return {
      registered: { clones: false, clonesCurrent: false },
      error: `paths.json read failed: ${e.message}`,
      pending_main_thread: true,
    };
  }

  const desiredClones = "_docs/clones";
  const desiredCurrent = toForwardSlash(outDirRel);

  // If the main thread has not yet added paths.clones to the registry, we
  // do NOT synthesize it — the parallel-build instructions forbid touching
  // paths.json. Report pending and continue.
  const clonesPresent = Object.prototype.hasOwnProperty.call(json, "clones");
  const currentPresent = Object.prototype.hasOwnProperty.call(
    json,
    "clonesCurrent",
  );
  if (!clonesPresent || !currentPresent) {
    return {
      registered: { clones: false, clonesCurrent: false },
      error: null,
      pending_main_thread: true,
      first_emit: firstEmit,
    };
  }

  let changed = false;
  const registered = { clones: false, clonesCurrent: false };
  if (json.clones !== desiredClones) {
    json.clones = desiredClones;
    registered.clones = true;
    changed = true;
  }
  if (json.clonesCurrent !== desiredCurrent) {
    json.clonesCurrent = desiredCurrent;
    registered.clonesCurrent = true;
    changed = true;
  }

  if (changed) {
    // Atomic write — JSON.parse(JSON.stringify(...)) round-trip already done.
    writePathsAtomic(json);
  }

  return {
    registered,
    error: null,
    pending_main_thread: false,
    first_emit: firstEmit,
  };
}

function writePathsAtomic(json) {
  const stable = JSON.stringify(json, null, 2) + "\n";
  const tmp = PATHS_JSON + ".tmp-clone-" + process.pid;
  fs.writeFileSync(tmp, stable, "utf8");
  fs.renameSync(tmp, PATHS_JSON);
}

function toForwardSlash(p) {
  return String(p).replace(/\\/g, "/");
}

// ── Run-pipeline orchestrator (callable by the skill driver) ─────
/**
 * Run the emit pipeline against an in-memory bundle of drafts + source records.
 * The skill driver is responsible for filling these in via WebFetch/WebSearch
 * and LLM extraction; this function performs:
 *   • output dir create + writability + traversal check
 *   • cache layout (callers may also have written cache entries directly)
 *   • MD + HTML + DOCX render and emit
 *   • paths registration (idempotent, skips if keys absent)
 *   • clone_emitted telemetry
 *
 * Inputs:
 *   slug             — validated slug
 *   outDir           — absolute output dir (already validated)
 *   pandocInfo       — { present, path }
 *   mode             — 'permissive' | 'strict'
 *   target           — { name, url, resolved_via }
 *   drafts           — { product_identity, jtbds, feature_list, voice_of_customer,
 *                        gaps, opportunities, source_attribution_log? }
 *                       Values are markdown strings, already attributed and
 *                       presence-checked by the caller.
 *   sourceRecords    — array of { url, source_class, status, http_status, bytes,
 *                                  retrieved_at, failure_reason?, attempts? }
 *   runId            — uuid carried from clone_started
 *   firstEmit        — boolean (was paths.clones absent at start of run?)
 *
 * Returns { mdPath, htmlPath, docxResult, pathsReg, gapCount }.
 */
function runEmit({
  slug,
  outDir,
  pandocInfo,
  mode,
  target,
  drafts,
  sourceRecords,
  runId,
  firstEmit,
  t0,
}) {
  // outDir create + writability probe.
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    die(4, `cannot create output dir '${outDir}': ${e.message}`);
  }
  try {
    fs.accessSync(outDir, fs.constants.W_OK);
  } catch (e) {
    die(4, `cannot write to '${outDir}': ${e.message}`);
  }

  const outDirRel = toForwardSlash(
    path.relative(PROJECT, outDir) || path.join(DEFAULT_OUTPUT_BASE, slug),
  );

  const sectionsCfg = loadSectionsConfig();
  const defaults = loadSectionDefaults();

  // Build source-attribution log if caller didn't supply one.
  const draftsResolved = { ...drafts };
  if (
    !draftsResolved.source_attribution_log ||
    !String(draftsResolved.source_attribution_log).trim()
  ) {
    draftsResolved.source_attribution_log = renderSourceAttributionLog(
      sourceRecords || [],
    );
  }

  const generatedAt = new Date().toISOString();
  const targetName = (target && target.name) || slug;
  const targetUrl = (target && target.url) || "";
  const resolvedVia = (target && target.resolved_via) || "unknown";
  const title =
    targetName
      ? `${targetName} — Competitor Clone Brief`
      : `${slug} — Competitor Clone Brief`;
  const tagline = targetUrl
    ? `Competitive analysis of ${targetName || slug} (${targetUrl}).`
    : `Competitive analysis of ${targetName || slug}.`;

  // Count [GAP] markers across the rendered draft set (excluding the
  // source-attribution log which is metadata, not a gap).
  const gapBodies = sectionsCfg.sections
    .filter((s) => s.id !== "source_attribution_log")
    .map((s) => buildSectionBody(s, draftsResolved[s.id], defaults))
    .join("\n");
  const gapCount = (gapBodies.match(/\[GAP\s+—\s+[^\]]+\]/g) || []).length;

  const mdOut = renderMd({
    sectionsCfg,
    drafts: draftsResolved,
    defaults,
    vars: {
      title,
      slug,
      generated_at: generatedAt,
      mode,
      tagline,
      target_name: targetName,
      target_url: targetUrl,
      resolved_via: resolvedVia,
      gap_count: gapCount,
    },
  });
  const htmlOut = renderHtml({
    sectionsCfg,
    drafts: draftsResolved,
    defaults,
    vars: {
      title,
      slug,
      generated_at: generatedAt,
      mode,
      tagline,
      target_name: targetName,
      target_url: targetUrl,
      gap_count: gapCount,
    },
  });

  const mdPath = path.join(outDir, `${slug}.clone.md`);
  const htmlPath = path.join(outDir, `${slug}.clone.html`);
  fs.writeFileSync(mdPath, mdOut, "utf8");
  fs.writeFileSync(htmlPath, htmlOut, "utf8");

  // DOCX (R-7, AC-11.2)
  const docxResult = writeDocx({ outDir, slug, mdPath, pandocInfo });
  if (docxResult.status === "skipped_pandoc_missing") {
    process.stdout.write(pandocInstallHint() + "\n");
  }

  // Paths registration (R-8, AC-12.x)
  const pathsReg = registerPaths(slug, outDirRel, { firstEmit });

  // clone_emitted (TR-7)
  const files = [
    { path: outDirRel + "/" + path.basename(mdPath), bytes: fs.statSync(mdPath).size },
    { path: outDirRel + "/" + path.basename(htmlPath), bytes: fs.statSync(htmlPath).size },
  ];
  if (docxResult.status === "ok") {
    files.push({
      path: outDirRel + "/" + path.basename(docxResult.path),
      bytes: fs.statSync(docxResult.path).size,
    });
  }
  emitEvent(
    "clone_emitted",
    {
      slug,
      output_dir: outDirRel,
      files,
      pandoc_used: docxResult.status === "ok",
      paths_registered: pathsReg.pending_main_thread
        ? []
        : Object.entries(pathsReg.registered)
            .filter(([, v]) => v)
            .map(([k]) => `paths.${k}`),
      gap_count: gapCount,
      duration_ms_total: Date.now() - t0,
    },
    { runId },
  );

  return { mdPath, htmlPath, docxResult, pathsReg, gapCount, outDirRel };
}

// ── Main (CLI entrypoint) ────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText() + "\n");
    process.exit(0);
  }

  // At least one of name/url/video required.
  if (!args.name && !args.url && !args.video) {
    die(2, "at least one of --name, --url, --video is required");
  }

  // Validate inputs.
  const name = validateName(args.name);
  const urlObj = args.url ? validateUrl(args.url, "--url") : null;
  const videoObj = args.video ? validateUrl(args.video, "--video") : null;

  // Slug derivation + validation.
  const slug = deriveSlug({ slug: args.slug, name, urlObj });
  validateSlug(slug, args.slug);

  // Output dir resolution.
  const outDir = resolveOutputDir(args, slug);
  const outDirRel = toForwardSlash(
    path.relative(PROJECT, outDir) || path.join(DEFAULT_OUTPUT_BASE, slug),
  );

  // Probes.
  const pandocInfo = probePandoc();
  const ytDlpInfo = videoObj ? probeYtDlp() : { present: false, path: null };

  // --probe short-circuit (used by the skill driver to gate on env).
  if (args.probe) {
    process.stdout.write(
      JSON.stringify(
        {
          slug,
          target_name: name,
          target_url: urlObj ? urlObj.href : null,
          target_video: videoObj ? videoObj.href : null,
          output_dir: outDirRel,
          max_review_sources: args.maxReviewSources,
          mode: args.strict ? "strict" : "permissive",
          no_cache: args.noCache,
          pandoc_present: pandocInfo.present,
          pandoc_path: pandocInfo.path,
          yt_dlp_present: ytDlpInfo.present,
          yt_dlp_path: ytDlpInfo.path,
          template_dir: toForwardSlash(path.relative(PROJECT, TEMPLATE_DIR)),
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(0);
  }

  // C-10 fallback notice if --video given but yt-dlp missing.
  if (videoObj && !ytDlpInfo.present) {
    process.stdout.write(ytDlpFallbackNotice() + "\n");
  }

  // Determine first-emit (was paths.clones absent before this run?).
  let firstEmit = true;
  try {
    const raw = fs.readFileSync(PATHS_JSON, "utf8");
    const json = JSON.parse(raw);
    if (
      Object.prototype.hasOwnProperty.call(json, "clones") &&
      Object.prototype.hasOwnProperty.call(json, "clonesCurrent")
    ) {
      firstEmit = false;
    }
  } catch {
    /* treat as first emit if unreadable */
  }

  const runId = newRunId();
  const t0 = Date.now();
  const mode = args.strict ? "strict" : "permissive";

  // C-1 start banner.
  const targetLabel = name || (urlObj && urlObj.hostname) || (videoObj && videoObj.hostname) || slug;
  process.stdout.write(
    startBanner({
      target: targetLabel,
      slug,
      outputDirRel: outDirRel,
      mode,
      maxReviewSources: args.maxReviewSources,
    }) + "\n",
  );

  // clone_started (TR-1) — record SHAPE of inputs, not values.
  emitEvent(
    "clone_started",
    {
      slug,
      mode,
      inputs: {
        name: Boolean(args.name),
        url: Boolean(args.url),
        video: Boolean(args.video),
      },
      max_review_sources: args.maxReviewSources,
      cache_enabled: !args.noCache,
      first_emit: firstEmit,
    },
    { runId },
  );

  // ── Draft assembly: this CLI does NOT make network calls.
  // ── The skill driver (Claude harness) is the only path that:
  // ──   1. Runs WebSearch for product identification (S-2, TR-2)
  // ──   2. Runs WebFetch on the resolved URL + one-level discovery (S-3, TR-3)
  // ──   3. Runs WebSearch + WebFetch for review sources (S-4, TR-4)
  // ──   4. Runs the LLM extraction passes (S-6..S-10, TR-6)
  // ──   5. Runs the post-extraction presence check (R-6, TR-5)
  // ── It then either calls back into runEmit() programmatically, or hands
  // ── this CLI a pre-built --draft-file JSON.
  let drafts = {};
  let sourceRecords = [];
  let resolvedVia = urlObj ? "direct_input" : "unknown";
  let resolvedUrl = urlObj ? urlObj.href : null;

  if (args.draftFile) {
    const abs = path.isAbsolute(args.draftFile)
      ? args.draftFile
      : path.resolve(PROJECT, args.draftFile);
    if (!fs.existsSync(abs)) die(2, `--draft-file not found: ${args.draftFile}`);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      die(2, `--draft-file is not valid JSON: ${e.message}`);
    }
    drafts = payload.drafts || {};
    sourceRecords = Array.isArray(payload.source_records)
      ? payload.source_records
      : [];
    if (payload.target) {
      if (payload.target.name) resolvedUrl = resolvedUrl || null;
      if (payload.target.resolved_url) resolvedUrl = payload.target.resolved_url;
      if (payload.target.resolved_via) resolvedVia = payload.target.resolved_via;
    }
  } else {
    // No draft file supplied. Behave like bootstrap: the CLI is a tool the
    // skill driver invokes, so direct invocation prints guidance and emits
    // a fully-empty deliverable (all [GAP] markers) so the operator can SEE
    // the file shape. This is the AC-14.3 path when sourceRecords stays
    // empty AND the operator passed no draftFile.
    process.stdout.write(
      [
        "",
        "no --draft-file supplied; emitting empty scaffold so you can preview the",
        "section shape. The /portfolio:clone skill body normally orchestrates",
        "WebFetch + WebSearch + LLM extraction and hands the drafts back via",
        "--draft-file. For a smoke run, this scaffold is enough.",
        "",
      ].join("\n"),
    );
  }

  // product_identified (TR-2) — fires regardless of resolution path so the
  // event log is consistent.
  emitEvent(
    "product_identified",
    {
      slug,
      resolved_url: resolvedUrl,
      resolved_via: resolvedVia,
      confidence: resolvedVia === "direct_input" ? 1 : null,
    },
    { runId },
  );

  // urls_discovered (TR-3) — caller should have populated source_records
  // with product fetches. If empty in permissive mode, we still emit the
  // event (zero kept) so the event-shape contract holds.
  const productRecords = sourceRecords.filter((r) => r.source_class === "product");
  emitEvent(
    "urls_discovered",
    {
      slug,
      seed_url: resolvedUrl,
      discovered_count: productRecords.length,
      kept_count: productRecords.filter((r) => r.status === "ok").length,
      urls: productRecords.map((r) => r.url),
      categories: productRecords.reduce((acc, r) => {
        const cat = categorizeDiscoveredUrl(r.url);
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
    },
    { runId },
  );

  // source_fetched / source_failed — one per record. (TR-4)
  for (const r of sourceRecords) {
    if (r.status === "ok") {
      emitEvent(
        "source_fetched",
        {
          slug,
          url: r.url,
          source_class: r.source_class,
          http_status: r.http_status,
          bytes: r.bytes,
          duration_ms: r.duration_ms || null,
          retrieved_at: r.retrieved_at,
        },
        { runId },
      );
    } else {
      emitEvent(
        "source_failed",
        {
          slug,
          url: r.url,
          source_class: r.source_class,
          failure_reason: r.failure_reason || "unknown",
          attempt: r.attempts || 1,
        },
        { runId },
      );
    }
  }

  // ── Hard fail: zero-source corpus (AC-14.3) ──
  // If we have NO successful fetches AND no drafts were supplied, abort
  // with exit 3 regardless of --strict. Permissive cannot rescue an empty
  // input set. But: if the operator is just smoke-running the scaffold
  // (no draftFile AND no sourceRecords), we let them get the scaffold.
  const successfulRecords = sourceRecords.filter((r) => r.status === "ok");
  const allFailed = sourceRecords.length > 0 && successfulRecords.length === 0;
  if (allFailed) {
    process.stderr.write(
      "product:clone: every source fetch failed — cannot extract anything. Re-run with different --url or check connectivity.\n",
    );
    process.exit(3);
  }

  // ── Strict-mode partial failure (AC-14.2) ──
  const anyFailed = sourceRecords.some((r) => r.status !== "ok");
  if (args.strict && anyFailed) {
    process.stderr.write(
      `product:clone: --strict mode aborting on first source failure (failures: ${sourceRecords.filter((r) => r.status !== "ok").length}). No deliverable written.\n`,
    );
    process.exit(5);
  }

  // ── Emit ──
  const target = {
    name: name || (urlObj ? urlObj.hostname.replace(/^www\./, "") : slug),
    url: resolvedUrl || "",
    resolved_via: resolvedVia,
  };

  const emit = runEmit({
    slug,
    outDir,
    pandocInfo,
    mode,
    target,
    drafts,
    sourceRecords,
    runId,
    firstEmit,
    t0,
  });

  // C-8 + C-12 completion summary.
  const docxLine =
    emit.docxResult.status === "ok"
      ? `  ${toForwardSlash(path.relative(PROJECT, emit.docxResult.path))}           (pandoc)`
      : emit.docxResult.status === "skipped_pandoc_missing"
        ? `  ${outDirRel}/${slug}.clone.docx           (skipped — pandoc not on PATH)`
        : `  ${outDirRel}/${slug}.clone.docx           (${emit.docxResult.status})`;
  const summary = [
    "",
    "emitted:",
    `  ${outDirRel}/${slug}.clone.md`,
    `  ${outDirRel}/${slug}.clone.html`,
    docxLine,
    "",
  ];
  if (emit.pathsReg.pending_main_thread) {
    summary.push(
      "paths registration: pending — main thread will add paths.clones / paths.clonesCurrent after parallel sprint build completes.",
    );
  } else {
    const newKeys = Object.entries(emit.pathsReg.registered)
      .filter(([, v]) => v)
      .map(([k]) => `paths.${k}`);
    if (newKeys.length) {
      summary.push(
        firstEmit
          ? `paths registered: ${newKeys.join(", ")} (_docs/clones/, ${outDirRel}/)`
          : `paths.clonesCurrent updated → ${outDirRel}/`,
      );
    } else {
      summary.push(`paths registered: (no-op — already current)`);
    }
  }
  summary.push("");
  if (anyFailed) {
    summary.push(
      `note: ${sourceRecords.filter((r) => r.status !== "ok").length} source(s) failed; deliverable includes [GAP] markers. Run with --strict to abort instead.`,
    );
  }
  summary.push(
    "next: /portfolio:bootstrap --from-clone " + slug + "   or   /sprint:plan \"clone " + (target.name || slug) + "\"",
    "",
  );
  process.stdout.write(summary.join("\n"));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    // Unhandled errors → exit 1 (not in the documented set, but better than
    // crashing through with an opaque trace). Re-throw under DEBUG.
    if (process.env.DEBUG_CLONE) throw e;
    process.stderr.write(`product:clone: unexpected error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  // CLI helpers
  parseArgs,
  helpText,
  startBanner,
  // Validation
  validateName,
  validateUrl,
  isBlockedIpLiteral,
  normalizeSlug,
  deriveSlug,
  validateSlug: (s, r) => {
    try {
      validateSlug(s, r);
      return true;
    } catch {
      return false;
    }
  },
  resolveOutputDir,
  // Pipeline pieces
  cachePathsFor,
  cacheKeyFor,
  cacheDirFor,
  readCacheIfFresh,
  writeCache,
  filterDiscoveredUrls,
  categorizeDiscoveredUrl,
  priorityScore,
  REVIEW_HOSTS,
  PRODUCT_DISCOVERY_HARD_CAP,
  MAX_REVIEW_SOURCES_RANGE,
  // Render
  htmlEscape,
  markdownToBasicHtml,
  loadSectionsConfig,
  loadSectionDefaults,
  renderSourceAttributionLog,
  buildSectionBody,
  renderMd,
  renderHtml,
  // Emit
  runEmit,
  registerPaths,
  emitEvent,
  gapMarker,
  probePandoc,
  probeYtDlp,
  pandocInstallHint,
  ytDlpFallbackNotice,
  // Constants
  SLUG_RE,
  SECTION_ORDER,
  EXTRACTION_PASS_SECTIONS,
  DEFAULT_OUTPUT_BASE,
};
