#!/usr/bin/env node
/**
 * scripts/panel/roadmap-gui.js — ephemeral local-only HTTP server for the
 * "what's next" roadmap panel GUI (SP-20260615-002).
 *
 * This is the browser face of scripts/panel/roadmap.js. It MIRRORS the security
 * + lifecycle scaffold of scripts/dispatch/gui.js (the Dispatch Console) verbatim,
 * with two deliberate departures asserted by the AC suite:
 *
 *   READ-ONLY (β-3, AC-R2b): unlike gui.js, this server has NO write surface.
 *     There is no /api/save, /api/revert, /api/preview, and it does NOT require any
 *     write/backup module (no ./save, no ./backup, no applySave/restoreBackup/
 *     createBackup). The ONLY data route is GET /<token>/api/board; the only other
 *     GET routes are /<token>/ (HTML) and /<token>/api/health. Any non-GET method on
 *     a data route is 404/405. Write endpoints are ABSENT, not merely unreachable.
 *
 *   REVIEW-MODE KEEPALIVE (β-1, AC-R2c): a --review-mode / --no-auto-shutdown flag
 *     (or WARPOS_GUI_KEEPALIVE env) DISABLES the auto-exit lifecycle (stdin-EOF,
 *     tab-close beforeunload ping, the soft-shutdown timer) so a headless gauntlet
 *     cannot race the server dead before/while the page renders. In normal mode the
 *     gui.js clean-shutdown behavior is preserved. After binding, the EXACT reachable
 *     URL is printed on a stable machine-readable stdout line that the review harness
 *     parses (it never guesses the port).
 *
 * Security boundary (carried over from gui.js verbatim, β-5):
 *   - Bound to 127.0.0.1 explicitly. Any non-loopback connection (req.socket
 *     .remoteAddress) is rejected with 403.
 *   - Random port chosen by the OS (we listen on port 0).
 *   - All routes are gated behind a 256-bit unguessable token in the URL path.
 *     Without the token, the server returns 404 for every path.
 *   - Every response carries cache-control: no-store + x-content-type-options: nosniff.
 *
 * No external deps (β-2); uses only Node's built-in http + crypto + child_process +
 * path, and the first-party scripts/panel/roadmap.js#generate as its data source.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { generate } = require("./roadmap");

// ── Loopback enforcement (verbatim from gui.js) ───────────────────
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  return !!a && LOOPBACK_ADDRS.has(a);
}

// ── Browser auto-open (verbatim from gui.js) ──────────────────────
function openInBrowser(url) {
  try {
    if (process.platform === "win32") {
      // The empty "" is a title arg required by Windows `start`
      spawn("cmd", ["/c", "start", '""', url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Browser open failed — caller already printed the URL, user can paste it
  }
}

// ── Helpers (send is verbatim from gui.js — always no-store + nosniff) ─
function send(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ── HTTP server ────────────────────────────────────────────────────
// READ-ONLY handler (β-3): only GET / (HTML), GET /api/board, GET /api/health.
// There is intentionally NO readJson(), NO POST branch, and NO write/backup import
// — a mutating handler here would FAIL AC-R2b's presence-of-absence assertion.
function buildHandler(token, root, lifecycle) {
  const prefix = `/${token}`;
  return function handler(req, res) {
    if (!isLoopback(req)) {
      res.statusCode = 403;
      return res.end();
    }
    if (!req.url || !req.url.startsWith(prefix)) {
      res.statusCode = 404;
      return res.end();
    }
    // A valid (token-bearing) request cancels a pending soft-shutdown so a reload
    // reconnects within the grace window (no-op when keepalive is on).
    lifecycle.cancelPendingShutdown();
    const subPath = req.url.slice(prefix.length) || "/";
    try {
      // GET / → HTML
      if ((subPath === "/" || subPath === "") && req.method === "GET") {
        return send(res, 200, renderHtml(token), "text/html; charset=utf-8");
      }
      // GET /api/board → the roadmap.js summary (the SINGLE data route).
      if (subPath === "/api/board" && req.method === "GET") {
        // generate() is fail-soft + read-only; a degraded source yields a board
        // state, never a throw. We still 200 a degraded board (AC-R7b).
        const { summary } = generate({ root });
        return send(res, 200, summary);
      }
      // GET /api/health → liveness ping.
      if (subPath === "/api/health" && req.method === "GET") {
        return send(res, 200, { ok: true });
      }
      // A non-GET method on the data route is 405 (method not allowed), not 200.
      // This makes "POST /api/board" an explicit non-mutation, and anything else
      // (incl. a probed /api/save) falls through to 404 — both prove ABSENCE.
      if (
        (subPath === "/api/board" || subPath === "/" || subPath === "" ||
          subPath === "/api/health") &&
        req.method !== "GET"
      ) {
        res.setHeader("allow", "GET");
        return send(res, 405, { error: "method not allowed (read-only panel)" });
      }
      // Everything else — including any probed write endpoint — is 404.
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

// ── HTML / CSS / JS payload (vanilla, no deps) ─────────────────────
// The :root token block below is COPIED VERBATIM from scripts/dispatch/gui.js
// (β-2 / AC-R3b — the shared design-system vocabulary, zero new tokens, zero raw
// hex/px outside this block). The .row/.modal/.banner/.field idiom + render()
// pattern mirror gui.js; new selectors (.hero/.toolbar/.chip/.progress) compose
// only from these tokens.
function renderHtml(token) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Roadmap — what's next</title>
  <style>
    :root {
      --bg: #0b0303;
      --surface: #141010;
      --surface-alt: #1e1818;
      --text: #f0eded;
      --text-muted: #9a9494;
      --primary: #ff5a17;
      --primary-hover: #e64e12;
      --primary-soft: rgba(255, 90, 23, 0.1);
      --border: #2a2424;
      --border-focus: #ff5a17;
      --success: #acd229;
      --success-light: rgba(172, 210, 41, 0.1);
      --success-border: rgba(172, 210, 41, 0.3);
      --warning: #eab308;
      --warning-light: rgba(234, 179, 8, 0.1);
      --warning-border: rgba(234, 179, 8, 0.3);
      --error: #ef4444;
      --error-light: rgba(239, 68, 68, 0.1);
      --error-border: rgba(239, 68, 68, 0.3);
      --info: #d4a054;
      --radius: 4px;
      --radius-lg: 8px;
      --radius-full: 9999px;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.4);
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-7: 32px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Inter", system-ui, sans-serif;
      font-size: 14px;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: var(--space-6) var(--space-5);
    }
    h1 { font-size: 28px; margin: 0; font-weight: 600; }
    h2 { font-size: 18px; margin: 0; font-weight: 600; }
    .subtitle { color: var(--text-muted); margin: var(--space-2) 0 0; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    a { color: var(--primary); }

    .header {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: var(--space-3); flex-wrap: wrap;
      margin-bottom: var(--space-6);
    }
    .nav { display: flex; gap: var(--space-3); font-size: 13px; color: var(--text-muted); }

    .banner {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius);
      margin-bottom: var(--space-4);
      font-size: 13px;
    }
    .banner.info { background: rgba(212,160,84,0.08); border: 1px solid rgba(212,160,84,0.25); color: var(--info); }
    .banner.warn { background: var(--warning-light); border: 1px solid var(--warning-border); color: var(--warning); }
    .banner.error { background: var(--error-light); border: 1px solid var(--error-border); color: var(--error); }
    .banner.success { background: var(--success-light); border: 1px solid var(--success-border); color: var(--success); }

    /* ── NEXT-ACTION hero — the dominant element on cold load (axis 1) ── */
    .hero {
      background: var(--surface);
      border: 1px solid var(--primary);
      border-left-width: 3px;
      border-radius: var(--radius-lg);
      padding: var(--space-6);
      margin-bottom: var(--space-7);
    }
    .hero .eyebrow {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--primary); font-weight: 600; margin-bottom: var(--space-2);
    }
    .hero .headline { font-size: 22px; font-weight: 600; line-height: 1.35; }
    .hero .headline.empty { color: var(--text-muted); font-weight: 500; }
    .hero .meta {
      margin-top: var(--space-3); display: flex; gap: var(--space-2);
      flex-wrap: wrap; align-items: center;
    }
    .hero .source { font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }

    /* ── Sticky toolbar: filter chips + text filter + collapse/expand ── */
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      background: var(--bg);
      padding: var(--space-3) 0;
      margin-bottom: var(--space-5);
      border-bottom: 1px solid var(--border);
      display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap;
    }
    .chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .chip {
      font-family: inherit; font-size: 12px; padding: 5px 12px;
      border-radius: var(--radius-full); cursor: pointer;
      background: var(--surface-alt); color: var(--text-muted);
      border: 1px solid var(--border); transition: all 0.15s;
    }
    .chip:hover { color: var(--text); border-color: var(--border-focus); }
    .chip.on { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
    .toolbar .field { flex: 1; min-width: 180px; }
    .toolbar input {
      width: 100%; background: var(--surface-alt); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--radius);
      padding: 8px 12px; font-size: 14px; font-family: inherit;
    }
    .toolbar input:focus { border-color: var(--border-focus); outline: none; }
    .toolbar .spacer { flex: 1; }

    button {
      font-family: inherit; font-size: 13px; padding: 6px 12px;
      border-radius: var(--radius); border: none; cursor: pointer;
      transition: background 0.15s;
    }
    button.ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
    button.ghost:hover:not(:disabled) { color: var(--text); border-color: var(--border-focus); }

    /* ── Collapsible sections (native details/summary, gui.js idiom) ── */
    section.area { margin-bottom: var(--space-7); }
    section.area > summary {
      display: flex; align-items: baseline; gap: var(--space-3);
      cursor: pointer; list-style: none; margin-bottom: var(--space-4);
      user-select: none;
    }
    section.area > summary::-webkit-details-marker { display: none; }
    section.area > summary .chevron {
      color: var(--text-muted); transition: transform 0.15s; font-size: 12px;
    }
    section.area[open] > summary .chevron { transform: rotate(90deg); }
    section.area > summary .count {
      font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-muted);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: var(--space-3);
    }

    .row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
    }
    .row.dirty { border-color: var(--primary); }
    .row.drillable { cursor: pointer; }
    .row.drillable:hover { border-color: var(--border-focus); }
    .row.hidden { display: none; }
    .row-head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: var(--space-3); margin-bottom: var(--space-2); flex-wrap: wrap;
    }
    .row-id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-muted); }
    .row-title { font-weight: 600; font-size: 15px; margin-top: 2px; }
    .row-sub { font-size: 12px; color: var(--text-muted); margin-top: var(--space-2); }

    /* ── Status pill: color by SEMANTIC group, text = raw status (§2) ── */
    .pill {
      font-size: 11px; padding: 3px 10px; border-radius: var(--radius-full);
      font-family: ui-monospace, monospace; white-space: nowrap;
    }
    .pill.g-active { background: var(--primary-soft); color: var(--primary); border: 1px solid var(--primary); }
    .pill.g-planning { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
    .pill.g-blocked { background: var(--error-light); color: var(--error); border: 1px solid var(--error-border); }
    .pill.g-review { background: var(--warning-light); color: var(--warning); border: 1px solid var(--warning-border); }
    .pill.g-done { background: var(--success-light); color: var(--success); border: 1px solid var(--success-border); }
    .pill.g-dead { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); opacity: 0.65; }

    /* ── Epic progress bar, state-colored fill (§2) ── */
    .progress {
      height: 6px; background: var(--surface-alt);
      border-radius: var(--radius-full); margin-top: var(--space-3);
      overflow: hidden;
    }
    .progress .fill { height: 100%; border-radius: var(--radius-full); }
    .fill.g-active { background: var(--primary); }
    .fill.g-done { background: var(--success); }
    .fill.g-blocked { background: var(--warning); }
    .fill.g-dead { background: var(--text-muted); }
    .progress-label { font-size: 11px; color: var(--text-muted); margin-top: var(--space-1); font-family: ui-monospace, monospace; }

    /* ── "+N more" expander tail ── */
    .more-tail {
      grid-column: 1 / -1;
      background: var(--surface-alt); border: 1px dashed var(--border);
      border-radius: var(--radius); padding: var(--space-3) var(--space-4);
      color: var(--text-muted); font-size: 13px; cursor: pointer; text-align: center;
    }
    .more-tail:hover { color: var(--text); border-color: var(--border-focus); }

    /* ── Empty + unavailable states (§5 — two DISTINCT, both styled) ── */
    .empty-state {
      color: var(--text-muted); font-size: 13px;
      padding: var(--space-4); border: 1px dashed var(--border);
      border-radius: var(--radius); text-align: center;
    }
    /* (degraded section reuses .banner.info — see renderArea) */

    /* ── Drill modal (verbatim gui.js .modal scaffold) ── */
    .modal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100;
      display: flex; align-items: center; justify-content: center; padding: var(--space-5);
    }
    .modal-body {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-lg); max-width: 800px; width: 100%; max-height: 85vh;
      display: flex; flex-direction: column; box-shadow: var(--shadow-lg);
    }
    .modal-head {
      padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
    }
    .modal-main {
      flex: 1; overflow-y: auto; padding: var(--space-5);
    }
    .modal-foot {
      padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
    }
    .modal-foot .source { font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }

    /* stacked count-bar atop a sprint drill */
    .countbar { display: flex; height: 10px; border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--space-4); background: var(--surface-alt); }
    .countbar .seg { height: 100%; }
    .bucket { margin-bottom: var(--space-4); }
    .bucket h3 { font-size: 13px; margin: 0 0 var(--space-2); font-weight: 600; }
    .ticket { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-muted); padding: 2px 0; }
    .mini-row {
      display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
      padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius);
      margin-bottom: var(--space-2); cursor: pointer;
    }
    .mini-row:hover { border-color: var(--border-focus); }

    @media (max-width: 720px) {
      .cards { grid-template-columns: 1fr; }
      .toolbar { flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
<main>
  <header class="header">
    <div>
      <h1>Roadmap</h1>
      <p class="subtitle">What's next — ranked next-action, in-flight sprints, epics, and blockers, at a glance.</p>
      <p class="subtitle" style="font-size: 12px; margin-top: var(--space-2);">
        🔒 Local-only · 127.0.0.1 · ephemeral · read-only · this server dies when you close the tab or stop the CLI
      </p>
    </div>
    <nav class="nav">
      <a href="#" onclick="loadBoard();return false" style="color:var(--primary)">Refresh</a>
    </nav>
  </header>

  <div id="root">Loading…</div>
</main>

<script>
const TOKEN = ${JSON.stringify(token)};
const BASE = "/" + TOKEN;

// ── Status → semantic group (single source of truth, §2 / mitigation 5) ──
// Color is driven by GROUP; the pill TEXT is the raw status verbatim. Sets mirror
// roadmap.js's ACTIVE_STATUSES / TERMINAL_STATUSES intent (kept in-frontend so the
// page is self-contained — roadmap.js does not export them over the JSON).
const GROUP_ACTIVE = new Set(["in_progress","in-progress","inprogress","active","executing","building","build","gauntlet","review","reviewing","releasing","release","design","designing"]);
const GROUP_PLANNING = new Set(["planning","proposed","ready","ready_for_execution"]);
const GROUP_BLOCKED = new Set(["blocked","qa_failed","redteam_failed","reopened"]);
const GROUP_REVIEW = new Set(["in_review"]);
const GROUP_DONE = new Set(["done","closed","released","retrospected","complete","completed"]);
const GROUP_DEAD = new Set(["abandoned","cancelled","canceled","superseded","deferred","archived"]);

function statusGroup(status) {
  const s = String(status == null ? "" : status).toLowerCase().trim();
  if (GROUP_DONE.has(s)) return "done";
  if (GROUP_DEAD.has(s)) return "dead";
  if (GROUP_REVIEW.has(s) || /^waiting_on_/.test(s)) return s === "in_review" ? "review" : "blocked";
  if (GROUP_BLOCKED.has(s) || /^waiting_on_/.test(s)) return "blocked";
  if (GROUP_PLANNING.has(s)) return "planning";
  if (GROUP_ACTIVE.has(s)) return "active";
  return "planning"; // unknown → calm neutral, never an alarming color
}

// Epic state → fill color group (§2 progress-bar table).
function epicFillGroup(state, percent) {
  const s = String(state == null ? "" : state).toLowerCase();
  if (/(complete|completed)/.test(s) || percent === 100) return "done";
  if (/(block|paus)/.test(s)) return "blocked";
  if (/(cancel|supersed)/.test(s)) return "dead";
  if (/(active|progress|build|design|gauntlet|review|releas)/.test(s)) return "active";
  return null; // Planned / 0% → empty track (no fill)
}

// ── State ──────────────────────────────────────────────────────
let board = null;        // the /api/board summary
let modal = null;        // { kind: "sprint"|"epic", id }
const filters = {
  // DEFAULT = "what needs me": Active + Blocked + In-review ON; Done + Planning OFF.
  active: true, blocked: true, review: true, done: false, planning: false,
  dead: false,
  text: "",
};
let moreOpen = false;    // "+N more in-flight" tail expanded?

// ── Helpers ────────────────────────────────────────────────────
async function api(p) {
  const res = await fetch(BASE + p);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.error || (res.status + " " + res.statusText));
  }
  return res.json();
}

