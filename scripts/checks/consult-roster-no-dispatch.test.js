#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { harness } = require("./lib/fixture-harness");
const { evaluate } = require("./consult-roster-no-dispatch");

const h = harness("consult-roster-no-dispatch");

const reg = {
  roles: {
    "director-of-engineering": { spec: "specs/doe.md" },
    "product-lead": { spec: "specs/pl.md" },
    "quality-lead": { spec: "specs/ql.md" },
    "backend-builder": { spec: "specs/bb.md" },
    "evil-consult": { spec: "specs/evil.md" },
  },
};
const hp = {
  attachments: [
    { role: "director-of-engineering", step: "design" },
    { role: "product-lead", step: "plan" },
    { role: "quality-lead", step: "design" },
    { role: "backend-builder", step: "build" },
    { role: "evil-consult", step: "design" },
  ],
};
const tools = (map) => (spec) => new Set(map[spec] || []);
const READONLY = ["read", "grep", "glob"];
const WITH_AGENT = ["read", "grep", "glob", "agent"];
const WITH_BASH = ["read", "grep", "glob", "bash"];

h.test("honest-RED: quality-lead's exemption is a known-open-hole (ok:false, NOT green-with-exemption)", () => {
  const r = evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": WITH_AGENT,
      "specs/bb.md": WITH_BASH,
      "specs/evil.md": READONLY,
    }),
  });
  assert(r.ok === false, "a documented exemption must read RED (ok:false) — never green-with-exemption");
  assert(r.cleanOfNewViolations === true, "no NEW (untracked) cascade hole — only the known one");
  assert(r.violations.length === 0, "no new violations");
  assert(r.knownOpenHoles === 1, "exactly one known open hole (quality-lead)");
  assert(r.exemptions.some((e) => e.role === "quality-lead"), "quality-lead reported as the open hole (not silent)");
});

h.pass("truly clean: NO consult role carries a dispatch tool => ok:true (the only green)", () =>
  evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": READONLY,
      "specs/bb.md": WITH_BASH,
      "specs/evil.md": READONLY,
    }),
  }));

h.violation("a consult role's spec gaining `Agent` is FLAGGED (the cascade hole)", () =>
  evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": WITH_AGENT,
      "specs/bb.md": WITH_BASH,
      "specs/evil.md": WITH_AGENT,
    }),
  }));

h.violation("a consult role's spec gaining `Bash` is FLAGGED", () =>
  evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": WITH_AGENT,
      "specs/bb.md": WITH_BASH,
      "specs/evil.md": WITH_BASH,
    }),
  }));

h.test("the planted violation names the offending consult role, exempts quality-lead", () => {
  const r = evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": WITH_AGENT,
      "specs/bb.md": READONLY,
      "specs/evil.md": WITH_AGENT,
    }),
  });
  assert(r.ok === false, "must be ok:false");
  assert(r.violations.length === 1, "exactly one violation");
  assert(r.violations[0].role === "evil-consult", "names evil-consult");
  assert(r.exemptions.some((e) => e.role === "quality-lead"), "quality-lead reported as exemption (not silent)");
});

h.test("a builder with Bash at the BUILD step is NOT flagged (consult-scoped)", () => {
  const r = evaluate({
    regDoc: reg,
    hpDoc: hp,
    toolReader: tools({
      "specs/doe.md": READONLY,
      "specs/pl.md": READONLY,
      "specs/ql.md": WITH_AGENT,
      "specs/bb.md": ["read", "grep", "glob", "bash", "edit", "write"],
      "specs/evil.md": READONLY,
    }),
  });
  assert(r.cleanOfNewViolations === true, "a builder at the build step does not add a NEW consult violation");
  assert(r.violations.length === 0, "no consult violations from a build-step role");
});

h.violation("a consult role pointing at a MISSING spec is FLAGGED (fail-closed, not green)", () =>
  evaluate({
    regDoc: { roles: { "ghost-consult": { spec: "specs/does-not-exist-xyz.md" } } },
    hpDoc: { attachments: [{ role: "ghost-consult", step: "design" }] },
  }));
h.violation("a consult role ABSENT from the registry is FLAGGED (fail-closed)", () =>
  evaluate({
    regDoc: { roles: {} },
    hpDoc: { attachments: [{ role: "unregistered-consult", step: "plan" }] },
  }));
h.violation("a consult role with NO spec field is FLAGGED (fail-closed)", () =>
  evaluate({
    regDoc: { roles: { "no-spec-consult": {} } },
    hpDoc: { attachments: [{ role: "no-spec-consult", step: "design" }] },
  }));

