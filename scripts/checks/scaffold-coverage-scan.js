#!/usr/bin/env node
"use strict";

/**
 * /scan:scaffold-coverage (S0.3) - fail-closed enforcer for the MC app
 * scaffold. It keeps the scaffold complete, coherent, and wired with the
 * day-zero telemetry seam required by S-PF-01.
 *
 *   node scripts/checks/scaffold-coverage-scan.js [--json]
 */

const fs = require("fs");
const path = require("path");
const {
  CHECKLIST_SCHEMA,
  parseFoundersChecklist,
  renderFoundersChecklist,
} = require("../scaffold/founders-checklist");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CANONICAL_EVENTS = [
  "signup",
  "onboarding_complete",
  "activation",
  "core_action",
  "retention_return",
  "checkout",
];

const CANONICAL_STAGES = [
  "intent",
  "executed",
  "committed",
  "delivered",
  "observed",
];

function scaffoldDir() {
  const fallback = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"));
    return reg.appScaffoldTemplates ? path.join(REPO_ROOT, reg.appScaffoldTemplates) : fallback;
  } catch {
    return fallback;
  }
}

// Files the scaffold MUST ship (relative to the scaffold dir, .tmpl form).
const REQUIRED_FILES = [
  "package.json.tmpl",
  "tsconfig.json.tmpl",
  "next.config.ts.tmpl",
  "postcss.config.mjs.tmpl",
  "components.json.tmpl",
  "DESIGN_SYSTEM.md.tmpl",
  "FOUNDERS_CHECKLIST.md.tmpl",
  ".env.local.example.tmpl",
  "src/lib/utils.ts.tmpl",
  "src/lib/admin/config.ts.tmpl",
  "src/lib/admin/project-sections.ts.tmpl",
  "src/lib/admin/store.ts.tmpl",
  "src/lib/telemetry/events.ts.tmpl",
  "src/lib/telemetry/sink.ts.tmpl",
  "src/lib/telemetry/track.ts.tmpl",
  "src/lib/telemetry/chain.ts.tmpl",
  "src/app/admin/actions.ts.tmpl",
  "src/app/admin/page.tsx.tmpl",
  "src/app/layout.tsx.tmpl",
  "src/app/page.tsx.tmpl",
  "src/app/globals.css.tmpl",
  "src/components/ui/button.tsx.tmpl",
  "src/components/ui/card.tsx.tmpl",
  "src/components/ui/input.tsx.tmpl",
  "src/components/ui/label.tsx.tmpl",
  "src/components/ui/dialog.tsx.tmpl",
];

// Dependencies the scaffold MUST pin (in dependencies or devDependencies).
const REQUIRED_DEPS = [
  "next",
  "react",
  "react-dom",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "lucide-react",
  "@radix-ui/react-slot",
  "@radix-ui/react-dialog",
  "@radix-ui/react-label",
  "tailwindcss",
  "@tailwindcss/postcss",
  "typescript",
  "@playwright/test",
];

function isLocalOrBuiltin(spec) {
  return (
    spec.startsWith("@/") ||
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("node:")
  );
}

function pkgName(spec) {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

function* walkTemplates(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkTemplates(full);
    else if (e.isFile() && /\.(ts|tsx)\.tmpl$/.test(e.name)) yield full;
  }
}

function collectImports(text) {
  const specs = new Set();
  const scanText = stripTsComments(text);
  const re = /(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(scanText)) !== null) specs.add(m[1]);
  const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynamicImportRe.exec(scanText)) !== null) specs.add(m[1]);
  const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRe.exec(scanText)) !== null) specs.add(m[1]);
  return [...specs];
}

function readIf(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

function stripTsComments(text) {
  let out = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === "\n" || ch === "\r") {
        lineComment = false;
        out += ch;
      } else {
        out += " ";
      }
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        out += "  ";
        i++;
      } else {
        out += ch === "\n" || ch === "\r" ? ch : " ";
      }
      continue;
    }

    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      out += "  ";
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      out += "  ";
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    }
    out += ch;
  }

  return out;
}