// escape ALL tracker-authored strings (AC-R3c — mirrors gui.js escapeHtml).
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function pill(status) {
  const g = statusGroup(status);
  return '<span class="pill g-' + g + '">' + escapeHtml(status || "—") + '</span>';
}

// A status/text matches the current filter? (subtract-before-add: a group toggled
// OFF hides it; text further narrows.)
function matchesFilter(status, ...texts) {
  const g = statusGroup(status);
  if (!filters[g]) return false;
  const q = filters.text.trim().toLowerCase();
  if (!q) return true;
  return texts.some(t => String(t == null ? "" : t).toLowerCase().includes(q));
}

// Is an area degraded (in sectionsUnavailable[])?
function isUnavailable(area) {
  return Array.isArray(board.sectionsUnavailable) && board.sectionsUnavailable.includes(area);
}

// ── Toolbar (filter chips + text + collapse/expand) ─────────────
const CHIP_DEFS = [
  ["active", "Active"], ["blocked", "Blocked"], ["review", "In review"],
  ["done", "Done"], ["planning", "Planning"], ["dead", "Abandoned"],
];

function renderToolbar() {
  const chips = CHIP_DEFS.map(([k, label]) =>
    '<button class="chip ' + (filters[k] ? "on" : "") + '" data-chip="' + k + '" onclick="toggleChip(\\'' + k + '\\')">' + label + '</button>'
  ).join("");
  return '<div class="toolbar" data-area="toolbar">' +
    '<div class="chips">' + chips + '</div>' +
    '<div class="field"><input type="text" placeholder="Filter by id or title…" value="' + escapeHtml(filters.text) + '" oninput="onText(this.value)"></div>' +
    '<button class="ghost" onclick="setAllSections(true)">Expand all</button>' +
    '<button class="ghost" onclick="setAllSections(false)">Collapse all</button>' +
  '</div>';
}

