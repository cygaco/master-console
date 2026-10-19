"use strict";
// FALSIFIER: controller-di-seam-creep — record-trust gate. The STRUCTURAL creep-back guard.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CONTROLLER = path.join(__dirname, "..", "trusted-controller.js");

const FORBIDDEN_SEAMS = Object.freeze([
  "hookLivenessCheckFn",
  "materializeResultTreeFn",
  "materializedTreeResolver",
  "treeResolver",
  "commitResolver",
  "ancestryResolver",
  "leaseTokenResolver",
  "checkLibSrcRoot",
  "liveHead",
  "checkContext",
]);

function extractFunctionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `expected a top-level 'function ${name}(' in trusted-controller.js`);
  const parenOpen = src.indexOf("(", start);
  let pdepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < src.length; i++) {
    if (src[i] === "(") pdepth++;
    else if (src[i] === ")") {
      pdepth--;
      if (pdepth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  assert.notStrictEqual(parenClose, -1, `unterminated parameter list for ${name}`);
  const open = src.indexOf("{", parenClose);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function body for ${name}`);
}

test("controller-di-seam-creep — PRODUCTION_OPT_KEYS is the EXACT, frozen allowlist (a new key here is a deliberate, reviewed change — never a silent one)", () => {
  const ctl = require("../trusted-controller");

  assert.ok(Object.isFrozen(ctl.PRODUCTION_OPT_KEYS), "the allowlist must be frozen");
  assert.deepStrictEqual(
    ctl.PRODUCTION_OPT_KEYS.slice().sort(),
    ["bundleManifestPath", "bundleRoot", "candidateRoot", "gitRoot", "leaseRoot", "performRefUpdate", "spId"],
    "MUST-BLOCK: the production opts surface changed — if a seam was added, this is the creep-back this guard exists to catch",
  );
  for (const seam of FORBIDDEN_SEAMS) {
    assert.ok(!ctl.PRODUCTION_OPT_KEYS.includes(seam), `MUST-BLOCK: '${seam}' must never be a production opts key`);
  }
});

test("controller-di-seam-creep — sanitizeOpts DROPS every non-allowlisted key, including function seams and Symbol keys", () => {
  const ctl = require("../trusted-controller");

  const hostile = { gitRoot: "/g", bundleRoot: "/b", nope: 1 };
  for (const seam of FORBIDDEN_SEAMS) hostile[seam] = () => ({ ok: true });
  hostile[Symbol.for("mc.test.seams")] = { hookLivenessCheck: () => ({ ok: true }) };

  const clean = ctl.sanitizeOpts(hostile);
  assert.deepStrictEqual(Object.keys(clean).sort(), ["bundleRoot", "gitRoot"]);
  assert.strictEqual(Object.getOwnPropertySymbols(clean).length, 0, "MUST-BLOCK: a Symbol-keyed channel must not survive sanitization either");
  for (const seam of FORBIDDEN_SEAMS) {
    assert.ok(!(seam in clean), `MUST-BLOCK: '${seam}' survived sanitizeOpts`);
  }

  const proto = { gitRoot: "/inherited", hookLivenessCheckFn: () => ({ ok: true }) };
  assert.deepStrictEqual(ctl.sanitizeOpts(Object.create(proto)), {});
});

test("controller-di-seam-creep — SOURCE SCAN: integrateInternal reads NO opts key outside PRODUCTION_OPT_KEYS, and never touches a raw caller `opts` object", () => {
  const ctl = require("../trusted-controller");
  const src = fs.readFileSync(CONTROLLER, "utf8");
  const body = extractFunctionSource(src, "integrateInternal");

  const reads = new Set();
  const re = /\bo\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(body))) reads.add(m[1]);
  const illegal = [...reads].filter((k) => !ctl.PRODUCTION_OPT_KEYS.includes(k));
  assert.deepStrictEqual(illegal, [], `MUST-BLOCK: integrateInternal reads non-allowlisted opts key(s) ${JSON.stringify(illegal)} — a new caller-suppliable seam crept back in`);

  assert.ok(reads.size >= 4, `the source scan must actually observe opts reads (found ${reads.size})`);

  assert.ok(!/\bopts\s*\./.test(body), "MUST-BLOCK: integrateInternal dereferences a raw `opts` object — it must only ever read the SANITIZED copy");

  const pub = extractFunctionSource(src, "integrate");
  assert.ok(/sanitizeOpts\(opts\)/.test(pub), "MUST-BLOCK: integrate() must sanitize its caller opts");
  assert.ok(/REAL_SEAMS/.test(pub), "MUST-BLOCK: integrate() must be hard-wired to REAL_SEAMS");
  for (const seam of FORBIDDEN_SEAMS) {
    assert.ok(!new RegExp(`opts\\.${seam}\\b`).test(pub), `MUST-BLOCK: integrate() reads opts.${seam}`);
  }
});

test("controller-di-seam-creep — helm-runner forwards an ALLOWLISTED controllerOpts subset only (no function seam can transit the aggregate entrypoint)", () => {
  const hr = require("../helm-runner");

  assert.ok(Object.isFrozen(hr.CONTROLLER_OPT_ALLOWLIST), "the helm-runner allowlist must be frozen");
  for (const seam of FORBIDDEN_SEAMS) {
    assert.ok(!hr.CONTROLLER_OPT_ALLOWLIST.includes(seam), `MUST-BLOCK: helm-runner forwards '${seam}'`);
  }
  assert.ok(!hr.CONTROLLER_OPT_ALLOWLIST.includes("performRefUpdate"), "performRefUpdate is FORCED, never forwarded from the caller");

  const hostile = { gitRoot: "/g", bundleManifestPath: "/m", evil: true };
  for (const seam of FORBIDDEN_SEAMS) hostile[seam] = () => ({ ok: true });

  let seen = null;
  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  hr.runHelms(
    { profile: "panel-2family", lanes, integrate: { base_commit: "b", result_commit: "r", target_ref: "refs/heads/x" } },
    {
      controllerOpts: hostile,
      integrateFn: (input, opts) => {
        seen = opts;
        return { ok: true, decision: "INTEGRATED", receipt: { committed_head: "r" } };
      },
    },
  );
  assert.ok(seen, "the integrate seam must have been driven");
  assert.deepStrictEqual(Object.keys(seen).sort(), ["bundleManifestPath", "gitRoot", "performRefUpdate"]);
  assert.strictEqual(seen.performRefUpdate, true, "performRefUpdate stays FORCED true");
  for (const seam of FORBIDDEN_SEAMS) {
    assert.ok(!(seam in seen), `MUST-BLOCK: '${seam}' transited helm-runner into the controller`);
  }
  assert.ok(!("evil" in seen), "MUST-BLOCK: an unknown key transited helm-runner into the controller");
});
