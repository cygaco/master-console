#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const cli = require("./cli");

const h = harness("events-cli");

const ARCHIVE_REL = ".claude/runtime/archive";
const GEN_REL = ".claude/runtime/archive/events.jsonl.gen1";
const IDX_REL = ".claude/runtime/archive/index.jsonl";
const LIVE_REL = ".claude/project/events/events.jsonl";

function capture(fn) {
  const out = [];
  const err = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => {
    out.push(String(s));
    return true;
  };
  process.stderr.write = (s) => {
    err.push(String(s));
    return true;
  };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { code, stdout: out.join(""), stderr: err.join("") };
}

const jsonl = (...objs) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";

const ARCHIVED_EVENTS = [
  { id: "EVT-a1", ts: "2026-07-18T01:00:00Z", type: "prompt", message: "archived-1" },
  { id: "EVT-a2", ts: "2026-07-18T02:00:00Z", type: "decision", message: "archived-2" },
];
const SUMMARY = {
  id: "EVT-sum",
  ts: "2026-07-18T03:00:00Z",
  cat: "audit",
  actor: "compactor",
  type: "compaction-summary",
  data: { event_count: 2, archived_generation_ref: GEN_REL },
};
const LIVE_TAIL = [
  { id: "EVT-t1", ts: "2026-07-18T04:00:00Z", type: "prompt", message: "live-tail-1" },
];

function healthyRoot() {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(SUMMARY, ...LIVE_TAIL),
      [GEN_REL]: jsonl(...ARCHIVED_EVENTS),
      [IDX_REL]: jsonl({
        ts: "2026-07-18T02:30:00Z",
        origin: LIVE_REL,
        archived: GEN_REL,
        reason: "compaction:fold",
        lines: 2,
      }),
    },
    "events-cli-healthy",
  );
  return fx;
}

h.test("healthy union: live ∪ archived, sorted by ts/id, redundant summary suppressed", () => {
  const fx = healthyRoot();
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.code, 0, "healthy tier exits 0");
    const emitted = cap.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const ids = emitted.map((e) => e.id);
    assert.deepStrictEqual(ids, ["EVT-a1", "EVT-a2", "EVT-t1"], "union complete + sorted by ts");
    assert.ok(
      !emitted.some((e) => e.type === "compaction-summary"),
      "the redundant compaction-summary is suppressed when its raw is present",
    );
  } finally {
    fx.cleanup();
  }
});

h.test("filters preserved across the union: --type filters BOTH tiers", () => {
  const fx = healthyRoot();
  try {
    const cap = capture(() =>
      cli.query([
        "--archive",
        "--root",
        fx.dir,
        "--source",
        fx.file(LIVE_REL),
        "--type=prompt",
        "--json",
      ]),
    );
    assert.strictEqual(cap.code, 0);
    const ids = cap.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).id);
    assert.deepStrictEqual(ids, ["EVT-a1", "EVT-t1"], "--type filters across live AND archived");
  } finally {
    fx.cleanup();
  }
});

h.violation("corrupt-dangling: index references a removed generation → non-zero, NO partial output", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(...LIVE_TAIL),
      [IDX_REL]: jsonl({ origin: LIVE_REL, archived: GEN_REL, reason: "compaction:fold" }),
    },
    "events-cli-dangling",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output on a corrupt/dangling tier");
    assert.ok(/corrupt|dangling|missing/i.test(cap.stderr), "explicit fail-closed stderr");
    assert.ok(/fail-closed/i.test(cap.stderr), "the fail-closed note is present");
    assert.notStrictEqual(cap.code, 0, "corrupt tier exits non-zero");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.violation("corrupt-unreadable index → non-zero, stdout empty", () => {
  const fx = sealedDir({ [LIVE_REL]: jsonl(...LIVE_TAIL) }, "events-cli-unreadable");
  try {
    fs.mkdirSync(fx.file(IDX_REL), { recursive: true });
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output on an unreadable index");
    assert.ok(/corrupt|unreadable/i.test(cap.stderr), "explicit stderr for unreadable index");
    assert.notStrictEqual(cap.code, 0, "unreadable index exits non-zero");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.violation("corrupt-unparseable index line → non-zero (STRICT; does NOT skip like readIndex)", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(...LIVE_TAIL),
      [IDX_REL]: "{ this is not json\n",
    },
    "events-cli-unparseable",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output on an unparseable index line");
    assert.ok(/unparseable|corrupt/i.test(cap.stderr), "explicit stderr for the strict-parse failure");
    assert.notStrictEqual(cap.code, 0, "an unparseable index line fails closed (non-zero)");
    const archive = require("../hooks/lib/archive");
    assert.strictEqual(
      archive.readIndex(fx.dir).length,
      0,
      "readIndex tolerates (skips) the torn line — the strict read path does NOT",
    );
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.test("cold-absent tier: no archive index → exit 0, live-only, 'no archive tier yet' note (distinct from corrupt)", () => {
  const fx = sealedDir({ [LIVE_REL]: jsonl(...LIVE_TAIL) }, "events-cli-cold");
  try {
    assert.ok(!fs.existsSync(fx.file(IDX_REL)), "precondition: no archive index exists");
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.code, 0, "COLD path exits 0 — an absent tier is NOT an error");
    const ids = cap.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).id);
    assert.deepStrictEqual(ids, ["EVT-t1"], "live-only output");
    assert.ok(/no archive tier yet/i.test(cap.stderr), "the distinct COLD note is present");
    assert.ok(!/fail-closed/i.test(cap.stderr), "COLD is NOT the fail-closed corrupt branch");
  } finally {
    fx.cleanup();
  }
});