function parseConstStringArray(text, constName) {
  const re = new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`);
  const m = stripTsComments(text).match(re);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, idx) => value === expected[idx])
  );
}

function activationFields(text) {
  const body = stripTsComments(text).match(/export\s+const\s+ACTIVATION_DEFINITION(?:\s*:\s*[A-Za-z0-9_]+)?\s*=\s*\{([\s\S]*?)\}\s*;?/);
  if (!body) return null;
  const fields = {};
  for (const key of ["predicate", "provenance", "confidence", "derivedFrom"]) {
    const m = body[1].match(new RegExp(`${key}\\s*:\\s*([^,\\n]+)`));
    if (m) fields[key] = m[1].trim();
  }
  return fields;
}

function hasNamedExport(text, name) {
  const scanText = stripTsComments(text);
  return (
    new RegExp(`export\\s+(?:async\\s+)?(?:const|let|var|function|type|interface)\\s+${name}\\b`).test(scanText) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(scanText)
  );
}

function requireNamedExport(errors, text, rel, name) {
  if (text !== null && !hasNamedExport(text, name)) {
    errors.push(`${rel} missing named export: ${name}`);
  }
}

function stringLiteralValue(raw) {
  const m = typeof raw === "string" ? raw.match(/^["']([\s\S]*)["']$/) : null;
  return m ? m[1] : null;
}

function isUndefinedActivationPredicate(value) {
  if (!value || !value.trim()) return true;
  return /\{\{[^}]+\}\}|TODO|TBD|PLACEHOLDER|DEFINE|UNDEFINED|REPLACE_ME|SENTINEL/i.test(value);
}

function isUnresolvedTemplateValue(value) {
  if (!value || !value.trim()) return true;
  return /\{\{[^}]+\}\}|TODO|TBD|PLACEHOLDER|DEFINE|UNDEFINED|REPLACE_ME|SENTINEL/i.test(value);
}

function evaluateScaffold(dir = scaffoldDir()) {
  const errors = [];
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      errors: [`scaffold dir missing: ${path.relative(REPO_ROOT, dir)}`],
      dir,
    };
  }

  for (const rel of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, rel))) errors.push(`missing required file: ${rel}`);
  }

  let allDeps = {};
  const pkgPath = path.join(dir, "package.json.tmpl");
  if (fs.existsSync(pkgPath)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch (e) {
      errors.push(`package.json.tmpl is not valid JSON: ${e.message}`);
    }
    if (pkg) {
      allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const d of REQUIRED_DEPS) {
        if (!(d in allDeps)) errors.push(`package.json missing required dep: ${d}`);
      }
    }
  }

  const declared = new Set(Object.keys(allDeps));
  for (const file of walkTemplates(dir)) {
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    for (const spec of collectImports(text)) {
      if (isLocalOrBuiltin(spec)) continue;
      const name = pkgName(spec);
      if (!declared.has(name)) {
        errors.push(`import->dep drift: ${rel} imports "${spec}" but "${name}" is not in package.json`);
      }
    }
  }

  const tsconfig = readIf(path.join(dir, "tsconfig.json.tmpl"));
  if (tsconfig !== null && !/"@\/\*"\s*:/.test(tsconfig)) {
    errors.push("tsconfig.json missing the `@/*` path alias");
  }

  const nextcfg = readIf(path.join(dir, "next.config.ts.tmpl"));
  if (nextcfg !== null) {
    for (const h of ["X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security"]) {
      if (!nextcfg.includes(h)) errors.push(`next.config.ts missing security header: ${h}`);
    }
  }

  const css = readIf(path.join(dir, "src/app/globals.css.tmpl"));
  if (css !== null) {
    if (!/@import\s+["']tailwindcss["']/.test(css)) errors.push("globals.css missing `@import \"tailwindcss\"`");
    if (!/@theme\s+inline/.test(css)) errors.push("globals.css missing `@theme inline` token bridge");
    if (!/--color-primary\s*:/.test(css)) errors.push("globals.css missing the --color-primary token");
  }

  const utils = readIf(path.join(dir, "src/lib/utils.ts.tmpl"));
  if (utils !== null && !/export\s+function\s+cn\b/.test(utils)) {
    errors.push("src/lib/utils.ts missing the `cn` export");
  }

  addTelemetryChecks(dir, errors);
  addAdminSurfaceChecks(dir, errors);
  addFoundersChecklistChecks(dir, errors);
  addReadinessSurfaceChecks(dir, errors);
  addReadinessGuideChecks(dir, errors);

  return { ok: errors.length === 0, errors, dir };
}

// ── Readiness surface (S-PF-09a R-5 / AC-ship) ──────────────────────────────────
// The founders in-app panel is one feature with two halves that must ship together:
//   - the PRODUCER  : scripts/scaffold/{app.js, readiness-report.js, founders-checklist.js}
//   - the PANEL     : _mc/templates/app-scaffold/src/app/admin/readiness/* + src/lib/readiness/*
// A producer-present/panel-absent install (or vice versa) is the WG-23 failure that killed
// doogle's lastmile — so we assert BOTH halves, fail-closed. The producer scripts live in the
// repo (REPO_ROOT/scripts/scaffold); the panel templates live under the scaffold dir.

// Producer scripts (relative to REPO_ROOT). The readiness panel cannot function without them.
const READINESS_PRODUCER_FILES = [
  "scripts/scaffold/app.js",
  "scripts/scaffold/readiness-report.js",
  "scripts/scaffold/founders-checklist.js",
];

// Panel templates (relative to the scaffold dir, .tmpl form). Net-new product-facing surface.
const READINESS_PANEL_FILES = [
  "src/app/admin/readiness/page.tsx.tmpl",
  "src/app/admin/readiness/actions.ts.tmpl",
];

// The src/lib/readiness/* glob holds the shared data/render lib.
const READINESS_LIB_DIR_REL = "src/lib/readiness";

// Every readiness lib template the panel depends on MUST ship — the panel imports all three:
//   types.ts     — the readiness item/report/owner-class types the page + actions consume
//   group.ts     — owner-class grouping/ordering for the oriented board (AC-A4/A5)
//   writeback.ts — the load-bearing surgical line-patch write-back (AC-A6)
// A "ships >=1 lib file" check under-enforced this: a panel that imports group.ts/writeback.ts
// would still pass with only types.ts present, then break at install. Assert each by name
// (relative to READINESS_LIB_DIR_REL).
const READINESS_LIB_FILES = ["types.ts.tmpl", "group.ts.tmpl", "writeback.ts.tmpl"];

function addReadinessSurfaceChecks(dir, errors, repoRoot = REPO_ROOT) {
  // Producer half — scripts that emit the readiness report. Resolved from repoRoot, NOT the
  // scaffold dir (these are framework scripts, not shipped templates). repoRoot is injectable
  // so fixture tests can plant present/absent producer files in a temp dir.
  let producerPresent = 0;
  for (const rel of READINESS_PRODUCER_FILES) {
    if (fs.existsSync(path.join(repoRoot, rel))) producerPresent++;
    else errors.push(`readiness producer missing: ${rel}`);
  }

  // Panel half — the in-app /admin/readiness templates.
  let panelPresent = 0;
  for (const rel of READINESS_PANEL_FILES) {
    if (fs.existsSync(path.join(dir, rel))) panelPresent++;
    else errors.push(`readiness panel template missing: ${rel}`);
  }

  // src/lib/readiness/*.ts.tmpl — ALL required shared lib templates must ship (not just >=1).
  // Assert each named file the panel imports; a missing one is a RED build (the panel would
  // import a template that never shipped).
  const libDir = path.join(dir, READINESS_LIB_DIR_REL);
  let libCount = 0;
  try {
    libCount = fs
      .readdirSync(libDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ts\.tmpl$/.test(e.name)).length;
  } catch {
    libCount = 0;
  }
  let libPresent = 0;
  for (const rel of READINESS_LIB_FILES) {
    if (fs.existsSync(path.join(libDir, rel))) libPresent++;
    else errors.push(`readiness shared lib missing: ${READINESS_LIB_DIR_REL}/${rel}`);
  }
  const libWhole = libPresent === READINESS_LIB_FILES.length;

  // Neither half ships orphaned: if EITHER half is fully present while the other is fully
  // absent, that is a half-shipped feature — flag it explicitly (closes WG-23). This catches
  // the "producer present but panel absent" (or vice-versa) planted fixture.
  const producerWhole = producerPresent === READINESS_PRODUCER_FILES.length;
  const panelWhole = panelPresent === READINESS_PANEL_FILES.length && libWhole;
  const producerAny = producerPresent > 0;
  const panelAny = panelPresent > 0 || libCount > 0;
  if (producerWhole && !panelAny) {
    errors.push("readiness feature half-shipped: producer present but panel/lib absent (WG-23)");
  }
  if (panelWhole && !producerAny) {
    errors.push("readiness feature half-shipped: panel present but producer absent (WG-23)");
  }
}

// ── Readiness deep-link guides (AC-A8 / WG-29) ──────────────────────────────────
// The producer (readiness-report.js) can emit deep_link.ref pointing at any guide basename in
// its three resolver maps (ID_GUIDE, ID_PREFIX_GUIDE, DIM_GUIDE). Every basename it CAN
// reference must have a shipped in-app guide content template, AND the [ref] viewer route that
// renders it must ship — otherwise a panel CTA "points nowhere" and that must be a RED build.

// Glob/route the panel ships to render guide content in-app.
const GUIDE_CONTENT_DIR_REL = "src/app/admin/guides/_content";
const GUIDE_VIEWER_ROUTE_REL = "src/app/admin/guides/[ref]/page.tsx.tmpl";

/**
 * Compute the set of guide basenames the producer is CAPABLE of referencing, by reading the
 * three deep-link maps out of scripts/scaffold/readiness-report.js source. We parse the source
 * (the maps are module-private) rather than hardcode, so the enforcer tracks producer drift.
 * Returns a sorted array of basenames like "PAYMENTS_GUIDE.md".
 */
function computeReferenceableGuideBasenames(repoRoot = REPO_ROOT) {
  const src = readIf(path.join(repoRoot, "scripts", "scaffold", "readiness-report.js"));
  if (src === null) return [];
  const scan = stripTsComments(src);
  const set = new Set();
  // Restrict to the three resolver-map blocks so we don't sweep unrelated *_GUIDE strings.
  // The maps are `const NAME = Object.freeze({...})` or `Object.freeze([...])`; capture from
  // the const decl up to its closing `);` (the maps are the only such freeze-wrapped consts).
  for (const constName of ["ID_GUIDE", "ID_PREFIX_GUIDE", "DIM_GUIDE"]) {
    const idx = scan.indexOf(`const ${constName} `);
    if (idx === -1) continue;
    // Slice to the next `});` or `]);` (end of an Object.freeze({...}) / Object.freeze([...])).
    const rest = scan.slice(idx);
    const endM = rest.match(/\n\}\)\s*;|\n\]\)\s*;|\]\)\s*;|\}\)\s*;/);
    const block = endM ? rest.slice(0, endM.index + endM[0].length) : rest.slice(0, 2000);
    for (const bm of block.matchAll(/["']([A-Za-z0-9_]+_GUIDE\.md)["']/g)) {
      set.add(bm[1]);
    }
  }
  return [...set].sort();
}

