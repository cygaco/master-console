#!/usr/bin/env node
"use strict";

// ── Founders launch-readiness report — the shared readiness data model ──────────
//
// S-PF-09a / E-PRODUCT-FOUNDATION-001 W3 (R-1 keystone). The SINGLE structured object
// BOTH surfaces consume: the product-shipped founder panel (S-PF-09a) AND the operator
// cockpit board (S-PF-09b). One producer, two consumers — the operator's "one shared data
// layer, two views" decision (2026-06-13).
//
// It is a JOIN, never a re-derivation: it composes the per-product FOUNDERS_CHECKLIST
// (the human-only owner-action items, via scripts/scaffold/founders-checklist.js) with an
// optional set of approval/blocker gates (waiver/sprint-work items, injectable so the cockpit
// or a lastmile handoff can layer per-product gate state) plus two static maps
// (LEAD_TIME_MAP, the deep-link resolver). Deep-links resolve ONLY to guide files present in
// _guides/registry.json — a dangling link is impossible by construction (R-5).
//
// PURE + DETERMINISTIC: buildReadinessReport() takes no clock. `generated_at` is stamped by
// the caller (the CLI), so the same inputs always produce byte-identical output (AC-1 --json
// deterministic). Everything is injectable via opts for fixture-driven testing.
//
// Schema: mc/readiness/v1. The schema id stays in the machine layer — it is NEVER
// product-facing copy (brand boundary, R-6 — project_masterconsole_branding_boundary).

const fs = require("fs");
const path = require("path");
const { readFoundersChecklist } = require("./founders-checklist");

const READINESS_SCHEMA = "mc/readiness/v1";

// ── Static lead-time map (slow-clock human work) ────────────────────────────────
// Keyed by checklist/gate id. Seeded from project_dev_setup_guide_day_zero (Apple ~2d,
// Google Play 14d + 12-tester, DNS propagation, legal review queues). Founder-adjustable
// later (OQ-4); a static seed is correct for the MVP.
const LEAD_TIME_MAP = Object.freeze({
  "provider.accounts": { days: 2, note: "Provider/developer account approval can take 1-3 business days (Apple ~2d; Google review queue)." },
  "domain.dns": { days: 1, note: "DNS propagation up to ~24h after records are set." },
  "legal.privacy_terms": { days: 2, note: "Legal doc review/publish; counsel review adds a queue." },
  "store.listings": { days: 7, note: "App store review queues (Apple ~1-3d; Google Play review variable)." },
  "payments.stripe.identity": { days: 2, note: "Stripe identity verification + live-mode payout enablement." },
  "payments.apple.iap": { days: 2, note: "Apple processes paid-apps agreements + IAP review ~2 business days." },
  "payments.google.play_billing": { days: 14, note: "Google Play billing + 14-day closed-testing / 12-tester requirement before production." },
});

// ── Deep-link resolution: item -> a real guide file in _guides/registry.json ─────
// id-exact wins, then id-prefix, then dim. The resolved file MUST exist in the registry
// (passed in as `guideFiles`) or the link is { kind:"none" } — no dangling links (R-5).
const ID_GUIDE = Object.freeze({
  "provider.accounts": "DEV_SETUP_GUIDE.md",
  "domain.dns": "DEPLOYMENT_INFRA_GUIDE.md",
  "legal.entity": "LEGAL_GUIDE.md",
  "legal.privacy_terms": "PRIVACY_GDPR_GUIDE.md",
  "store.listings": "APP_STORE_GUIDE.md",
  "production.env": "DEPLOYMENT_INFRA_GUIDE.md",
});
const ID_PREFIX_GUIDE = Object.freeze([
  [/^payments\.stripe\./, "PAYMENTS_GUIDE.md"],
  [/^payments\.(apple|google)\./, "APP_STORE_GUIDE.md"],
  [/^payments\./, "PAYMENTS_GUIDE.md"],
]);
const DIM_GUIDE = Object.freeze({
  product: "DEV_SETUP_GUIDE.md",
  deployment: "DEPLOYMENT_INFRA_GUIDE.md",
  monetization: "PAYMENTS_GUIDE.md",
  privacy: "PRIVACY_GDPR_GUIDE.md",
  funnel: "APP_STORE_GUIDE.md",
  security: "SECURITY_GUIDE.md",
  analytics: "ANALYTICS_TELEMETRY_GUIDE.md",
});

/** Read the set of guide file basenames declared in _guides/registry.json. */
function loadGuideFiles(repoRoot) {
  const root = repoRoot || process.cwd();
  const abs = path.join(root, "_guides", "registry.json");
  const set = new Set();
  try {
    const reg = JSON.parse(fs.readFileSync(abs, "utf8"));
    for (const g of reg.guides || []) {
      const f = g.file || g.path;
      if (f) set.add(String(f).split(/[\\/]/).pop());
    }
  } catch {
    /* registry missing/unreadable → empty set → every link resolves to "none" (fail-safe, no dangling) */
  }
  return set;
}

