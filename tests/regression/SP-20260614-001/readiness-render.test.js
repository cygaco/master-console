#!/usr/bin/env node
"use strict";

// FIX #2 (qa HIGH / frontend MAJOR) + FIX #1 (frontend MAJOR — warm FTUE).
//
// (a) The "In the sprint" group (open sprint-work | waiver) is STATUS-DISPLAY-ONLY: it
//     renders via InSprintItemRow with NO checkbox/toggle/form (the server action rejects
//     toggling those owner_classes — a toggle there would be misleading). The "Do this
//     first" group (open owner-action) is the ONLY checkable group: it renders via
//     OpenItemRow, which carries the server-action <form> + submit-button toggle.
//
// (b) AC-A5: the warm phase (some done + some open) renders measurably differently from
//     cold — different ReadinessPhase, and the cold orientation banner is gone while the
//     open "what's next" work is foregrounded. Asserted via readinessPhase +
//     groupReadinessItems on a warm vs cold summary, plus a source-level warm-cue check.
//
// The page template is JSX (.tsx.tmpl) — not requirable here — so the render structure is
// asserted against the source, the same convention ship-coverage/deeplink-resolve use. The
// grouping/phase LOGIC (pure functions in group.ts.tmpl) is mirrored and exercised directly.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const REPO = process.cwd();

const PAGE = path.join(
  REPO,
  "_mc",
  "templates",
  "app-scaffold",
  "src",
  "app",
  "admin",
  "readiness",
  "page.tsx.tmpl",
);
const GROUP = path.join(
  REPO,
  "_mc",
  "templates",
  "app-scaffold",
  "src",
  "lib",
  "readiness",
  "group.ts.tmpl",
);
const TOGGLE = path.join(
  REPO,
  "_mc",
  "templates",
  "app-scaffold",
  "src",
  "app",
  "admin",
  "readiness",
  "ToggleControl.tsx.tmpl",
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ── Mirror of group.ts pure logic (kept in lockstep with group.ts.tmpl) ─────────────
function readinessPhase(summary) {
  if (summary.completed === 0) return "cold";
  if (summary.open === 0 && summary.blocked === 0) return "all-done";
  return "warm";
}
function groupReadinessItems(view) {
  const doFirst = [];
  const blocked = [];
  const inSprint = [];
  const done = [];
  for (const it of view.items) {
    if (it.status === "done") done.push(it);
    else if (it.status === "blocked") blocked.push(it);
    else if (it.owner_class === "owner-action") doFirst.push(it);
    else inSprint.push(it);
  }
  return [
    { key: "do-first", items: doFirst },
    { key: "blocked", items: blocked },
    { key: "in-sprint", items: inSprint },
    { key: "done", items: done },
  ].filter((g) => g.items.length > 0);
}

// ── group.ts routing: open sprint-work/waiver → in-sprint; open owner-action → do-first ─
test("group-routing-open-ownerclass-splits-do-first-vs-in-sprint", () => {
  const view = {
    items: [
      { id: "a", status: "open", owner_class: "owner-action" },
      { id: "b", status: "open", owner_class: "sprint-work" },
      { id: "c", status: "open", owner_class: "waiver" },
      { id: "d", status: "done", owner_class: "owner-action" },
    ],
  };
  const groups = groupReadinessItems(view);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)]));
  assert.deepStrictEqual(byKey["do-first"], ["a"], "open owner-action → do-first");
  assert.deepStrictEqual(
    (byKey["in-sprint"] || []).sort(),
    ["b", "c"],
    "open sprint-work + waiver → in-sprint",
  );
  // group.ts.tmpl source confirms the same routing (sprint-work/waiver fall to inSprint).
  const gsrc = fs.readFileSync(GROUP, "utf8");
  assert.ok(
    /owner_class === "owner-action"\)\s*\{\s*\n\s*doFirst\.push/.test(gsrc),
    "group.ts must route open owner-action → doFirst",
  );
  assert.ok(
    /inSprint\.push\(it\)/.test(gsrc),
    "group.ts must route the remaining open items (sprint-work|waiver) → inSprint",
  );
});

