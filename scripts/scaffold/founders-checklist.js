#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CHECKLIST_SCHEMA = "mc/founders-checklist/v1";
const MARKER_OPEN = "<!-- mc:founders-checklist v1 -->";
const MARKER_CLOSE = "<!-- /mc:founders-checklist -->";

const CORE_ITEMS = [
  {
    id: "provider.accounts",
    dim: "product",
    source: "core",
    label: "Create production developer and provider accounts for the declared stack",
  },
  {
    id: "domain.dns",
    dim: "deployment",
    source: "core",
    label: "Confirm domain ownership and DNS access",
  },
  {
    id: "legal.entity",
    dim: "monetization",
    source: "core",
    label: "Confirm legal entity, tax profile, and payout owner",
  },
  {
    id: "legal.privacy_terms",
    dim: "privacy",
    source: "core",
    label: "Publish privacy policy and terms",
  },
  {
    id: "store.listings",
    dim: "funnel",
    source: "core",
    label: "Prepare store, marketplace, or public launch listing assets",
  },
  {
    id: "production.env",
    dim: "deployment",
    source: "core",
    label: "Create production environment variables with live-mode values",
  },
];

const CONDITIONAL_ITEMS = [
  {
    layer: "payments",
    match: /stripe/i,
    unless: /\biap\b|storekit|play billing|platform billing|platform-billing/i,
    items: [
      {
        id: "payments.stripe.identity",
        dim: "monetization",
        label: "Verify Stripe identity and live-mode payouts",
      },
      {
        id: "payments.stripe.webhook",
        dim: "security",
        label: "Create Stripe live webhook endpoint and signing secret",
      },
    ],
  },
  {
    layer: "payments",
    match: /\biap\b|storekit|play billing|platform billing|platform-billing/i,
    items: [
      {
        id: "payments.mobile.classification",
        dim: "monetization",
        label: "Classify mobile monetization as in-app digital vs physical or outside-app purchase",
      },
      {
        id: "payments.apple.iap",
        dim: "monetization",
        label: "Create Apple In-App Purchase or StoreKit products for iOS digital goods",
      },
      {
        id: "payments.google.play_billing",
        dim: "monetization",
        label: "Create Google Play Billing products for Android digital goods",
      },
      {
        id: "payments.mobile.server_verification",
        dim: "security",
        label: "Verify App Store and Play purchase state server-side before granting entitlements",
      },
    ],
  },
  {
    layer: "payments",
    match: /paddle/i,
    items: [
      {
        id: "payments.paddle.account",
        dim: "monetization",
        label: "Verify Paddle seller account and live checkout",
      },
    ],
  },
  {
    layer: "auth",
    match: /clerk/i,
    items: [
      {
        id: "auth.clerk.production",
        dim: "security",
        label: "Create Clerk production instance and allowed domains",
      },
    ],
  },
  {
    layer: "auth",
    match: /supabase/i,
    items: [
      {
        id: "auth.supabase.production",
        dim: "security",
        label: "Configure Supabase Auth production URLs and email templates",
      },
    ],
  },
  {
    layer: "database",
    match: /supabase/i,
    items: [
      {
        id: "database.supabase.project",
        dim: "technical",
        label: "Create Supabase production project and review RLS policies",
      },
    ],
  },
  {
    layer: "hosting",
    match: /vercel/i,
    items: [
      {
        id: "hosting.vercel.project",
        dim: "deployment",
        label: "Link Vercel production project, domain, and environment variables",
      },
    ],
  },
  {
    layer: "analytics",
    match: /posthog/i,
    items: [
      {
        id: "analytics.posthog.project",
        dim: "analytics",
        label: "Create PostHog project and copy production analytics keys",
      },
    ],
  },
];

function stackValues(declaredStack) {
  if (!declaredStack) return {};
  if (declaredStack.values) return declaredStack.values || {};
  return declaredStack;
}

function stackSource(declaredStack) {
  return declaredStack && declaredStack.source
    ? declaredStack.source
    : "_requirements/00-canonical/DATA_AND_ACCOUNTS.md";
}