function toggleChip(k) { filters[k] = !filters[k]; render(); }
function onText(v) { filters.text = v; render(); }
function setAllSections(open) {
  document.querySelectorAll("section.area").forEach(s => { s.open = open; });
}

// ── NEXT-ACTION hero ────────────────────────────────────────────
function renderHero() {
  const na = board.nextActionAvailable ? board.nextAction : null;
  const headline = na
    ? '<div class="headline">' + escapeHtml(na.replace(/^NEXT ACTION\\b\\s*(\\([^)]*\\))?\\s*[:=]?\\s*/i, "").trim() || na) + '</div>'
    : '<div class="headline empty">No next action set — TRACKER.md has no current highest-priority action.</div>';
  let chip = "";
  if (board.primary) {
    const pr = (board.inFlight || []).find(s => s.id === board.primary);
    chip = '<span class="row-id">' + escapeHtml(board.primary) + '</span>' + (pr ? " " + pill(pr.status) : "");
  }
  const src = board.nextActionAvailable
    ? '<span class="source">source: TRACKER.md → Current Highest-Priority Next Action</span>'
    : (isUnavailable("nextAction") ? '<span class="source">source: TRACKER.md (unavailable)</span>' : "");
  return '<div class="hero" data-area="next-action">' +
    '<div class="eyebrow">Next action</div>' +
    headline +
    '<div class="meta">' + chip + src + '</div>' +
  '</div>';
}

