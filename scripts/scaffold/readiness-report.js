#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readFoundersChecklist } = require("./founders-checklist");

const READINESS_SCHEMA = "mc/readiness/v1";

const LEAD_TIME_MAP = Object.freeze({
  "provider.accounts": { days: 2, note: "Provider/developer account approval can take 1-3 business days (Apple ~2d; Google review queue)." },
  "domain.dns": { days: 1, note: "DNS propagation up to ~24h after records are set." },
  "legal.privacy_terms": { days: 2, note: "Legal doc review/publish; counsel review adds a queue." },
  "store.listings": { days: 7, note: "App store review queues (Apple ~1-3d; Google Play review variable)." },
  "payments.stripe.identity": { days: 2, note: "Stripe identity verification + live-mode payout enablement." },
  "payments.apple.iap": { days: 2, note: "Apple processes paid-apps agreements + IAP review ~2 business days." },
  "payments.google.play_billing": { days: 14, note: "Google Play billing + 14-day closed-testing / 12-tester requirement before production." },
});

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
  }
  return set;
}

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

function buildReadinessReport(repoRoot, opts = {}) {
  const checklist = opts.checklist || readFoundersChecklist(repoRoot);
  const guideFiles = opts.guideFiles || loadGuideFiles(repoRoot);
  const gates = Array.isArray(opts.gates) ? opts.gates : [];

  const items = [];

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

if (require.main === module) {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx !== -1 && argv[rootIdx + 1] ? argv[rootIdx + 1] : process.cwd();
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