function addReadinessGuideChecks(dir, errors, repoRoot = REPO_ROOT) {
  const referenceable = computeReferenceableGuideBasenames(repoRoot);
  if (referenceable.length === 0) {
    // Producer source unreadable/empty → cannot verify; fail closed.
    errors.push("readiness guide check: could not compute referenceable guide set from readiness-report.js");
    return;
  }

  // (a) Each referenceable basename must have a shipped in-app guide content template.
  const contentDir = path.join(dir, GUIDE_CONTENT_DIR_REL);
  for (const base of referenceable) {
    const tmpl = path.join(contentDir, `${base}.tmpl`); // e.g. PAYMENTS_GUIDE.md.tmpl
    if (!fs.existsSync(tmpl)) {
      errors.push(`readiness CTA points nowhere: no shipped guide for referenceable ref "${base}" (expected ${GUIDE_CONTENT_DIR_REL}/${base}.tmpl)`);
    }
  }

  // (b) The [ref] viewer route that renders guide content in-app must ship.
  if (!fs.existsSync(path.join(dir, GUIDE_VIEWER_ROUTE_REL))) {
    errors.push(`readiness guide viewer route missing: ${GUIDE_VIEWER_ROUTE_REL}`);
  }
}

function addFoundersChecklistChecks(dir, errors) {
  const checklist = readIf(path.join(dir, "FOUNDERS_CHECKLIST.md.tmpl"));
  if (checklist !== null) {
    if (!checklist.includes("{{FOUNDERS_CHECKLIST}}")) {
      errors.push("FOUNDERS_CHECKLIST.md.tmpl must render the deterministic founders checklist token");
    }
  }

  const stripeRendered = renderFoundersChecklist({
    declaredStack: {
      source: "_requirements/00-canonical/DATA_AND_ACCOUNTS.md",
      values: {
        framework: "Next.js",
        database: "Supabase",
        auth: "Clerk",
        payments: "Stripe",
        hosting: "Vercel",
        analytics: "PostHog",
      },
    },
  });
  const parsed = parseFoundersChecklist(stripeRendered);
  if (!parsed.ok) {
    errors.push(`founders checklist renderer produced invalid output: ${parsed.errors.join("; ")}`);
  }
  for (const requiredId of [
    "provider.accounts",
    "domain.dns",
    "legal.privacy_terms",
    "production.env",
    "payments.stripe.identity",
    "payments.stripe.webhook",
  ]) {
    if (!parsed.items.some((item) => item.id === requiredId)) {
      errors.push(`founders checklist missing required item: ${requiredId}`);
    }
  }
  if (!stripeRendered.includes(CHECKLIST_SCHEMA)) {
    errors.push(`founders checklist missing schema: ${CHECKLIST_SCHEMA}`);
  }
  if (!/Verify Stripe identity/.test(stripeRendered)) {
    errors.push("founders checklist must render Stripe declared-stack launch gate");
  }

  const mobileRendered = renderFoundersChecklist({
    declaredStack: {
      source: "_requirements/00-canonical/DATA_AND_ACCOUNTS.md",
      values: {
        framework: "Expo",
        database: "Supabase",
        auth: "Supabase",
        payments: "Stripe where supported else IAP",
        hosting: "EAS Build Submit",
        analytics: "PostHog",
      },
    },
  });
  const mobileParsed = parseFoundersChecklist(mobileRendered);
  if (!mobileParsed.ok) {
    errors.push(`mobile founders checklist renderer produced invalid output: ${mobileParsed.errors.join("; ")}`);
  }
  for (const requiredId of [
    "payments.mobile.classification",
    "payments.apple.iap",
    "payments.google.play_billing",
    "payments.mobile.server_verification",
  ]) {
    if (!mobileParsed.items.some((item) => item.id === requiredId)) {
      errors.push(`mobile founders checklist missing platform-billing item: ${requiredId}`);
    }
  }
  if (mobileParsed.items.some((item) => item.id === "payments.stripe.identity")) {
    errors.push("mobile platform-billing checklist must not render Stripe live-mode identity gate");
  }
  if (!/Google Play Billing/.test(mobileRendered)) {
    errors.push("mobile founders checklist must render Google Play Billing launch gate");
  }
}