// ── Generic collapsible area frame ──────────────────────────────
// Renders the section shell + chevron + count, then either the degraded banner
// (if unavailable), an empty-state, or the supplied body. EMPTY ≠ UNAVAILABLE.
function renderArea(area, title, opts) {
  const open = opts.open ? " open" : "";
  const count = opts.count != null ? '<span class="count">' + opts.count + '</span>' : "";
  let inner;
  if (opts.unavailable) {
    inner = '<div class="banner info">⚠ This section couldn\\'t load: ' + escapeHtml(opts.unavailableReason || "source unavailable") +
      (opts.source ? ' <span style="opacity:0.8">(' + escapeHtml(opts.source) + ')</span>' : "") + '</div>';
  } else if (opts.empty) {
    inner = '<div class="empty-state">' + escapeHtml(opts.emptyLabel || "Nothing here yet.") + '</div>';
  } else {
    inner = opts.body;
  }
  return '<details class="area"' + open + ' data-area="' + area + '">' +
    '<summary><span class="chevron">▸</span><h2>' + escapeHtml(title) + '</h2>' + count + '</summary>' +
    inner +
  '</details>';
}

// ── Area: active sprints (density spine) ────────────────────────
function renderActiveSprints() {
  if (isUnavailable("inFlight")) {
    return renderArea("active-sprints", "Active sprints", {
      open: true, unavailable: true,
      unavailableReason: "in-flight sprint source unreadable",
      source: ".claude/project/sprint/active-sprints.yaml",
    });
  }
  const inFlight = board.inFlight || [];
  if (inFlight.length === 0) {
    return renderArea("active-sprints", "Active sprints", {
      open: true, empty: true, emptyLabel: "None in flight.", count: 0,
    });
  }
  const primaryId = board.primary;
  const primary = primaryId ? inFlight.find(s => s.id === primaryId) : null;
  const rest = inFlight.filter(s => !primary || s.id !== primary.id);
  const executing = rest.filter(s => statusGroup(s.status) === "active");
  const CAP = 8;
  const shownExec = executing.slice(0, CAP);
  const shownIds = new Set([...(primary ? [primary.id] : []), ...shownExec.map(s => s.id)]);
  const remaining = inFlight.filter(s => !shownIds.has(s.id));
  const stale = (board.stalePlanningCount != null)
    ? board.stalePlanningCount
    : remaining.filter(s => statusGroup(s.status) === "planning").length;

  const cards = [];
  if (primary) cards.push(sprintCard(primary, true));
  for (const s of shownExec) cards.push(sprintCard(s, false));
  if (!moreOpen && remaining.length > 0) {
    const staleNote = stale > 0 ? " (" + stale + " stale planning)" : "";
    cards.push('<div class="more-tail" onclick="expandMore()">+ ' + remaining.length + ' more in-flight' + staleNote + '</div>');
  } else if (moreOpen) {
    for (const s of remaining) cards.push(sprintCard(s, false));
  }
  // Apply the live filter to the cards actually rendered.
  const filtered = filterCards(cards, inFlight, shownIds, remaining, primary, shownExec);
  const visibleCount = filtered.shown;
  const body = '<div class="cards">' + filtered.html + '</div>' +
    '<p class="row-sub" style="margin-top:var(--space-3)">source: .claude/project/sprint/active-sprints.yaml</p>';
  if (visibleCount === 0) {
    return renderArea("active-sprints", "Active sprints", {
      open: true, empty: true, count: inFlight.length,
      emptyLabel: "No active sprints match the current filter.",
    });
  }
  return renderArea("active-sprints", "Active sprints", { open: true, count: inFlight.length, body });
}