// ── in-sprint renders WITHOUT a toggle/form; do-first renders WITH one ───────────────
test("in-sprint-display-only-do-first-has-toggle", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  // A dedicated display-only component exists for the in-sprint group.
  assert.ok(
    /function InSprintItemRow\(/.test(src),
    "page must define a display-only InSprintItemRow for the in-sprint group",
  );

  // Isolate the InSprintItemRow body and prove it has NO form / toggle affordance.
  const inSprintMatch = src.match(
    /function InSprintItemRow\([\s\S]*?\n}\n/,
  );
  assert.ok(inSprintMatch, "could not isolate InSprintItemRow body");
  const inSprintBody = inSprintMatch[0];
  assert.ok(
    !/<form/.test(inSprintBody),
    "InSprintItemRow must NOT contain a <form> (no write-back affordance)",
  );
  assert.ok(
    !/<ToggleControl/.test(inSprintBody),
    "InSprintItemRow must NOT render a ToggleControl (no write-back affordance)",
  );
  assert.ok(
    !/toggleReadinessItemAction/.test(inSprintBody),
    "InSprintItemRow must NOT wire the toggle action",
  );
  assert.ok(
    !/type="submit"/.test(inSprintBody),
    "InSprintItemRow must NOT carry a submit-button toggle",
  );
  assert.ok(
    /We&rsquo;re handling these\./.test(inSprintBody),
    "InSprintItemRow must carry the lighter 'We're handling these.' framing",
  );
  // The deep-link CTA is still allowed (guide kind only — DeepLinkCta self-gates).
  assert.ok(
    /<DeepLinkCta/.test(inSprintBody),
    "InSprintItemRow must still surface the deep-link CTA",
  );

  // OpenItemRow (do-first) DOES carry the toggle — now via the <ToggleControl> client
  // component (the submit-button form + error surface moved there). checked={false}.
  const openMatch = src.match(/function OpenItemRow\([\s\S]*?\n}\n/);
  assert.ok(openMatch, "could not isolate OpenItemRow body");
  const openBody = openMatch[0];
  assert.ok(
    /<ToggleControl\b[\s\S]*?checked=\{false\}/.test(openBody),
    "OpenItemRow must render <ToggleControl checked={false} />",
  );

  // The submit-button toggle + form live in ToggleControl.tsx.tmpl now.
  const toggleSrc = fs.readFileSync(TOGGLE, "utf8");
  assert.ok(
    /<form action=\{formAction\}>/.test(toggleSrc),
    "ToggleControl must carry the toggle <form> (wired to the action via useActionState)",
  );
  assert.ok(
    /type="submit"/.test(toggleSrc),
    "ToggleControl must carry a submit-button toggle",
  );
  assert.ok(
    /toggleReadinessItemAction/.test(toggleSrc),
    "ToggleControl must invoke the (unchanged) toggleReadinessItemAction",
  );
  // NEVER-SWALLOW: a failed toggle renders an inline aria-live error, never dropped.
  assert.ok(
    /state\.ok === false/.test(toggleSrc) &&
      /role="alert"/.test(toggleSrc) &&
      /aria-live="polite"/.test(toggleSrc),
    "ToggleControl must render the { ok:false } error inline (role=alert, aria-live)",
  );

  // The group.map routes in-sprint → InSprintItemRow and do-first → OpenItemRow.
  assert.ok(
    /group\.key === "in-sprint"[\s\S]*?<InSprintItemRow/.test(src),
    "the in-sprint group must render via InSprintItemRow",
  );
  assert.ok(
    /<OpenItemRow\b/.test(src),
    "the do-first group must render via OpenItemRow",
  );
});

// ── S1: the DONE path also gates the toggle on owner_class (mirror of the open split) ──
test("done-sprint-work-waiver-display-only-toggle-gated", () => {
  const src = fs.readFileSync(PAGE, "utf8");
  const doneMatch = src.match(/function DoneItemRow\([\s\S]*?\n}\n/);
  assert.ok(doneMatch, "could not isolate DoneItemRow body");
  const doneBody = doneMatch[0];
  // DoneItemRow must gate the ToggleControl on owner_class === "owner-action" — a done
  // sprint-work/waiver item is the server-rejects class and must NOT show a toggle.
  assert.ok(
    /owner_class === "owner-action"/.test(doneBody),
    "DoneItemRow must gate the toggle on owner_class (done sprint-work/waiver = display-only)",
  );
  // The ToggleControl is rendered CONDITIONALLY (ternary), with a non-toggle display branch.
  assert.ok(
    /\?\s*\(\s*<ToggleControl/.test(doneBody),
    "DoneItemRow must render <ToggleControl> only in the checkable branch, else a static row",
  );
});

// ── warm phase differs measurably from cold (AC-A5) ─────────────────────────────────
test("warm-phase-differs-from-cold", () => {
  const cold = { total: 3, completed: 0, open: 3, blocked: 0 };
  const warm = { total: 3, completed: 1, open: 2, blocked: 0 };
  const allDone = { total: 3, completed: 3, open: 0, blocked: 0 };

  assert.strictEqual(readinessPhase(cold), "cold");
  assert.strictEqual(readinessPhase(warm), "warm");
  assert.strictEqual(readinessPhase(allDone), "all-done");
  assert.notStrictEqual(
    readinessPhase(cold),
    readinessPhase(warm),
    "warm phase must differ from cold phase",
  );

  // Grouping: in the warm board there's a Done group (collapsed) that cold lacks.
  const coldView = {
    items: [
      { id: "a", status: "open", owner_class: "owner-action" },
      { id: "b", status: "open", owner_class: "owner-action" },
      { id: "c", status: "open", owner_class: "sprint-work" },
    ],
  };
  const warmView = {
    items: [
      { id: "a", status: "done", owner_class: "owner-action" },
      { id: "b", status: "open", owner_class: "owner-action" },
      { id: "c", status: "open", owner_class: "sprint-work" },
    ],
  };
  const coldKeys = groupReadinessItems(coldView).map((g) => g.key);
  const warmKeys = groupReadinessItems(warmView).map((g) => g.key);
  assert.ok(!coldKeys.includes("done"), "cold board has no Done group");
  assert.ok(warmKeys.includes("done"), "warm board surfaces a Done group");

  // Source: cold shows the orientation banner; warm does NOT, and warm carries an
  // explicit 'what's next' cue.
  const src = fs.readFileSync(PAGE, "utf8");
  assert.ok(
    /phase === "cold"[\s\S]*?Let&rsquo;s get you launch-ready\./.test(src),
    "cold phase must render the orientation banner",
  );
  assert.ok(
    /phase === "warm"[\s\S]*?what&rsquo;s next/.test(src),
    "warm phase must render an explicit 'what's next' cue (measurable difference)",
  );
  // Done group is collapsed via native <details> (warm de-emphasis).
  assert.ok(
    /group\.key === "done"[\s\S]*?<details/.test(src),
    "the Done group must collapse via <details> (warm de-emphasis)",
  );
});

// ── runner ──────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ok   ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL ${t.name}: ${err.message}`);
    fail++;
  }
}
console.log(`\nreadiness-render.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
