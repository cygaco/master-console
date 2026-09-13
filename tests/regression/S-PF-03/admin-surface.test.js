#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  REQUIRED_FILES,
  evaluateScaffold,
} = require("../../../scripts/checks/scaffold-coverage-scan");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REAL_SCAFFOLD = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function fixture(mutator) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-spf03-scaffold-"));
  fs.cpSync(REAL_SCAFFOLD, dir, { recursive: true });
  if (mutator) mutator(dir);
  return dir;
}

function read(rel, dir) {
  return fs.readFileSync(path.join(dir || REAL_SCAFFOLD, rel), "utf8");
}

function write(rel, body, dir) {
  fs.writeFileSync(path.join(dir, rel), body, "utf8");
}

function expectError(dir, pattern) {
  const result = evaluateScaffold(dir);
  assert.strictEqual(result.ok, false, "fixture unexpectedly passed");
  assert(
    result.errors.some((error) => pattern.test(error)),
    `missing error ${pattern}; got ${JSON.stringify(result.errors)}`,
  );
}

test("real-scaffold-admin-surface-passes", () => {
  const result = evaluateScaffold(REAL_SCAFFOLD);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.ok, true);
});

test("admin-files-are-required-scaffold-contract", () => {
  for (const rel of [
    "src/app/admin/page.tsx.tmpl",
    "src/app/admin/actions.ts.tmpl",
    "src/lib/admin/config.ts.tmpl",
    "src/lib/admin/project-sections.ts.tmpl",
    "src/lib/admin/store.ts.tmpl",
  ]) {
    assert.ok(REQUIRED_FILES.includes(rel), `${rel} in REQUIRED_FILES`);
  }
});

test("missing-admin-page-fixture-fails", () => {
  const dir = fixture((fx) => {
    fs.rmSync(path.join(fx, "src/app/admin/page.tsx.tmpl"));
  });
  try {
    expectError(dir, /missing required file: src\/app\/admin\/page\.tsx\.tmpl/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing-founder-env-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = ".env.local.example.tmpl";
    write(rel, read(rel, fx).replace(/^ADMIN_FOUNDER_EMAILS=.*\n/m, ""), fx);
  });
  try {
    expectError(dir, /env example missing admin name: ADMIN_FOUNDER_EMAILS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("seeded-admin-identity-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = ".env.local.example.tmpl";
    write(rel, read(rel, fx).replace("ADMIN_DEV_EMAIL=", "ADMIN_DEV_EMAIL=founder@example.com"), fx);
  });
  try {
    expectError(dir, /must not seed admin identity/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ungated-admin-page-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/admin/page.tsx.tmpl";
    write(rel, read(rel, fx).replace("if (!actor.allowed)", "if (false)"), fx);
  });
  try {
    expectError(dir, /founder allowlist gate/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unguarded-admin-actions-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/admin/actions.ts.tmpl";
    write(rel, read(rel, fx).replace(/const actor = await requireFounderAdmin\(\);/g, ""), fx);
  });
  try {
    expectError(dir, /server actions must call requireFounderAdmin/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unsigned-header-auth-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/admin/config.ts.tmpl";
    write(rel, read(rel, fx).replace("cookies()", "headers()"), fx);
  });
  try {
    expectError(dir, /signed request-bound admin session cookie/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unsafe-cookie-email-delimiter-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/admin/config.ts.tmpl";
    write(rel, read(rel, fx).replace('lastIndexOf(".")', 'indexOf(".")'), fx);
  });
  try {
    expectError(dir, /encode the email segment safely/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("production-dev-email-fallback-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/admin/config.ts.tmpl";
    write(rel, read(rel, fx).replace('process.env.NODE_ENV !== "production"', "true"), fx);
  });
  try {
    expectError(dir, /dev email fallback must fail closed in production/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing-audit-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/admin/actions.ts.tmpl";
    write(rel, read(rel, fx).replace(/recordAdminAudit\(\{[\s\S]*?\}\);\n/g, ""), fx);
  });
  try {
    expectError(dir, /audit records for every mutation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("arbitrary-entitlement-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/admin/actions.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace(
        '  if (!isAdminEntitlement(entitlement)) {\n    throw new Error(`Unsupported admin entitlement: ${entitlement}`);\n  }\n',
        "",
      ),
      fx,
    );
  });
  try {
    expectError(dir, /entitlement mutation must use the explicit entitlement allowlist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project-section-source-drift-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/admin/project-sections.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace("_requirements/00-canonical + declared Tech Stack", "manual admin template"),
      fx,
    );
  });
  try {
    expectError(dir, /project sections must name canon and declared stack/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("event-feed-bypass-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/admin/store.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace(
        "evaluateTelemetryChain(sampleChainRecords)",
        '({ ok: true, correlationId: "x", observedStages: [] })',
      ),
      fx,
    );
  });
  try {
    expectError(dir, /event feed must consume the W0 telemetry chain seam/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
  } catch (e) {
    failures.push(`${t.name}: ${e.message}`);
  }
}

if (failures.length) {
  process.stderr.write(`S-PF-03 admin surface: ${passed} passed, ${failures.length} FAILED\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`S-PF-03 admin surface: ${passed}/${tests.length} passed\n`);