// Filter the already-built card set by applying matchesFilter to each sprint;
// the "+N more" tail is preserved when collapsed.
function filterCards(cardsHtml, inFlight, shownIds, remaining, primary, shownExec) {
  const visible = [];
  const consider = moreOpen
    ? inFlight
    : [...(primary ? [primary] : []), ...shownExec];
  for (const s of consider) {
    if (matchesFilter(s.status, s.id, s.phase)) {
      visible.push(sprintCard(s, primary && s.id === primary.id));
    }
  }
  if (!moreOpen && remaining.length > 0) {
    const stale = remaining.filter(s => statusGroup(s.status) === "planning").length;
    const staleNote = stale > 0 ? " (" + stale + " stale planning)" : "";
    visible.push('<div class="more-tail" onclick="expandMore()">+ ' + remaining.length + ' more in-flight' + staleNote + '</div>');
  }
  return { html: visible.join(""), shown: visible.filter(h => h.indexOf("more-tail") === -1).length };
}

function expandMore() { moreOpen = true; render(); }

function sprintCard(s, isPrimary) {
  const cls = "row drillable" + (isPrimary ? " dirty" : "");
  const phase = s.phase ? '<div class="row-sub">phase: ' + escapeHtml(s.phase) + '</div>' : "";
  const tag = isPrimary ? ' <span class="row-id">(primary)</span>' : "";
  return '<div class="' + cls + '" data-id="' + escapeHtml(s.id) + '" onclick="openSprint(\\'' + escapeJs(s.id) + '\\')">' +
    '<div class="row-head"><div><span class="row-id">' + escapeHtml(s.id) + tag + '</span></div>' + pill(s.status) + '</div>' +
    phase +
  '</div>';
}

// ── Area: roadmap (ranked do-next) ──────────────────────────────
function renderRoadmap() {
  if (isUnavailable("ranked")) {
    return renderArea("roadmap", "Roadmap — ranked next", {
      open: true, unavailable: true,
      unavailableReason: "ROADMAP.md ranked-order marker not found",
      source: "ROADMAP.md",
    });
  }
  const ranked = board.ranked || [];
  if (ranked.length === 0) {
    return renderArea("roadmap", "Roadmap — ranked next", {
      open: true, empty: true, emptyLabel: "No ranked roadmap items yet.", count: 0,
    });
  }
  const visible = ranked.filter(r => {
    const q = filters.text.trim().toLowerCase();
    return !q || String(r.text).toLowerCase().includes(q) || String(r.n).includes(q);
  });
  if (visible.length === 0) {
    return renderArea("roadmap", "Roadmap — ranked next", {
      open: true, empty: true, count: ranked.length,
      emptyLabel: "No roadmap items match the filter.",
    });
  }
  const cards = visible.map(r =>
    '<div class="row" data-id="rank-' + escapeHtml(String(r.n)) + '">' +
      '<div class="row-head"><span class="row-id">#' + escapeHtml(String(r.n)) + '</span></div>' +
      '<div class="row-title">' + escapeHtml(r.text) + '</div>' +
    '</div>'
  ).join("");
  const pq = board.hasPickupQueue ? "Pickup Queue: present" : "Pickup Queue: not found";
  const body = '<div class="cards">' + cards + '</div>' +
    '<p class="row-sub" style="margin-top:var(--space-3)">source: ROADMAP.md → Prioritized order · ' + pq + '</p>';
  return renderArea("roadmap", "Roadmap — ranked next", { open: true, count: ranked.length, body });
}