function addAdminSurfaceChecks(dir, errors) {
  const env = readIf(path.join(dir, ".env.local.example.tmpl"));
  if (env !== null) {
    for (const name of ["ADMIN_FOUNDER_EMAILS", "ADMIN_SESSION_SECRET", "ADMIN_SESSION_COOKIE", "ADMIN_DEV_EMAIL"]) {
      if (!new RegExp(`^${name}=`, "m").test(env)) {
        errors.push(`env example missing admin name: ${name}`);
      }
    }
    if (/^ADMIN_(?:FOUNDER_EMAILS|SESSION_SECRET|DEV_EMAIL)=\S+/m.test(env)) {
      errors.push("env example must not seed admin identity or session-secret values");
    }
  }

  const config = readIf(path.join(dir, "src/lib/admin/config.ts.tmpl"));
  const projectSections = readIf(path.join(dir, "src/lib/admin/project-sections.ts.tmpl"));
  const store = readIf(path.join(dir, "src/lib/admin/store.ts.tmpl"));
  const actions = readIf(path.join(dir, "src/app/admin/actions.ts.tmpl"));
  const page = readIf(path.join(dir, "src/app/admin/page.tsx.tmpl"));
  const configScan = config === null ? null : stripTsComments(config);
  const projectScan = projectSections === null ? null : stripTsComments(projectSections);
  const storeScan = store === null ? null : stripTsComments(store);
  const actionsScan = actions === null ? null : stripTsComments(actions);
  const pageScan = page === null ? null : stripTsComments(page);

  if (config !== null) {
    for (const name of [
      "ADMIN_FEATURE_FLAGS",
      "adminSessionCookieName",
      "founderEmailAllowlist",
      "isFounderEmailAllowed",
      "verifyAdminSessionCookie",
      "signAdminSessionEmail",
      "setAdminSessionCookie",
      "clearAdminSessionCookie",
      "resolveAdminActor",
      "requireFounderAdmin",
    ]) {
      requireNamedExport(errors, config, "src/lib/admin/config.ts", name);
    }
    if (
      !/process\.env\.ADMIN_FOUNDER_EMAILS/.test(configScan) ||
      !/process\.env\.ADMIN_SESSION_SECRET/.test(configScan) ||
      !/process\.env\.ADMIN_SESSION_COOKIE/.test(configScan) ||
      !/process\.env\.ADMIN_DEV_EMAIL/.test(configScan)
    ) {
      errors.push("admin config must read ADMIN_FOUNDER_EMAILS, ADMIN_SESSION_SECRET, ADMIN_SESSION_COOKIE, and ADMIN_DEV_EMAIL");
    }
    if (
      !/cookies\(\)/.test(configScan) ||
      !/verifyAdminSessionCookie\(/.test(configScan) ||
      !/createHmac\("sha256"/.test(configScan) ||
      !/timingSafeEqual\(/.test(configScan)
    ) {
      errors.push("admin config must verify a signed request-bound admin session cookie");
    }
    if (!/base64url/.test(configScan) || !/\.split\("\."\)/.test(configScan)) {
      errors.push("admin signed session cookie must encode the email segment safely");
    }
    // Session lifetime + revocation (E-MC-READINESS Track-2 HIGH): a signed admin cookie
    // must EXPIRE (a leaked cookie must not be a permanent skeleton key) and carry a version
    // revocation lever, with the signature binding email|iat|version.
    if (
      !/ADMIN_SESSION_MAX_AGE_SECONDS/.test(configScan) ||
      !/adminSessionVersion\(|ADMIN_SESSION_VERSION/.test(configScan) ||
      !/now - iat > ADMIN_SESSION_MAX_AGE_SECONDS/.test(configScan)
    ) {
      errors.push("admin session token must carry an expiry (iat + ADMIN_SESSION_MAX_AGE_SECONDS) and a version revocation lever");
    }
    // Reference secure cookie issuance (E-MC-READINESS Track-2 HIGH): the set path must ship
    // with HttpOnly + Secure(prod) + SameSite + Max-Age so a hand-rolled login can't drop them.
    if (
      !/setAdminSessionCookie/.test(configScan) ||
      !/httpOnly:\s*true/.test(configScan) ||
      !/sameSite:/.test(configScan) ||
      !/maxAge:/.test(configScan) ||
      !/secure:\s*process\.env\.NODE_ENV/.test(configScan)
    ) {
      errors.push("admin config must ship setAdminSessionCookie with HttpOnly + Secure(prod) + SameSite + Max-Age flags");
    }
    if (!/NODE_ENV\s*!==\s*"production"/.test(configScan)) {
      errors.push("admin dev email fallback must fail closed in production");
    }
    if (!/isFounderEmailAllowed\(/.test(configScan) || !/throw new Error\("Admin access denied/.test(configScan)) {
      errors.push("admin config must fail closed when founder email is not allowlisted");
    }
  }

  if (actions !== null) {
    for (const name of [
      "toggleAccountStateAction",
      "setEntitlementAction",
      "setFeatureFlagAction",
    ]) {
      requireNamedExport(errors, actions, "src/app/admin/actions.ts", name);
    }
    if (countMatches(actionsScan, /await\s+requireFounderAdmin\(\)/g) < 3) {
      errors.push("admin server actions must call requireFounderAdmin before mutation");
    }
    if (countMatches(actionsScan, /recordAdminAudit\(\{/g) < 3) {
      errors.push("admin server actions must write audit records for every mutation");
    }
    if (!/isAdminEntitlement\(/.test(actionsScan)) {
      errors.push("admin entitlement mutation must use the explicit entitlement allowlist");
    }
    if (!/revalidatePath\("\/admin"\)/.test(actionsScan)) {
      errors.push("admin server actions must revalidate /admin");
    }
  }

  if (store !== null) {
    for (const name of [
      "searchAdminUsers",
      "ADMIN_ALLOWED_ENTITLEMENTS",
      "isAdminEntitlement",
      "setAdminUserAccountState",
      "setAdminUserEntitlement",
      "recordAdminAudit",
      "listAdminAuditRecords",
      "listAdminFeatureFlags",
      "setAdminFeatureFlag",
      "listAdminEventFeed",
    ]) {
      requireNamedExport(errors, store, "src/lib/admin/store.ts", name);
    }
    if (!/evaluateTelemetryChain\(/.test(storeScan) || !/SUPPLY_CHAIN_STAGES/.test(storeScan)) {
      errors.push("admin event feed must consume the W0 telemetry chain seam");
    }
    if (!/ADMIN_ALLOWED_ENTITLEMENTS\s*=\s*\[[\s\S]*"beta"/.test(storeScan)) {
      errors.push("admin store must constrain manual entitlements to an explicit small allowlist");
    }
  }

  if (projectSections !== null) {
    requireNamedExport(errors, projectSections, "src/lib/admin/project-sections.ts", "ADMIN_PROJECT_SECTIONS");
    requireNamedExport(errors, projectSections, "src/lib/admin/project-sections.ts", "listAdminProjectSections");
    if (!/_requirements\/00-canonical/.test(projectScan) || !/declared Tech Stack/.test(projectScan)) {
      errors.push("admin project sections must name canon and declared stack as generation sources");
    }
    if (!/basic_moderate/.test(projectScan) || !/CoreLoopEntity/.test(projectScan)) {
      errors.push("admin project sections must expose a core-loop entity with basic moderation only");
    }
  }

  if (page !== null) {
    for (const needle of [
      "resolveAdminActor",
      "founderEmailAllowlist",
      "searchAdminUsers",
      "toggleAccountStateAction",
      "setEntitlementAction",
      "listAdminEventFeed",
      "listAdminFeatureFlags",
      "setFeatureFlagAction",
      "listAdminProjectSections",
    ]) {
      if (!new RegExp(`\\b${needle}\\b`).test(pageScan)) {
        errors.push(`admin page missing required wiring: ${needle}`);
      }
    }
    if (!/if\s*\(\s*!actor\.allowed\s*\)/.test(pageScan)) {
      errors.push("admin page must render behind the founder allowlist gate");
    }
    if (!/name="q"/.test(pageScan) || !/defaultValue=\{query\}/.test(pageScan)) {
      errors.push("admin page must include user search input wired to query state");
    }
    if (!/name="state"/.test(pageScan) || !/value=\{user\.state === "active" \? "suspended" : "active"\}/.test(pageScan)) {
      errors.push("admin page must include account-state toggle controls");
    }
    if (!/name="entitlement"/.test(pageScan) || !/name="enabled"/.test(pageScan)) {
      errors.push("admin page must include entitlement grant/revoke controls");
    }
  }
}

function addTelemetryChecks(dir, errors) {
  const env = readIf(path.join(dir, ".env.local.example.tmpl"));
  if (env !== null) {
    for (const name of ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"]) {
      if (!new RegExp(`^${name}=`, "m").test(env)) {
        errors.push(`env example missing telemetry name: ${name}`);
      }
    }
  }

  const events = readIf(path.join(dir, "src/lib/telemetry/events.ts.tmpl"));
  const sink = readIf(path.join(dir, "src/lib/telemetry/sink.ts.tmpl"));
  const track = readIf(path.join(dir, "src/lib/telemetry/track.ts.tmpl"));
  const chain = readIf(path.join(dir, "src/lib/telemetry/chain.ts.tmpl"));
  const page = readIf(path.join(dir, "src/app/page.tsx.tmpl"));
  const layout = readIf(path.join(dir, "src/app/layout.tsx.tmpl"));
  const eventsScan = events === null ? null : stripTsComments(events);
  const sinkScan = sink === null ? null : stripTsComments(sink);
  const trackScan = track === null ? null : stripTsComments(track);
  const chainScan = chain === null ? null : stripTsComments(chain);
  const pageScan = page === null ? null : stripTsComments(page);
  const layoutScan = layout === null ? null : stripTsComments(layout);

  if (events !== null) {
    requireNamedExport(errors, events, "src/lib/telemetry/events.ts", "LIFECYCLE_EVENTS");
    requireNamedExport(errors, events, "src/lib/telemetry/events.ts", "SUPPLY_CHAIN_STAGES");
    requireNamedExport(errors, events, "src/lib/telemetry/events.ts", "ACTIVATION_DEFINITION");
    requireNamedExport(errors, events, "src/lib/telemetry/events.ts", "deriveActivationDefinition");

    const lifecycleEvents = parseConstStringArray(events, "LIFECYCLE_EVENTS");
    if (!sameArray(lifecycleEvents, CANONICAL_EVENTS)) {
      errors.push(`event vocabulary drift: LIFECYCLE_EVENTS must be exactly ${CANONICAL_EVENTS.join(", ")}`);
    }

    const stages = parseConstStringArray(events, "SUPPLY_CHAIN_STAGES");
    if (!sameArray(stages, CANONICAL_STAGES)) {
      errors.push(`chain stage vocabulary drift: SUPPLY_CHAIN_STAGES must be exactly ${CANONICAL_STAGES.join(", ")}`);
    }

    const activation = activationFields(events);
    if (!activation) {
      errors.push("activation definition missing");
    } else {
      for (const field of ["predicate", "provenance", "confidence", "derivedFrom"]) {
        if (!(field in activation)) errors.push(`activation definition missing field: ${field}`);
      }
      const predicate = stringLiteralValue(activation.predicate);
      if (isUndefinedActivationPredicate(predicate)) {
        errors.push("activation definition present but undefined");
      }
      const provenance = stringLiteralValue(activation.provenance);
      if (isUnresolvedTemplateValue(provenance)) {
        errors.push("activation definition provenance present but undefined");
      }
      if (!["derived-at-canon", "founder-named-at-intake", "revised-at-lastmile"].includes(provenance)) {
        errors.push("activation definition provenance must be derived-at-canon, founder-named-at-intake, or revised-at-lastmile");
      }
      const derivedFrom = stringLiteralValue(activation.derivedFrom);
      if (isUnresolvedTemplateValue(derivedFrom)) {
        errors.push("activation definition derivedFrom present but undefined");
      }
      const confidence = Number(activation.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        errors.push("activation definition confidence must be numeric between 0 and 1");
      }
    }
    if (!/function\s+deriveActivationDefinition\b/.test(eventsScan) || !/requires core-loop action, subject, and source/.test(eventsScan)) {
      errors.push("activation derivation must fail closed on thin core-loop input");
    }
  }

  if (sink !== null) {
    requireNamedExport(errors, sink, "src/lib/telemetry/sink.ts", "resolveTelemetrySink");
    if (countMatches(sinkScan, /function\s+resolveTelemetrySink\b/g) !== 1) {
      errors.push("telemetry sink must expose exactly one resolveTelemetrySink function");
    }
    if (!/noopTelemetrySink/.test(sinkScan)) errors.push("telemetry sink missing no-op fallback");
    if (!/NEXT_PUBLIC_POSTHOG_KEY/.test(sinkScan)) errors.push("telemetry sink missing NEXT_PUBLIC_POSTHOG_KEY env gate");
  }

  if (track !== null) {
    requireNamedExport(errors, track, "src/lib/telemetry/track.ts", "track");
    if (!/event\s*:\s*LifecycleEvent/.test(trackScan)) {
      errors.push("track.ts event parameter must derive from LifecycleEvent");
    }
    if (!/resolveTelemetrySink\(\)/.test(trackScan)) {
      errors.push("track.ts must call the single sink resolver");
    }
    if (!/catch\s*\(/.test(trackScan) || !/catch\s*\{/.test(trackScan)) {
      errors.push("track.ts must catch sink failures at the telemetry boundary");
    }
  }

  if (chain !== null) {
    requireNamedExport(errors, chain, "src/lib/telemetry/chain.ts", "evaluateTelemetryChain");
    if (!/SUPPLY_CHAIN_STAGES/.test(chainScan) || !/brokenAtStage/.test(chainScan) || !/failureEvent/.test(chainScan)) {
      errors.push("chain helper missing broken-chain failure event");
    }
  }

  if (page !== null) {
    if (countMatches(pageScan, /const\s+CORE_LOOP_EXAMPLE_ID\b/g) !== 1) {
      errors.push("page must contain exactly one core-loop telemetry example");
    }
    if (!/handleCoreLoopExample/.test(pageScan) || !/track\("core_action"/.test(pageScan) || !/track\("activation"/.test(pageScan)) {
      errors.push("page core-loop example must emit core_action and activation through track()");
    }
    if (/document\.addEventListener\s*\(\s*["']click["']|window\.addEventListener\s*\(\s*["']click["']/.test(pageScan)) {
      errors.push("page must not install a global click telemetry wrapper");
    }
  }

  if (layout !== null && !/ACTIVATION_DEFINITION/.test(layoutScan)) {
    errors.push("layout must carry activation definition provenance wiring");
  }

  for (const file of walkTemplates(dir)) {
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    if (rel === "src/lib/telemetry/sink.ts.tmpl") continue;
    const text = fs.readFileSync(file, "utf8");
    if (/\b(posthog|gtag|plausible|mixpanel)\b|\.capture\s*\(|\banalytics\s*\.\s*track\s*\(|\btracker\s*\.\s*track\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(|\bXMLHttpRequest\s*\(|\bfetch\s*\(/i.test(text)) {
      errors.push(`duplicate telemetry sink/raw emit outside sink.ts: ${rel}`);
    }
  }
}

function main(argv) {
  const json = argv.includes("--json");
  try {
    return emit(json, evaluateScaffold().errors);
  } catch (e) {
    process.stderr.write(`scaffold-coverage-scan error: ${e.message}\n`);
    return 2;
  }
}

function emit(json, errors) {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors }, null, 2) + "\n");
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    process.stdout.write("OK scaffold-coverage: app scaffold complete + coherent (deps->imports aligned, telemetry seam wired)\n");
    return 0;
  }
  process.stderr.write(`FAIL scaffold-coverage (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

/**
 * Focused, fixture-friendly evaluator for JUST the readiness surface + guide checks.
 * Tests pass a scaffoldDir (panel/lib/guide templates) and a repoRoot (producer scripts);
 * both can be temp dirs with planted present/absent files. Returns { ok, errors }.
 */
function evaluateReadinessCoverage(scaffoldDir, repoRoot = REPO_ROOT) {
  const errors = [];
  addReadinessSurfaceChecks(scaffoldDir, errors, repoRoot);
  addReadinessGuideChecks(scaffoldDir, errors, repoRoot);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  CANONICAL_EVENTS,
  CANONICAL_STAGES,
  REQUIRED_FILES,
  READINESS_PRODUCER_FILES,
  READINESS_PANEL_FILES,
  READINESS_LIB_DIR_REL,
  READINESS_LIB_FILES,
  GUIDE_CONTENT_DIR_REL,
  GUIDE_VIEWER_ROUTE_REL,
  evaluateScaffold,
  evaluateReadinessCoverage,
  computeReferenceableGuideBasenames,
  addReadinessSurfaceChecks,
  addReadinessGuideChecks,
  parseConstStringArray,
};