function isResolved(value) {
  const s = String(value || "").trim();
  return Boolean(s && !/\*needs input:|\{\{/i.test(s));
}

function selectedConditionalItems(declaredStack) {
  const values = stackValues(declaredStack);
  const items = [];
  for (const rule of CONDITIONAL_ITEMS) {
    const value = values[rule.layer];
    if (!isResolved(value) || !rule.match.test(String(value))) continue;
    if (rule.unless && rule.unless.test(String(value))) continue;
    for (const item of rule.items) {
      items.push({
        ...item,
        source: `declared-stack:${rule.layer}=${String(value).replace(/\s+/g, "_")}`,
      });
    }
  }
  return items;
}

function stackSummary(declaredStack) {
  const values = stackValues(declaredStack);
  const entries = Object.entries(values).filter(([, value]) => isResolved(value));
  return entries.length
    ? entries.map(([key, value]) => `${key}=${value}`).join(", ")
    : "no resolved declared stack found";
}

function renderItem(item, checked = false) {
  return `- [${checked ? "x" : " "}] id=${item.id} dim=${item.dim} source=${item.source} ${item.label}`;
}

function renderFoundersChecklist(opts = {}) {
  const declaredStack = opts.declaredStack || null;
  const conditional = selectedConditionalItems(declaredStack);
  const stackItems = conditional.length
    ? conditional
    : [
        {
          id: "stack.declared.complete",
          dim: "product",
          source: "missing-stack",
          label: "Complete the declared Tech Stack block before launch",
        },
      ];

  return [
    MARKER_OPEN,
    `schema: ${CHECKLIST_SCHEMA}`,
    `declared_stack_source: ${stackSource(declaredStack)}`,
    `declared_stack: ${stackSummary(declaredStack)}`,
    "",
    "## Human-only launch gates",
    "",
    ...CORE_ITEMS.map((item) => renderItem(item)),
    "",
    "## Stack-conditional launch gates",
    "",
    ...stackItems.map((item) => renderItem(item)),
    MARKER_CLOSE,
    "",
  ].join("\n");
}

function parseFoundersChecklist(markdown) {
  const text = String(markdown || "");
  const items = [];
  const errors = [];
  const lineRe = /^-\s+\[([ xX])\]\s+id=([a-z0-9_.-]+)\s+dim=([a-z_]+)\s+source=([^\s]+)\s+(.+)$/;
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    items.push({
      checked: m[1].toLowerCase() === "x",
      id: m[2],
      dim: m[3],
      source: m[4],
      label: m[5].trim(),
    });
  }
  if (!text.includes(MARKER_OPEN) || !text.includes(MARKER_CLOSE)) {
    errors.push("FOUNDERS_CHECKLIST.md missing mc checklist markers");
  }
  if (!text.includes(CHECKLIST_SCHEMA)) {
    errors.push(`FOUNDERS_CHECKLIST.md missing schema ${CHECKLIST_SCHEMA}`);
  }
  if (!items.length) errors.push("FOUNDERS_CHECKLIST.md has no machine-readable checklist items");

  return {
    ok: errors.length === 0,
    schema: CHECKLIST_SCHEMA,
    items,
    total: items.length,
    completed: items.filter((item) => item.checked).length,
    open: items.filter((item) => !item.checked),
    errors,
  };
}

function readFoundersChecklist(repoRoot, rel = "FOUNDERS_CHECKLIST.md") {
  const root = repoRoot || process.cwd();
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    return {
      present: false,
      source: rel,
      ok: false,
      items: [],
      total: 0,
      completed: 0,
      open: [],
      errors: [`FOUNDERS_CHECKLIST.md not found at ${rel}`],
    };
  }
  try {
    return {
      present: true,
      source: rel,
      ...parseFoundersChecklist(fs.readFileSync(abs, "utf8")),
    };
  } catch (e) {
    return {
      present: true,
      source: rel,
      ok: false,
      items: [],
      total: 0,
      completed: 0,
      open: [],
      errors: [`could not read FOUNDERS_CHECKLIST.md: ${e.message}`],
    };
  }
}

module.exports = {
  CHECKLIST_SCHEMA,
  MARKER_OPEN,
  MARKER_CLOSE,
  CORE_ITEMS,
  CONDITIONAL_ITEMS,
  renderFoundersChecklist,
  parseFoundersChecklist,
  readFoundersChecklist,
  selectedConditionalItems,
};