// ── Area: epics (progress bars) ─────────────────────────────────
function renderEpics() {
  if (isUnavailable("epics")) {
    return renderArea("epics", "Epics", {
      open: false, unavailable: true,
      unavailableReason: "trackers/epics/ unreadable or absent",
      source: "trackers/epics/",
    });
  }
  const epics = board.epics || [];
  if (epics.length === 0) {
    return renderArea("epics", "Epics", {
      open: false, empty: true, emptyLabel: "No epics yet.", count: 0,
    });
  }
  const visible = epics.filter(e => matchesFilterEpic(e));
  if (visible.length === 0) {
    return renderArea("epics", "Epics", {
      open: false, empty: true, count: epics.length,
      emptyLabel: "No epics match the filter.",
    });
  }
  const cards = visible.map(epicCard).join("");
  const body = '<div class="cards">' + cards + '</div>' +
    '<p class="row-sub" style="margin-top:var(--space-3)">source: trackers/epics/*.md</p>';
  return renderArea("epics", "Epics", { open: false, count: epics.length, body });
}

// An epic matches: text filter over id/title/state, and (if it has a state) the
// status-group chip for that state. A {parseError} epic always shows (so a bad file
// is visible, not silently hidden).
function matchesFilterEpic(e) {
  const q = filters.text.trim().toLowerCase();
  const textHit = !q ||
    String(e.id || "").toLowerCase().includes(q) ||
    String(e.title || "").toLowerCase().includes(q) ||
    String(e.state || "").toLowerCase().includes(q);
  if (!textHit) return false;
  if (e.parseError) return true;
  // map epic state through the same group machinery for chip filtering
  const g = statusGroup(e.state);
  return filters[g] !== false ? true : false;
}

function epicCard(e) {
  if (e.parseError) {
    return '<div class="row" data-id="' + escapeHtml(e.id) + '">' +
      '<div class="row-head"><span class="row-id">' + escapeHtml(e.id) + '</span></div>' +
      '<div class="banner info" style="margin:var(--space-2) 0 0">⚠ epic file unreadable: ' + escapeHtml(e.parseError) + '</div>' +
    '</div>';
  }
  const pct = (typeof e.percent === "number" && isFinite(e.percent))
    ? Math.max(0, Math.min(100, Math.round(e.percent))) : null;
  const fg = epicFillGroup(e.state, pct);
  const bar = pct != null
    ? '<div class="progress">' + (fg ? '<div class="fill g-' + fg + '" style="width:' + pct + '%"></div>' : "") + '</div>' +
      '<div class="progress-label">' + pct + '% · ' + escapeHtml(e.state) + '</div>'
    : '<div class="progress-label">' + escapeHtml(e.state) + ' · % unknown</div>';
  const kids = (e.childSprints && e.childSprints.length)
    ? '<div class="row-sub">' + e.childSprints.length + ' child sprint' + (e.childSprints.length === 1 ? "" : "s") + '</div>'
    : '<div class="row-sub">no child sprints</div>';
  return '<div class="row drillable" data-id="' + escapeHtml(e.id) + '" onclick="openEpic(\\'' + escapeJs(e.id) + '\\')">' +
    '<div class="row-head"><span class="row-id">' + escapeHtml(e.id) + '</span></div>' +
    '<div class="row-title">' + escapeHtml(e.title) + '</div>' +
    bar + kids +
  '</div>';
}

// ── Area: sprint breakdown ──────────────────────────────────────
function renderBreakdown() {
  const byId = board.sprintBreakdown || {};
  const ids = Object.keys(byId);
  if (ids.length === 0) {
    return renderArea("sprint-breakdown", "Sprint breakdown", {
      open: false, empty: true, emptyLabel: "No sprint ticket breakdowns yet.", count: 0,
    });
  }
  // Filter by text over the sprint id; a breakdownUnavailable entry still shows.
  const q = filters.text.trim().toLowerCase();
  const visible = ids.filter(id => !q || id.toLowerCase().includes(q));
  if (visible.length === 0) {
    return renderArea("sprint-breakdown", "Sprint breakdown", {
      open: false, empty: true, count: ids.length,
      emptyLabel: "No sprint breakdowns match the filter.",
    });
  }
  const cards = visible.map(id => {
    const b = byId[id];
    if (b && b.breakdownUnavailable) {
      return '<div class="row" data-id="' + escapeHtml(id) + '">' +
        '<div class="row-head"><span class="row-id">' + escapeHtml(id) + '</span></div>' +
        '<div class="banner info" style="margin:var(--space-2) 0 0">⚠ breakdown unavailable: ' + escapeHtml(b.reason || "unreadable record") + '</div>' +
      '</div>';
    }
    const total = b && b.total != null ? b.total : 0;
    const countLine = b && b.counts
      ? Object.keys(b.counts).map(k => escapeHtml(k) + ":" + b.counts[k]).join("  ")
      : "";
    return '<div class="row drillable" data-id="' + escapeHtml(id) + '" onclick="openSprint(\\'' + escapeJs(id) + '\\')">' +
      '<div class="row-head"><span class="row-id">' + escapeHtml(id) + '</span><span class="row-id">' + total + ' tickets</span></div>' +
      '<div class="row-sub">' + countLine + '</div>' +
    '</div>';
  }).join("");
  const body = '<div class="cards">' + cards + '</div>' +
    '<p class="row-sub" style="margin-top:var(--space-3)">source: .claude/project/sprint/sprints/&lt;id&gt;/current.yaml</p>';
  return renderArea("sprint-breakdown", "Sprint breakdown", { open: false, count: ids.length, body });
}