h.test("a YAML block-list `tools:` with Bash is detected (not missed)", () => {
  const { readSpecTools } = require("./consult-roster-no-dispatch");
  const fx = h.sealedDir({
    "block.md": "---\nname: x\ntools:\n  - Read\n  - Grep\n  - Bash\n---\n# body\n",
    "inline.md": "---\nname: y\ntools: [Read, Grep, Glob]\n---\n# body\n",
  });
  try {
    const block = readSpecTools(fx.file("block.md"));
    assert(block.determined === true, "block form is determined");
    assert(block.tools.has("bash"), "block-list Bash is detected");
    const inline = readSpecTools(fx.file("inline.md"));
    assert(inline.determined === true && inline.tools.has("glob") && !inline.tools.has("bash"), "inline bracket form parses");
  } finally {
    fx.cleanup();
  }
});

h.test("a body-prose `tools: Bash` line is IGNORED; only frontmatter tools count", () => {
  const { readSpecTools } = require("./consult-roster-no-dispatch");
  const fx = h.sealedDir({
    "bodytools.md": "---\nname: x\ntools: [Read, Grep, Glob]\n---\n# body\nYou may use tools: Bash and Agent when running checks.\n",
    "fmbash.md": "---\nname: y\ntools: [Read, Grep, Bash]\n---\n# body, no tools line\n",
  });
  try {
    const body = readSpecTools(fx.file("bodytools.md"));
    assert(body.determined === true, "frontmatter present → determined");
    assert(!body.tools.has("bash") && !body.tools.has("agent"), "the BODY tools: Bash/Agent line is NOT read (frontmatter-bounded)");
    const fmbash = readSpecTools(fx.file("fmbash.md"));
    assert(fmbash.tools.has("bash"), "a Bash IN the frontmatter IS read");
  } finally {
    fx.cleanup();
  }
});
h.test("an UNFENCED spec with a body `tools:` line is UNCONFIRMABLE (fail-closed), not false-clean", () => {
  const { readSpecTools } = require("./consult-roster-no-dispatch");
  const fx = h.sealedDir({
    "nofm.md": "# A spec with NO frontmatter fence\nSome prose. tools: Read, Grep — but this is the BODY.\n",
    "agentslist.md": "# spec\n(Tools: Read, Grep, Glob)\n",
  });
  try {
    const nofm = readSpecTools(fx.file("nofm.md"));
    assert(nofm.determined === false, "an unfenced body `tools:` line is NOT a confirmable grant (fail-closed)");
    const r = evaluate({
      regDoc: { roles: { "nofm-consult": { spec: fx.file("nofm.md") } } },
      hpDoc: { attachments: [{ role: "nofm-consult", step: "design" }] },
    });
    assert(r.ok === false, "an unconfirmable unfenced spec at a consult step => violation (fail-closed)");
    const al = readSpecTools(fx.file("agentslist.md"));
    assert(al.determined === true && al.tools.has("read") && !al.tools.has("bash"), "the (Tools:) agents-list form parses (whole-file)");
  } finally {
    fx.cleanup();
  }
});

h.pass("a consult role with a tool CONTAINING 'agent' (e.g. 'subagent') is NOT flagged (token equality)", () =>
  evaluate({
    regDoc: { roles: { "sub-consult": { spec: "specs/sc.md" } } },
    hpDoc: { attachments: [{ role: "sub-consult", step: "design" }] },
    toolReader: () => new Set(["read", "grep", "glob", "subagent"]),
  }));
h.violation("a consult role with a `*` catch-all tool-set is FLAGGED (includes Bash/Agent)", () =>
  evaluate({
    regDoc: { roles: { "star-consult": { spec: "specs/star.md" } } },
    hpDoc: { attachments: [{ role: "star-consult", step: "design" }] },
    toolReader: () => new Set(["*"]),
  }));

h.test("FAIL-CLOSED: the CLI exits 2 (not 0) when run() can't read the registry", () => {
  const { spawnSync } = require("child_process");
  const os = require("os");
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "no-registry-"));
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "consult-roster-no-dispatch.js"), "--json"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: emptyRoot },
      encoding: "utf8",
      timeout: 15000,
    });
    assert(r.status === 2, `expected fail-closed exit 2, got ${r.status} (a scanner that can't read its inputs must NOT exit 0/green)`);
    const out = JSON.parse(r.stdout || "{}");
    assert(out.ok === false, "fail-closed JSON must report ok:false");
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});
h.pass("evaluate with no consult roles is vacuously clean (zero roles ≠ a hole)", () =>
  evaluate({ regDoc: { roles: {} }, hpDoc: { attachments: [] } }));

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

h.done();
