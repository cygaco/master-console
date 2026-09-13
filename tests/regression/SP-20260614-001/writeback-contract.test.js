// Contract test (DQ finding #1): the readiness panel form fields MUST match what the
// server action reads, and the action MUST derive owner_class SERVER-SIDE (never trust
// client form input for the authz decision). Catches the form<->action field-name
// mismatch class + the client-trusted-ownerClass spoofability — statically, without a
// scaffolded runtime (the .tmpl files only typecheck inside an installed product).
//
// This is the "test the contract between the files, not just the lib internals" lesson:
// writeback-roundtrip.test.js proves patchChecklistItem in isolation; this proves the
// page->action wiring that actually invokes it.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "..");
const PAGE = path.join(ROOT, "_mc/templates/app-scaffold/src/app/admin/readiness/page.tsx.tmpl");
const ACTION = path.join(ROOT, "_mc/templates/app-scaffold/src/app/admin/readiness/actions.ts.tmpl");
// The page-side toggle form moved into the "use client" ToggleControl component (the
// useActionState wrapper + never-swallow error surface). The page-side field emission
// the action must agree with now lives there — so the contract is sourced from ToggleControl.
const TOGGLE = path.join(ROOT, "_mc/templates/app-scaffold/src/app/admin/readiness/ToggleControl.tsx.tmpl");

const page = fs.readFileSync(TOGGLE, "utf8");
const action = fs.readFileSync(ACTION, "utf8");
const pageRow = fs.readFileSync(PAGE, "utf8");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

// Field names the page-side toggle form emits (hidden inputs) — now in ToggleControl.
const pageFields = new Set([...page.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]));
// Field names the action reads via formValue(formData, "X").
const actionReads = new Set([...action.matchAll(/formValue\(formData,\s*"([a-zA-Z]+)"\)/g)].map((m) => m[1]));

check("page emits the toggle 'id' field", pageFields.has("id"));
check("page emits 'nextChecked' (the next desired state)", pageFields.has("nextChecked"));
check("page no longer emits the mismatched 'checked' field", !pageFields.has("checked"));
check("action reads 'id'", actionReads.has("id"));
check("action reads 'nextChecked'", actionReads.has("nextChecked"));
check(
  "CONTRACT: every field the action reads is emitted by the page",
  [...actionReads].every((f) => pageFields.has(f)),
);
check(
  "SECURITY: action does NOT read a client-submitted 'ownerClass' (authz must be server-derived)",
  !actionReads.has("ownerClass"),
);
check(
  "SECURITY: action derives owner_class server-side via the producer (buildReadinessReport + owner_class)",
  /buildReadinessReport/.test(action) && /owner_class/.test(action),
);
check(
  "the toggle control is a submit affordance (form action wired via useActionState)",
  /action=\{formAction\}/.test(page) && /type="submit"/.test(page),
);
check(
  "ToggleControl invokes the (unchanged) toggleReadinessItemAction",
  /toggleReadinessItemAction/.test(page),
);
check(
  "NEVER-SWALLOW: a { ok:false } toggle result renders inline (role=alert, aria-live)",
  /state\.ok === false/.test(page) &&
    /role="alert"/.test(page) &&
    /aria-live="polite"/.test(page),
);
check(
  "the page wires the toggle via <ToggleControl> (do-first + done rows)",
  /<ToggleControl\b/.test(pageRow),
);

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