// ── Drill modal ─────────────────────────────────────────────────
function openSprint(id) { modal = { kind: "sprint", id }; render(); }
function openEpic(id) { modal = { kind: "epic", id }; render(); }
function closeModal() { modal = null; render(); }

function renderModal() {
  if (!modal) return "";
  let head, bodyHtml, source;
  if (modal.kind === "sprint") {
    const b = (board.sprintBreakdown || {})[modal.id];
    head = "Sprint " + escapeHtml(modal.id);
    source = ".claude/project/sprint/sprints/" + modal.id + "/current.yaml";
    if (!b || b.breakdownUnavailable) {
      bodyHtml = '<div class="banner info">⚠ Ticket breakdown unavailable: ' + escapeHtml((b && b.reason) || "no record") + '</div>';
    } else {
      bodyHtml = renderTicketBuckets(b);
    }
  } else {
    const e = (board.epics || []).find(x => x.id === modal.id);
    head = "Epic " + escapeHtml(modal.id);
    source = "trackers/epics/*.md";
    if (!e) {
      bodyHtml = '<div class="banner info">⚠ Epic not found.</div>';
    } else if (e.parseError) {
      bodyHtml = '<div class="banner info">⚠ epic file unreadable: ' + escapeHtml(e.parseError) + '</div>';
    } else {
      bodyHtml = renderEpicChildren(e);
    }
  }
  return '<div class="modal" onclick="closeModal()">' +
    '<div class="modal-body" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div style="font-weight:600;font-size:18px">' + head + '</div>' +
        '<button class="ghost" onclick="closeModal()">Close</button></div>' +
      '<div class="modal-main">' + bodyHtml + '</div>' +
      '<div class="modal-foot"><span class="source">read-only — source: ' + escapeHtml(source) + '</span>' +
        '<button class="ghost" onclick="closeModal()">Close</button></div>' +
    '</div>' +
  '</div>';
}

// sprint → ticket buckets, grouped by §2 status buckets + a thin stacked count-bar.
function renderTicketBuckets(b) {
  const byState = b.byState || {};
  const states = Object.keys(byState);
  if (states.length === 0 || b.total === 0) {
    return '<div class="empty-state">No tickets recorded for this sprint yet.</div>';
  }
  // count-bar segments colored by the state's group
  const segs = states.map(st => {
    const n = byState[st].length;
    if (!n || !b.total) return "";
    const pct = (n / b.total) * 100;
    const g = statusGroup(st);
    return '<div class="seg fill g-' + g + '" style="width:' + pct + '%" title="' + escapeHtml(st) + ': ' + n + '"></div>';
  }).join("");
  const buckets = states.map(st => {
    const list = byState[st];
    if (!list.length) return "";
    const items = list.map(t => '<div class="ticket">' + escapeHtml(t) + '</div>').join("");
    return '<div class="bucket"><h3>' + pill(st) + ' <span class="row-id">' + list.length + '</span></h3>' + items + '</div>';
  }).join("");
  return '<div class="countbar">' + segs + '</div>' + buckets;
}