/** Resolve a deep-link for an item; only emits kind:"guide" when the file exists in the registry. */
function resolveDeepLink(item, guideFiles) {
  let file = ID_GUIDE[item.id];
  if (!file) {
    for (const [re, f] of ID_PREFIX_GUIDE) {
      if (re.test(item.id || "")) { file = f; break; }
    }
  }
  if (!file) file = DIM_GUIDE[item.dim];
  if (file && guideFiles && guideFiles.has(file)) {
    return { kind: "guide", ref: file };
  }
  return { kind: "none", ref: null };
}

/**
 * Build the readiness report (mc/readiness/v1) for a product repo.
 *
 * @param {string} repoRoot         product repo root (CLI default: process.cwd()).
 * @param {object} [opts]
 *   opts.checklist     injected readFoundersChecklist() result (default: read from repoRoot).
 *   opts.gates         optional gate objects {id,label?,dim?,requires?|blocker?,blocked?,cleared?}
 *                      → waiver-class items (status blocked|open|done). Injected by the cockpit /
 *                      a lastmile handoff; default [] (checklist-only, the fresh-scaffold case).
 *   opts.guideFiles    injected Set of guide file basenames (default: loadGuideFiles(repoRoot)).
 *   opts.generated_at  ISO timestamp stamped by the caller (the pure fn takes no clock → determinism).
 *   opts.product_id    override (default: basename(repoRoot)).
 *   opts.handoff       source_refs.handoff path, when a lastmile handoff backed the gates.
 * @returns {ReadinessReport}
 */
function buildReadinessReport(repoRoot, opts = {}) {
  const checklist = opts.checklist || readFoundersChecklist(repoRoot);
  const guideFiles = opts.guideFiles || loadGuideFiles(repoRoot);
  const gates = Array.isArray(opts.gates) ? opts.gates : [];

  const items = [];

  // Checklist items → owner-action (the human-only slow-clock CORE + CONDITIONAL work).
  for (const ci of checklist.items || []) {
    items.push({
      id: ci.id,
      label: ci.label,
      dim: ci.dim,
      status: ci.checked ? "done" : "open",
      owner_class: "owner-action",
      lead_time: LEAD_TIME_MAP[ci.id] || null,
      blocker: null,
      deep_link: resolveDeepLink(ci, guideFiles),
      source: `checklist:${ci.source}`,
    });
  }

  // Optional gates → waiver-class (pending approval gates) or sprint-work when declared.
  for (const g of gates) {
    const ownerClass = g.owner_class === "sprint-work" ? "sprint-work" : "waiver";
    const status = g.cleared ? "done" : g.blocked ? "blocked" : "open";
    items.push({
      id: g.id,
      label: g.label || g.id,
      dim: g.dim || "deployment",
      status,
      owner_class: ownerClass,
      lead_time: LEAD_TIME_MAP[g.id] || null,
      blocker: status === "done" ? null : g.blocker || g.requires || "pending approval gate",
      deep_link: resolveDeepLink({ id: g.id, dim: g.dim || "deployment" }, guideFiles),
      source: `gate:${g.id}`,
    });
  }

  const summary = {
    total: items.length,
    completed: items.filter((i) => i.status === "done").length,
    open: items.filter((i) => i.status === "open").length,
    blocked: items.filter((i) => i.status === "blocked").length,
    owner_action: items.filter((i) => i.owner_class === "owner-action").length,
    sprint_work: items.filter((i) => i.owner_class === "sprint-work").length,
    waiver: items.filter((i) => i.owner_class === "waiver").length,
  };
  // Composite = % of items resolved (done). An honest checklist-completion proxy for the MVP;
  // the lastmile score.js composite can replace this when handoff state is wired (follow-up).
  const composite = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0;

  const report = {
    schema: READINESS_SCHEMA,
    product_id: opts.product_id || path.basename(repoRoot || process.cwd()),
    generated_at: opts.generated_at || null,
    composite,
    source_refs: {
      checklist: checklist.source || "FOUNDERS_CHECKLIST.md",
      handoff: opts.handoff || null,
    },
    items,
    summary,
  };
  if (checklist.errors && checklist.errors.length) report.checklist_errors = checklist.errors;
  return report;
}

module.exports = {
  READINESS_SCHEMA,
  LEAD_TIME_MAP,
  loadGuideFiles,
  resolveDeepLink,
  buildReadinessReport,
};

// ── CLI ─────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx !== -1 && argv[rootIdx + 1] ? argv[rootIdx + 1] : process.cwd();
  // The CLI is the ONLY place a clock enters — keeps buildReadinessReport() deterministic.
  const report = buildReadinessReport(root, { generated_at: new Date().toISOString() });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const s = report.summary;
    console.log(`Launch readiness for ${report.product_id}: ${report.composite}% (${s.completed}/${s.total} done, ${s.open} open, ${s.blocked} blocked)`);
    for (const it of report.items) {
      const flag = it.status === "done" ? "[x]" : it.status === "blocked" ? "[!]" : "[ ]";
      const lt = it.lead_time ? ` (~${it.lead_time.days}d)` : "";
      const link = it.deep_link.kind === "guide" ? ` → ${it.deep_link.ref}` : "";
      console.log(`  ${flag} ${it.id} [${it.owner_class}]${lt}${link}`);
    }
  }
  process.exit(0);
}