h.test("backward-compat: query without --archive reads live-only and ignores the archive tier", () => {
  const fx = healthyRoot();
  try {
    const cap = capture(() =>
      cli.query(["--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.code, 0);
    const types = cap.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).type);
    assert.ok(types.includes("compaction-summary"), "no --archive → summary NOT suppressed");
    const ids = cap.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l).id);
    assert.ok(!ids.includes("EVT-a1"), "no --archive → archived raw is NOT unioned in");
  } finally {
    fx.cleanup();
  }
});

h.test("summary pointer: with no archive tier, a compaction-summary stays VISIBLE (not suppressed)", () => {
  const fx = sealedDir({ [LIVE_REL]: jsonl(SUMMARY, ...LIVE_TAIL) }, "events-cli-pointer");
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.code, 0, "cold tier → exit 0");
    const types = cap.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).type);
    assert.ok(
      types.includes("compaction-summary"),
      "a summary whose raw is genuinely absent stays visible as a pointer",
    );
  } finally {
    fx.cleanup();
  }
});

const GEN2_REL = ".claude/runtime/archive/events.jsonl.gen2";
h.violation("un-indexed generation on disk → fail-closed (never silently omit raw)", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(SUMMARY, ...LIVE_TAIL),
      [GEN_REL]: jsonl(...ARCHIVED_EVENTS),
      [GEN2_REL]: jsonl({ id: "EVT-orphan", ts: "2026-07-18T02:45:00Z", type: "prompt", message: "orphaned-raw" }),
      [IDX_REL]: jsonl({ origin: LIVE_REL, archived: GEN_REL, reason: "compaction:fold", lines: 2 }),
    },
    "events-cli-unindexed-gen",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output when raw exists on disk but is un-indexed");
    assert.ok(/un-indexed generation/i.test(cap.stderr), "explicit un-indexed-generation error");
    assert.notStrictEqual(cap.code, 0, "un-indexed raw on disk fails closed (non-zero)");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.test("union dedup: an event in both the live tail AND its archived generation appears once", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(SUMMARY, ARCHIVED_EVENTS[1], ...LIVE_TAIL),
      [GEN_REL]: jsonl(...ARCHIVED_EVENTS),
      [IDX_REL]: jsonl({ origin: LIVE_REL, archived: GEN_REL, reason: "compaction:fold", lines: 2 }),
    },
    "events-cli-dedup",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.code, 0);
    const ids = cap.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l).id);
    assert.strictEqual(ids.filter((x) => x === "EVT-a2").length, 1, "reseeded event deduped to a single copy");
    assert.deepStrictEqual(ids, ["EVT-a1", "EVT-a2", "EVT-t1"], "complete union, no duplicate");
  } finally {
    fx.cleanup();
  }
});

h.violation("unreadable live file → fail-closed (not a silent empty history)", () => {
  const fx = healthyRoot();
  try {
    fs.rmSync(fx.file(LIVE_REL), { force: true });
    fs.mkdirSync(fx.file(LIVE_REL), { recursive: true });
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output on an unreadable live file");
    assert.ok(/not a regular file|unreadable|inaccessible/i.test(cap.stderr), "explicit fail-closed stderr");
    assert.notStrictEqual(cap.code, 0, "unreadable live file fails closed (non-zero)");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

const DECOY_REL = "docs/events.jsonl.genX";
const REAL_GEN_REL = ".claude/runtime/archive/events.jsonl.genX";
h.violation("same-basename decoy does NOT cover an un-indexed archive generation → fail-closed", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(...LIVE_TAIL),
      [REAL_GEN_REL]: jsonl({ id: "EVT-realgen", ts: "2026-07-18T02:20:00Z", type: "prompt", message: "real-archived-raw" }),
      [DECOY_REL]: jsonl({ id: "EVT-decoy", ts: "2026-07-18T02:21:00Z", type: "prompt", message: "decoy" }),
      [IDX_REL]: jsonl({ origin: LIVE_REL, archived: DECOY_REL, reason: "compaction:fold", lines: 1 }),
    },
    "events-cli-basename-decoy",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO partial output — the archive-dir raw is un-indexed");
    assert.ok(
      /un-indexed generation|not inside the archive dir|decoy/i.test(cap.stderr),
      "path-aware fail-closed (decoy rejected and/or un-indexed generation flagged)",
    );
    assert.ok(!/EVT-realgen|EVT-decoy/.test(cap.stdout), "neither the real orphan nor the decoy is emitted");
    assert.notStrictEqual(cap.code, 0, "a same-basename decoy must NOT satisfy completeness (fail-closed)");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.violation("an indexed generation outside the archive dir is a decoy → fail-closed (not emitted as raw)", () => {
  const fx = sealedDir(
    {
      [LIVE_REL]: jsonl(...LIVE_TAIL),
      [DECOY_REL]: jsonl({ id: "EVT-decoy-only", ts: "2026-07-18T02:30:00Z", type: "prompt", message: "decoy-only" }),
      [IDX_REL]: jsonl({ origin: LIVE_REL, archived: DECOY_REL, reason: "compaction:fold", lines: 1 }),
    },
    "events-cli-decoy-only",
  );
  try {
    const cap = capture(() =>
      cli.query(["--archive", "--root", fx.dir, "--source", fx.file(LIVE_REL), "--json"]),
    );
    assert.strictEqual(cap.stdout, "", "NO output — the indexed generation is a decoy outside the archive dir");
    assert.ok(/not inside the archive dir|decoy/i.test(cap.stderr), "explicit decoy/out-of-archive-dir error");
    assert.ok(!/EVT-decoy-only/.test(cap.stdout), "the decoy event is NEVER emitted as raw");
    assert.notStrictEqual(cap.code, 0, "a decoy indexed generation fails closed (non-zero)");
    return cap.code;
  } finally {
    fx.cleanup();
  }
});

h.done();
