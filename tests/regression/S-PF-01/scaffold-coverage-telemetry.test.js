#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CANONICAL_EVENTS,
  evaluateScaffold,
  parseConstStringArray,
} = require("../../../scripts/checks/scaffold-coverage-scan");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REAL_SCAFFOLD = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function fixture(mutator) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-spf01-scaffold-"));
  fs.cpSync(REAL_SCAFFOLD, dir, { recursive: true });
  if (mutator) mutator(dir);
  return dir;
}

function read(rel, dir = REAL_SCAFFOLD) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
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

test("real-scaffold-telemetry-tree-passes", () => {
  const result = evaluateScaffold(REAL_SCAFFOLD);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.ok, true);
});

test("lifecycle-events-exact-set", () => {
  const events = parseConstStringArray(
    read("src/lib/telemetry/events.ts.tmpl"),
    "LIFECYCLE_EVENTS",
  );
  assert.deepStrictEqual(events, CANONICAL_EVENTS);
});

test("track-event-type-derives-from-events", () => {
  const track = read("src/lib/telemetry/track.ts.tmpl");
  assert.match(track, /import type \{ LifecycleEvent, TelemetryProps \} from "\.\/events"/);
  assert.match(track, /event\s*:\s*LifecycleEvent/);
  assert.doesNotMatch(track, /event\s*:\s*["'][^"']+["']\s*\|/);
});

test("activation-definition-shape-required", () => {
  const events = read("src/lib/telemetry/events.ts.tmpl");
  for (const field of ["predicate", "provenance", "confidence", "derivedFrom"]) {
    assert.match(events, new RegExp(`${field}\\s*:`));
  }
});

test("no-global-click-wrapper", () => {
  const page = read("src/app/page.tsx.tmpl");
  assert.doesNotMatch(page, /document\.addEventListener\s*\(\s*["']click["']/);
  assert.doesNotMatch(page, /window\.addEventListener\s*\(\s*["']click["']/);
  assert.strictEqual((page.match(/const\s+CORE_LOOP_EXAMPLE_ID\b/g) || []).length, 1);
});

test("seam-missing-fixture-fails", () => {
  const dir = fixture((fx) => {
    fs.rmSync(path.join(fx, "src/lib/telemetry/track.ts.tmpl"));
  });
  try {
    expectError(dir, /missing required file: src\/lib\/telemetry\/track\.ts\.tmpl/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicate-sink-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nwindow.posthog?.capture(\"signup\", {});\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("analytics-track-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nanalytics.track(\"signup\", {});\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sendbeacon-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nnavigator.sendBeacon(\"/analytics\", \"signup\");\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fetch-analytics-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nfetch(\"/analytics/events\", { method: \"POST\" });\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fetch-telemetry-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nfetch(\"/telemetry\", { method: \"POST\", body: payload });\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fetch-collect-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nfetch(\"/collect\", { method: \"POST\" });\n", fx);
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fetch-variable-endpoint-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(
      rel,
      read(rel, fx) + "\nconst endpoint = \"/collect\";\nfetch(endpoint, { method: \"POST\" });\n",
      fx,
    );
  });
  try {
    expectError(dir, /duplicate telemetry sink\/raw emit outside sink\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("event-name-drift-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(rel, read(rel, fx).replace('"checkout"', '"payment"'), fx);
  });
  try {
    expectError(dir, /event vocabulary drift/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commented-event-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(rel, read(rel, fx).replace('  "checkout",', '  // "checkout",'), fx);
  });
  try {
    expectError(dir, /event vocabulary drift/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commented-stage-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(rel, read(rel, fx).replace('  "observed",', '  // "observed",'), fx);
  });
  try {
    expectError(dir, /chain stage vocabulary drift/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing-track-export-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/track.ts.tmpl";
    write(rel, read(rel, fx).replace("export function track", "function track"), fx);
  });
  try {
    expectError(dir, /src\/lib\/telemetry\/track\.ts missing named export: track/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing-sink-export-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/sink.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace("export function resolveTelemetrySink", "function resolveTelemetrySink"),
      fx,
    );
  });
  try {
    expectError(dir, /src\/lib\/telemetry\/sink\.ts missing named export: resolveTelemetrySink/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("comment-spoofed-track-boundary-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/track.ts.tmpl";
    write(
      rel,
      read(rel, fx)
        .replace("event: LifecycleEvent", "event: string")
        .replace(
          "const sink = resolveTelemetrySink();",
          "// event: LifecycleEvent\n    // resolveTelemetrySink()\n    const sink = () => undefined;",
        ),
      fx,
    );
  });
  try {
    expectError(dir, /track\.ts event parameter must derive from LifecycleEvent|track\.ts must call the single sink resolver/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dynamic-import-drift-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nawait import(\"missing-package\");\n", fx);
  });
  try {
    expectError(dir, /import->dep drift: src\/app\/page\.tsx\.tmpl imports "missing-package"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("require-drift-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/app/page.tsx.tmpl";
    write(rel, read(rel, fx) + "\nconst missing = require(\"missing-package\");\n", fx);
  });
  try {
    expectError(dir, /import->dep drift: src\/app\/page\.tsx\.tmpl imports "missing-package"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unfilled-activation-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace(
        '"user completes the scaffolded core action example"',
        '"{{ACTIVATION_PREDICATE}}"',
      ),
      fx,
    );
  });
  try {
    expectError(dir, /activation definition present but undefined/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unfilled-activation-source-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace(
        '"framework/templates/app-scaffold/src/app/page.tsx.tmpl"',
        '"{{ACTIVATION_SOURCE}}"',
      ),
      fx,
    );
  });
  try {
    expectError(dir, /activation definition derivedFrom present but undefined/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unfilled-activation-provenance-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(
      rel,
      read(rel, fx).replace(
        'provenance: "derived-at-canon",\n  confidence: 0.65,',
        'provenance: "{{ACTIVATION_PROVENANCE}}",\n  confidence: 0.65,',
      ),
      fx,
    );
  });
  try {
    expectError(dir, /activation definition provenance present but undefined/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("activation-confidence-range-fixture-fails", () => {
  const dir = fixture((fx) => {
    const rel = "src/lib/telemetry/events.ts.tmpl";
    write(rel, read(rel, fx).replace("confidence: 0.65", "confidence: 2"), fx);
  });
  try {
    expectError(dir, /activation definition confidence must be numeric between 0 and 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`FAIL ${t.name}: ${err.stack || err.message}`);
    fail++;
  }
}

console.log(`scaffold-coverage-telemetry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
