#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");

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
const PRODUCT_DISCOVERY_HARD_CAP = 8;
const MAX_REVIEW_SOURCES_RANGE = [1, 8];
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

function validateName(name) {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (!trimmed) die(2, "--name must be non-empty after trim");
  if (trimmed.length > MAX_NAME_LEN) {
    die(2, `--name length ${trimmed.length} exceeds max ${MAX_NAME_LEN}`);
  }
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
      `${flagName} uses disallowed scheme 'file://' (SSRF guard)`,
    );
  }
  if (scheme === "javascript" || scheme === "data" || scheme === "ftp") {
    die(
      2,
      `${flagName} uses disallowed scheme '${scheme}:' (only http/https)`,
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
      `${flagName} hostname '${host}' is an IP-literal / private / loopback / link-local address — blocked to prevent SSRF. Use a public DNS hostname.`,
    );
  }
  return parsed;
}

function isBlockedIpLiteral(host) {
  const lower = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  const m = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map((s) => Number(s));
  if (oct.some((n) => n > 255)) return true;
  const [a, b] = oct;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

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
  }
  try {
    const r = spawnSync("pandoc", ["--version"], {
      timeout: PANDOC_PROBE_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    });
    if (r.status === 0) return { present: true, path: "pandoc" };
  } catch (e) {
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
  }
  return { present: false, path: null };
}

function pandocInstallHint() {
  return "note: pandoc not on PATH — skipping DOCX output. Install pandoc to enable.";
}

function ytDlpFallbackNotice() {
  return "note: yt-dlp not on PATH — video transcript unavailable. Falling back to WebSearch on the video title.";
}

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
  const sortable = sameHost.map((u, idx) => ({ url: u, score: priorityScore(u), idx }));
  sortable.sort((a, b) => a.score - b.score || a.idx - b.idx);
  const kept = sortable.slice(0, cap).map((s) => s.url);
  const overflow = sortable.slice(cap).map((s) => s.url);
  for (const u of overflow) dropped.push({ url: u, reason: "over_cap" });
  return {
    kept,
    dropped,
    discoveredCount: sameHost.length + dropped.filter((d) => d.reason !== "over_cap" && d.reason !== "external_host" && d.reason !== "invalid_url").length + sameHost.length,
    sameHostCount: sameHost.length,
    categories: kept.reduce((acc, u) => {
      const cat = categorizeDiscoveredUrl(u);
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {}),
  };
}

function renderTemplate(tmpl, vars) {
  return tmpl.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToBasicHtml(md) {
  const blocks = String(md).split(/\n{2,}/);
  const out = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split(/\n/);
    if (lines.length >= 2 && /^\|/.test(lines[0]) && /^\|\s*[-:]/.test(lines[1])) {
      out.push(renderTableHtml(lines));
      continue;
    }
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
  let html = htmlEscape(s);
  html = html.replace(
    /\[GAP\s+—\s+[^\]]+\]/g,
    (m) => `<span class="gap-marker">${m}</span>`,
  );
  return html;
}

function loadSectionsConfig() {
  const file = path.join(TEMPLATE_DIR, "sections.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
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
      }
    }
  }
}

function newRunId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto
    .randomBytes(16)
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

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
      pending_registry_keys: true,
    };
  }

  const desiredClones = "_docs/clones";
  const desiredCurrent = toForwardSlash(outDirRel);

  const clonesPresent = Object.prototype.hasOwnProperty.call(json, "clones");
  const currentPresent = Object.prototype.hasOwnProperty.call(
    json,
    "clonesCurrent",
  );
  if (!clonesPresent || !currentPresent) {
    return {
      registered: { clones: false, clonesCurrent: false },
      error: null,
      pending_registry_keys: true,
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
    writePathsAtomic(json);
  }

  return {
    registered,
    error: null,
    pending_registry_keys: false,
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

  const docxResult = writeDocx({ outDir, slug, mdPath, pandocInfo });
  if (docxResult.status === "skipped_pandoc_missing") {
    process.stdout.write(pandocInstallHint() + "\n");
  }

  const pathsReg = registerPaths(slug, outDirRel, { firstEmit });

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
      paths_registered: pathsReg.pending_registry_keys
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText() + "\n");
    process.exit(0);
  }

  if (!args.name && !args.url && !args.video) {
    die(2, "at least one of --name, --url, --video is required");
  }

  const name = validateName(args.name);
  const urlObj = args.url ? validateUrl(args.url, "--url") : null;
  const videoObj = args.video ? validateUrl(args.video, "--video") : null;

  const slug = deriveSlug({ slug: args.slug, name, urlObj });
  validateSlug(slug, args.slug);

  const outDir = resolveOutputDir(args, slug);
  const outDirRel = toForwardSlash(
    path.relative(PROJECT, outDir) || path.join(DEFAULT_OUTPUT_BASE, slug),
  );

  const pandocInfo = probePandoc();
  const ytDlpInfo = videoObj ? probeYtDlp() : { present: false, path: null };

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

  if (videoObj && !ytDlpInfo.present) {
    process.stdout.write(ytDlpFallbackNotice() + "\n");
  }

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
  }

  const runId = newRunId();
  const t0 = Date.now();
  const mode = args.strict ? "strict" : "permissive";

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

  const successfulRecords = sourceRecords.filter((r) => r.status === "ok");
  const allFailed = sourceRecords.length > 0 && successfulRecords.length === 0;
  if (allFailed) {
    process.stderr.write(
      "product:clone: every source fetch failed — cannot extract anything. Re-run with different --url or check connectivity.\n",
    );
    process.exit(3);
  }

  const anyFailed = sourceRecords.some((r) => r.status !== "ok");
  if (args.strict && anyFailed) {
    process.stderr.write(
      `product:clone: --strict mode aborting on first source failure (failures: ${sourceRecords.filter((r) => r.status !== "ok").length}). No deliverable written.\n`,
    );
    process.exit(5);
  }

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
  if (emit.pathsReg.pending_registry_keys) {
    summary.push(
      "paths registration: pending — paths.clones / paths.clonesCurrent were not updated (the keys are missing from the paths registry, or the registry could not be read; this generator only updates keys that exist).",
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
    if (process.env.DEBUG_CLONE) throw e;
    process.stderr.write(`product:clone: unexpected error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  helpText,
  startBanner,
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
  htmlEscape,
  markdownToBasicHtml,
  loadSectionsConfig,
  loadSectionDefaults,
  renderSourceAttributionLog,
  buildSectionBody,
  renderMd,
  renderHtml,
  runEmit,
  registerPaths,
  emitEvent,
  gapMarker,
  probePandoc,
  probeYtDlp,
  pandocInstallHint,
  ytDlpFallbackNotice,
  SLUG_RE,
  SECTION_ORDER,
  EXTRACTION_PASS_SECTIONS,
  DEFAULT_OUTPUT_BASE,
};
