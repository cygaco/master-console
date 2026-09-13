#!/usr/bin/env node
"use strict";

// Fixture-driven tests for the launch-readiness report producer (S-PF-09a / R-1 keystone).
// Drives buildReadinessReport() directly with injected fixtures (no real product needed),
// plus one pass against the REAL _guides/registry.json to prove deep-links never dangle (R-5).

const path = require("path");
const {
  READINESS_SCHEMA,
  loadGuideFiles,
  buildReadinessReport,
} = require("./readiness-report");
const { parseFoundersChecklist } = require("./founders-checklist");

let passes = 0;
let failures = 0;
function ok(name, condition, detail) {
  if (condition) { passes++; console.log(`  ok  ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const REPO_ROOT = path.join(__dirname, "..", "..");
const GEN_AT = "2026-06-14T00:00:00.000Z"; // fixed stamp → determinism

// Fixture guide set (decoupled from the real registry for the unit cases).
const GUIDE_FILES = new Set([
  "PAYMENTS_GUIDE.md", "DEV_SETUP_GUIDE.md", "DEPLOYMENT_INFRA_GUIDE.md",
  "LEGAL_GUIDE.md", "PRIVACY_GDPR_GUIDE.md", "APP_STORE_GUIDE.md",
  "SECURITY_GUIDE.md", "ANALYTICS_TELEMETRY_GUIDE.md",
]);

function mkItem(id, dim, checked = false, source = "core", label) {
  return { checked, id, dim, source, label: label || id };
}
function mkChecklist(items, source = "FOUNDERS_CHECKLIST.md") {
  return {
    present: true, source, ok: true, schema: "mc/founders-checklist/v1",
    items, total: items.length, completed: items.filter((i) => i.checked).length,
    open: items.filter((i) => !i.checked), errors: [],
  };
}

// ── AC-1: schema + item count + valid owner_class + summary ──────────────────────
console.log("AC-1 — schema, item count, owner_class, summary:");
{
  const checklist = mkChecklist([
    mkItem("provider.accounts", "product"),
    mkItem("domain.dns", "deployment", true),
    mkItem("legal.privacy_terms", "privacy"),
  ]);
  const gates = [{ id: "stripe-live", requires: "test-mode verified + operator approval", blocked: true }];
  const r = buildReadinessReport(REPO_ROOT, { checklist, gates, guideFiles: GUIDE_FILES, generated_at: GEN_AT, product_id: "fixture-app" });
  ok("schema is mc/readiness/v1", r.schema === READINESS_SCHEMA, r.schema);
  ok("item count = checklist items + gates", r.items.length === 4, `got ${r.items.length}`);
  ok("every owner_class is valid", r.items.every((i) => ["owner-action", "sprint-work", "waiver"].includes(i.owner_class)));
  ok("summary.total matches", r.summary.total === 4, `got ${r.summary.total}`);
  ok("summary.completed = 1 (domain.dns checked)", r.summary.completed === 1, `got ${r.summary.completed}`);
  ok("summary.blocked = 1 (stripe gate)", r.summary.blocked === 1, `got ${r.summary.blocked}`);
  ok("summary.owner_action = 3 (checklist) / waiver = 1 (gate)", r.summary.owner_action === 3 && r.summary.waiver === 1);
  ok("composite = round(1/4*100) = 25", r.composite === 25, `got ${r.composite}`);
  ok("product_id from opts", r.product_id === "fixture-app");
}

// ── AC-2: Stripe item → owner-action + lead_time + guide deep-link ───────────────
console.log("\nAC-2 — Stripe-declared payments item:");
{
  const checklist = mkChecklist([
    mkItem("payments.stripe.identity", "monetization", false, "conditional", "Verify Stripe identity"),
  ]);
  const r = buildReadinessReport(REPO_ROOT, { checklist, guideFiles: GUIDE_FILES, generated_at: GEN_AT });
  const it = r.items.find((i) => i.id === "payments.stripe.identity");
  ok("present", !!it);
  ok("owner_class = owner-action", it && it.owner_class === "owner-action");
  ok("lead_time populated (~2d)", it && it.lead_time && it.lead_time.days === 2, JSON.stringify(it && it.lead_time));
  ok("deep_link.kind = guide → PAYMENTS_GUIDE.md", it && it.deep_link.kind === "guide" && it.deep_link.ref === "PAYMENTS_GUIDE.md", JSON.stringify(it && it.deep_link));
}

// ── AC-3a: a blocked gate surfaces status:blocked + non-null blocker ─────────────
console.log("\nAC-3a — blocked gate:");
{
  const checklist = mkChecklist([mkItem("production.env", "deployment")]);
  const gates = [{ id: "prod-db-migration", dim: "deployment", requires: "verified backup + dry-run + approval", blocked: true }];
  const r = buildReadinessReport(REPO_ROOT, { checklist, gates, guideFiles: GUIDE_FILES, generated_at: GEN_AT });
  const g = r.items.find((i) => i.id === "prod-db-migration");
  ok("gate status = blocked", g && g.status === "blocked", g && g.status);
  ok("gate blocker is non-null (= requires)", g && g.blocker === "verified backup + dry-run + approval");
  ok("gate owner_class = waiver", g && g.owner_class === "waiver");
}

// ── AC-3b: FALSE-GREEN GUARD — no checklist item is silently dropped ─────────────
console.log("\nAC-3b — false-green guard (no silent drop):");
{
  const checklistItems = [
    mkItem("provider.accounts", "product"),
    mkItem("domain.dns", "deployment"),
    mkItem("legal.entity", "monetization"),
    mkItem("legal.privacy_terms", "privacy"),
    mkItem("store.listings", "funnel"),
    mkItem("production.env", "deployment"),
  ];
  const r = buildReadinessReport(REPO_ROOT, { checklist: mkChecklist(checklistItems), guideFiles: GUIDE_FILES, generated_at: GEN_AT });
  const reportIds = new Set(r.items.map((i) => i.id));
  const missing = checklistItems.map((c) => c.id).filter((id) => !reportIds.has(id));
  // The producer MUST carry every checklist item into the report — a dropped/mis-joined item
  // is the false-green class (a panel that looks complete while hiding unmet owner-action work).
  ok("every checklist item appears in the report (no silent drop)", missing.length === 0, `dropped: ${missing.join(", ")}`);
  ok("all 6 checklist items map to owner-action", r.items.filter((i) => i.owner_class === "owner-action").length === 6);
}

// ── R-5: REAL registry — every guide deep-link resolves to an existing file ──────
console.log("\nR-5 — no dangling deep-links (against the real _guides/registry.json):");
{
  const realGuideFiles = loadGuideFiles(REPO_ROOT);
  ok("real registry loaded (>0 guides)", realGuideFiles.size > 0, `size ${realGuideFiles.size}`);
  const checklist = mkChecklist([
    mkItem("provider.accounts", "product"),
    mkItem("domain.dns", "deployment"),
    mkItem("legal.entity", "monetization"),
    mkItem("legal.privacy_terms", "privacy"),
    mkItem("store.listings", "funnel"),
    mkItem("production.env", "deployment"),
    mkItem("payments.stripe.identity", "monetization", false, "conditional"),
  ]);
  const r = buildReadinessReport(REPO_ROOT, { checklist, guideFiles: realGuideFiles, generated_at: GEN_AT });
  const dangling = r.items.filter((i) => i.deep_link.kind === "guide" && !realGuideFiles.has(i.deep_link.ref));
  ok("zero dangling guide deep-links", dangling.length === 0, `dangling: ${JSON.stringify(dangling.map((i) => i.deep_link.ref))}`);
  const withGuide = r.items.filter((i) => i.deep_link.kind === "guide").length;
  ok("at least some items resolve to a real guide", withGuide > 0, `got ${withGuide}`);
}

// ── Determinism: same inputs + same stamp → byte-identical JSON ──────────────────
console.log("\nDeterminism — stable --json:");
{
  const checklist = mkChecklist([mkItem("provider.accounts", "product"), mkItem("domain.dns", "deployment", true)]);
  const a = JSON.stringify(buildReadinessReport(REPO_ROOT, { checklist, guideFiles: GUIDE_FILES, generated_at: GEN_AT }));
  const b = JSON.stringify(buildReadinessReport(REPO_ROOT, { checklist, guideFiles: GUIDE_FILES, generated_at: GEN_AT }));
  ok("two builds with identical inputs are byte-identical", a === b);
}

// ── Graceful empty: no checklist present → empty report, no throw ────────────────
console.log("\nGraceful empty — missing checklist:");
{
  const r = buildReadinessReport(REPO_ROOT, {
    checklist: { present: false, source: "FOUNDERS_CHECKLIST.md", ok: false, items: [], total: 0, completed: 0, open: [], errors: ["not found"] },
    guideFiles: GUIDE_FILES, generated_at: GEN_AT,
  });
  ok("empty items", r.items.length === 0);
  ok("composite 0 (no divide-by-zero)", r.composite === 0);
  ok("checklist_errors surfaced", Array.isArray(r.checklist_errors) && r.checklist_errors.length > 0);
}

// ── Parse-round-trip realism: a rendered checklist line parses + joins ───────────
console.log("\nParse realism — real FOUNDERS_CHECKLIST markdown line:");
{
  const md = [
    "<!-- mc:founders-checklist v1 -->",
    "schema: mc/founders-checklist/v1",
    "- [x] id=provider.accounts dim=product source=core Create production accounts",
    "- [ ] id=legal.privacy_terms dim=privacy source=core Publish privacy policy and terms",
    "<!-- /mc:founders-checklist -->",
  ].join("\n");
  const parsed = parseFoundersChecklist(md);
  const checklist = { present: true, source: "FOUNDERS_CHECKLIST.md", ...parsed };
  const r = buildReadinessReport(REPO_ROOT, { checklist, guideFiles: GUIDE_FILES, generated_at: GEN_AT });
  ok("parsed 2 items into the report", r.items.length === 2, `got ${r.items.length}`);
  ok("checked item → status done", r.items.find((i) => i.id === "provider.accounts").status === "done");
  ok("unchecked item → status open", r.items.find((i) => i.id === "legal.privacy_terms").status === "open");
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