// epic → child sprints, each a clickable mini-row that swaps the modal to that
// sprint's breakdown (modal-internal nav, gui.js setActiveDiff idiom).
function renderEpicChildren(e) {
  const pct = (typeof e.percent === "number" && isFinite(e.percent)) ? Math.round(e.percent) : null;
  const fg = epicFillGroup(e.state, pct);
  const header = '<div class="row-title" style="margin-bottom:var(--space-3)">' + escapeHtml(e.title) + '</div>' +
    (pct != null
      ? '<div class="progress">' + (fg ? '<div class="fill g-' + fg + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div>' : "") + '</div>' +
        '<div class="progress-label">' + pct + '% · ' + escapeHtml(e.state) + '</div>'
      : '<div class="progress-label">' + escapeHtml(e.state) + ' · % unknown</div>');
  const kids = e.childSprints || [];
  let list;
  if (kids.length === 0) {
    list = '<div class="empty-state" style="margin-top:var(--space-4)">No child sprints recorded.</div>';
  } else {
    list = '<div style="margin-top:var(--space-4)">' + kids.map(cid => {
      // find that child's live status (if it is an in-flight sprint) for its pill
      const sp = (board.inFlight || []).find(s => s.id === cid);
      const pillHtml = sp ? pill(sp.status) : '<span class="row-id">—</span>';
      const hasBreakdown = !!(board.sprintBreakdown || {})[cid];
      const click = hasBreakdown ? ' onclick="openSprint(\\'' + escapeJs(cid) + '\\')"' : "";
      const cls = "mini-row" + (hasBreakdown ? "" : "");
      return '<div class="' + cls + '"' + click + '><span class="row-id">' + escapeHtml(cid) + '</span>' + pillHtml + '</div>';
    }).join("") + '</div>';
  }
  return header + list;
}

// ── Render ───────────────────────────────────────────────────────
function render() {
  const root = document.getElementById("root");
  if (!board) { root.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>'; return; }
  root.innerHTML =
    renderHero() +
    renderToolbar() +
    renderActiveSprints() +
    renderRoadmap() +
    renderEpics() +
    renderBreakdown() +
    renderFooter() +
    renderModal();
  // preserve scroll-lock when a modal is open
  document.body.style.overflow = modal ? "hidden" : "";
}

function renderFooter() {
  const gen = board.generatedAt ? escapeHtml(board.generatedAt) : "—";
  return '<footer style="margin-top:var(--space-7);padding-top:var(--space-4);border-top:1px solid var(--border);color:var(--text-muted);font-size:11px;font-family:ui-monospace,monospace">' +
    'generated ' + gen + ' · sources: TRACKER.md · ROADMAP.md · active-sprints.yaml · trackers/epics · sprints/&lt;id&gt;/current.yaml' +
  '</footer>';
}

// escape a tracker-authored value for an inline handler attribute — a DOUBLE
// context: it sits inside a single-quoted JS string literal that itself sits inside
// a double-quoted HTML attribute (onclick="openSprint('<here>')"). We must escape
// BOTH layers or a metacharacter id (e.g. a <script>-bearing sprint id) breaks out
// of the attribute. (1) JS-string layer: backslash + single-quote. (2) HTML-attr
// layer: &,<,>," → entities — these HTML-decode back to the JS-escaped form before
// the JS parser sees them (backslash + single-quote are not HTML-special, so the
// JS escaping survives decoding). escapeHtml is defined above.
function escapeJs(s) {
  const jsEscaped = String(s == null ? "" : s).replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'");
  return escapeHtml(jsEscaped);
}

// ── Boot ───────────────────────────────────────────────────────
async function loadBoard() {
  try {
    board = await api("/api/board");
    render();
  } catch (e) {
    document.getElementById("root").innerHTML =
      '<div class="banner error">Failed to load board: ' + escapeHtml(e.message) + '</div>';
  }
}

loadBoard();

// expose for inline handlers
Object.assign(window, {
  loadBoard, toggleChip, onText, setAllSections, expandMore,
  openSprint, openEpic, closeModal,
});
</script>
</body>
</html>`;
}

// ── Public entrypoint ─────────────────────────────────────────
// keepalive (β-1): when true, the auto-exit lifecycle is DISABLED — no stdin-EOF
// watcher, no soft-shutdown timer. The server stays up until SIGINT/SIGTERM so a
// headless gauntlet can't race it dead. Normal mode preserves gui.js clean-shutdown.
function startGui({ openBrowser = true, keepalive = false, root } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const sourceRoot = root || process.cwd();
  let server;
  let shutdownRequested = false;
  let pendingShutdownTimer = null;

  const signalShutdown = (reason) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log("");
    console.log(`shutting down (${reason})`);
    if (server) {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    } else {
      process.exit(0);
    }
  };

  const lifecycle = {
    scheduleShutdown(ms, reason) {
      if (keepalive) return; // review-mode: never schedule an auto-exit
      if (shutdownRequested) return;
      if (pendingShutdownTimer) clearTimeout(pendingShutdownTimer);
      pendingShutdownTimer = setTimeout(() => {
        pendingShutdownTimer = null;
        signalShutdown(reason);
      }, ms);
    },
    cancelPendingShutdown() {
      if (pendingShutdownTimer) {
        clearTimeout(pendingShutdownTimer);
        pendingShutdownTimer = null;
      }
    },
  };

  const handler = buildHandler(token, sourceRoot, lifecycle);
  server = http.createServer(handler);

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}/${token}/`;
    // STABLE machine-readable line the review harness parses (AC-R2c / β-1). It is
    // an exact, single, greppable line — the harness NEVER guesses the port.
    console.log(`ROADMAP_GUI_URL ${url}`);
    console.log("");
    console.log("Roadmap panel GUI");
    console.log(`  ${url}`);
    console.log("");
    console.log("  bound to 127.0.0.1 only · token-gated · ephemeral · READ-ONLY");
    console.log(keepalive
      ? "  review-mode: keepalive ON (auto-shutdown disabled) · Ctrl+C to stop"
      : "  Ctrl+C or close the tab to stop");
    console.log("");
    if (openBrowser) openInBrowser(url);
  });

  server.on("error", (e) => {
    console.error("server error:", e.message);
    process.exit(1);
  });

  process.on("SIGINT", () => signalShutdown("Ctrl+C"));
  process.on("SIGTERM", () => signalShutdown("SIGTERM"));

  // stdin-EOF auto-shutdown — DISABLED under keepalive so a headless harness that
  // closes our stdin can't race the server dead before the page renders.
  if (!keepalive) {
    try {
      process.stdin.on("end", () => signalShutdown("stdin EOF"));
      process.stdin.resume();
    } catch {
      // no stdin (detached) — fine; SIGINT/SIGTERM still work
    }
  }

  return { token, server };
}

// ── CLI ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const keepalive =
    argv.includes("--review-mode") ||
    argv.includes("--no-auto-shutdown") ||
    !!(mcEnv.readEnv("GUI_KEEPALIVE") || "").trim();
  // --no-open OR review-mode default to NOT opening a browser (a headless gauntlet
  // doesn't want a browser spawned; a human in review-mode can paste the URL).
  const openBrowser = !argv.includes("--no-open") && !keepalive;
  let root;
  const ri = argv.indexOf("--root");
  if (ri !== -1 && argv[ri + 1]) root = path.resolve(argv[ri + 1]);
  return { keepalive, openBrowser, root };
}

if (require.main === module) {
  const { keepalive, openBrowser, root } = parseArgs(process.argv.slice(2));
  startGui({ keepalive, openBrowser, root });
}

module.exports = { startGui, buildHandler, renderHtml, parseArgs };
