#!/usr/bin/env node
"use strict";
/**
 * skill-namespace.test.js — S-OS-06 T3 part 1c regression coverage (α Class-B ruling implementing R-2).
 *
 * The warpos->mc codemod never matched the short-form skill namespace `warp:`. Part 1c renames it
 * with an ENUMERATED alternation only. This file proves, on disposable fixtures (never the real tree):
 *   - the enumeration rewrites exactly the 14 skills + scan:warpos-<x>, and NOTHING else (`warp:promote`,
 *     `warp:checkout` stay verbatim and surface as the named residual);
 *   - the ledger's skill-namespace category is assigned only when the enumeration changes the line;
 *   - --apply-skill-namespace moves .claude/commands/warp/<skill>.md -> .claude/commands/mc/<skill>.md,
 *     rewrites Class-1 content (line endings preserved), and leaves Class-3/4 data, generated views,
 *     occurrence-pinned lines and CHANGELOG historical lines byte-identical;
 *   - it is idempotent, and it refuses (touching nothing) when a skill move is refused.
 *
 *   node --test tests/regression/S-OS-06/skill-namespace.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const H = require("./falsifier-harness");

const RENAME_MC = require(path.join(H.REAL_ROOT, "scripts", "open-source", "rename-mc.js"));

const LEGACY_SCAN = `scan:${H.SLUG}-staleness`;

test("1c enumeration: rewrites exactly the enumerated skills + scan:<legacy>-<x>, nothing else", () => {
  const rw = RENAME_MC.rewriteSkillNamespaceTokens;
  assert.deepStrictEqual(RENAME_MC.SKILL_NAMESPACE_SKILLS.length, 14);
  for (const s of RENAME_MC.SKILL_NAMESPACE_SKILLS) assert.strictEqual(rw(`run /warp:${s} now`), `run /mc:${s} now`);
  assert.strictEqual(rw("/warp:promote"), "/warp:promote", "a non-enumerated skill is never rewritten (no bare prefix)");
  assert.strictEqual(rw("/warp:checkout"), "/warp:checkout", "a longer word sharing an enumerated prefix is untouched");
  assert.strictEqual(rw(`/${LEGACY_SCAN}`), "/scan:mc-staleness");
  assert.strictEqual(rw("/mc:check /scan:mc-staleness"), "/mc:check /scan:mc-staleness", "idempotent on already-renamed tokens");
  assert.strictEqual(rw("/warp:update-managed"), "/mc:update-managed", "the ruling's \\b boundary treats '-' as a boundary (reported as hyphenJoined)");

  assert.strictEqual(RENAME_MC.rewriteSkillPathRefs("x .claude/commands/warp/release.md y"), "x .claude/commands/mc/release.md y");
  assert.strictEqual(RENAME_MC.rewriteSkillPathRefs(".claude/commands/warp/promote.md"), ".claude/commands/warp/promote.md");

  assert.strictEqual(RENAME_MC.skillPathRename(".claude/commands/warp/check.md"), ".claude/commands/mc/check.md");
  assert.strictEqual(RENAME_MC.skillPathRename(".claude/commands/warp/promote.md"), ".claude/commands/warp/promote.md");
  assert.strictEqual(RENAME_MC.skillPathRename(".claude/commands/warp/check.md.bak"), ".claude/commands/warp/check.md.bak");

  assert.deepStrictEqual(RENAME_MC.residualWarpTokens("/warp:promote and /warp:check"), ["warp:promote"]);
});

test("1c ledger honesty: skill-namespace category only when the enumeration changes the line", () => {
  const cat = RENAME_MC.categorizeOccurrence;
  assert.notStrictEqual(cat("docs/x.md", `${H.SLUG} docs mention /warp:promote`), "skill-namespace");
  assert.strictEqual(cat("docs/x.md", `${H.SLUG} docs mention /warp:check`), "skill-namespace");
  assert.strictEqual(cat("docs/x.md", `run /${LEGACY_SCAN}`), "skill-namespace");
});

const FIXTURE_FILES = {
  ".claude/commands/warp/check.md": `# /warp:check\r\nsee /warp:promote and /${LEGACY_SCAN}\r\n`,
  ".claude/commands/warp/promote.md": "# /warp:promote\n",
  "src/gate.js": 'const ALLOW = { ".claude/commands/warp/check.md": 1, ".claude/commands/warp/promote.md": 2 };\n',
  "src/paths.js": `const LEGACY_HOME_SEGMENT = ".${H.SLUG}"; // compat fallback read, see /warp:setup\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`,
  "history/skills.md": "ran /warp:check\n",
  "migrations/1.2.0-to-2.0.0/skills.js": 'const FROM = "/warp:update";\n',
  "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n- /warp:update\n\n## [1.0.0]\n- /warp:update\n",
  ".claude/paths.json": `{ "templates": "_${H.SLUG}/templates", "skill": "/warp:check" }\n`,
};

function skillLine(stdout) {
  const m = stdout.match(/^\s*skill-namespace \(enumerated[^)]*\): (.*)$/m);
  assert.ok(m, `dry-run prints the skill-namespace counter line:\n${stdout}`);
  return Object.fromEntries(m[1].trim().split(/\s+/).map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
}

test("1c --dry-run counts + --apply-skill-namespace: moves, rewrites Class-1, preserves every protected byte, idempotent", () => {
  H.withFixture({ extraFiles: FIXTURE_FILES }, (fx) => {
    const before = {};
    // src/paths.js is NO LONGER fully verbatim under β R1b occurrence-grain: its pinned ".warpos" is
    // preserved, but the unrelated live /warp:setup doc-ref in the same comment now rewrites to /mc:setup
    // (an unrelated pin no longer freezes the whole line). Asserted explicitly below.
    for (const rel of ["history/skills.md", "migrations/1.2.0-to-2.0.0/skills.js", ".claude/paths.json", ".claude/commands/warp/promote.md"]) {
      before[rel] = fx.read(rel);
    }

    const dry = fx.runCodemod(["--dry-run"]);
    assert.strictEqual(dry.status, 0, dry.out);
    assert.deepStrictEqual(skillLine(dry.stdout), {
      pathMoves: 1,
      refusedSkillMoves: 0,
      tokensRewritable: 4, // check.md /warp:check + scan:<legacy>-staleness, CHANGELOG [Unreleased] /warp:update, src/paths.js /warp:setup (β R1b: no longer frozen by the .warpos pin on its line)
      pathRefsRewritable: 1, // src/gate.js
      filesRewritable: 4,
      verbatimTokens: 1, // CHANGELOG [1.0.0] line (the .warpos pin on src/paths.js no longer freezes the whole line — occurrence-grain)
      derivedViewTokens: 1, // .claude/paths.json
      keptNonClass1Tokens: 2, // history/** (4) + migrations/1.2.0-to-2.0.0/** (3)
      hyphenJoined: 0,
      otherWarpResidual: 2, // warp:promote in check.md + promote.md
    });

    const apply = fx.runCodemod(["--apply-skill-namespace"]);
    assert.strictEqual(apply.status, 0, apply.out);
    assert.match(apply.stdout, /moved=1 filesRewritten=4 tokensRewritten=4 pathRefsRewritten=1/);
    // β R1b occurrence-grain: src/paths.js keeps its pinned ".warpos" byte AND rewrites the unrelated /warp:setup.
    assert.strictEqual(
      fx.read("src/paths.js"),
      `const LEGACY_HOME_SEGMENT = ".${H.SLUG}"; // compat fallback read, see /mc:setup\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`,
      "the pinned .warpos is preserved; the unrelated /warp:setup skill ref is rewritten (occurrence-grain)"
    );

    assert.ok(!fx.exists(".claude/commands/warp/check.md") && fx.exists(".claude/commands/mc/check.md"), "the enumerated skill moved");
    assert.strictEqual(fx.read(".claude/commands/mc/check.md"), "# /mc:check\r\nsee /warp:promote and /scan:mc-staleness\r\n", "CRLF preserved; residual untouched");
    assert.match(fx.git(["status", "--porcelain"]).stdout, /^R. \.claude\/commands\/warp\/check\.md -> \.claude\/commands\/mc\/check\.md$/m, "moved with git mv");
    assert.strictEqual(
      fx.read("src/gate.js"),
      'const ALLOW = { ".claude/commands/mc/check.md": 1, ".claude/commands/warp/promote.md": 2 };\n',
      "path refs follow the enumerated move only"
    );
    assert.strictEqual(fx.read("CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n- /mc:update\n\n## [1.0.0]\n- /warp:update\n");
    for (const [rel, content] of Object.entries(before)) assert.strictEqual(fx.read(rel), content, `${rel} is byte-identical`);

    const again = fx.runCodemod(["--apply-skill-namespace"]);
    assert.strictEqual(again.status, 0, again.out);
    assert.match(again.stdout, /moved=0 filesRewritten=0 tokensRewritten=0 pathRefsRewritten=0/, "idempotent");

    const post = skillLine(fx.runCodemod(["--dry-run"]).stdout);
    assert.strictEqual(post.tokensRewritable, 0);
    assert.strictEqual(post.pathMoves, 0);
    assert.strictEqual(post.otherWarpResidual, 2, "the named residual survives, verbatim");
  });
});

test("1c refusal: a refused skill move (target exists / write-protected source) refuses the whole apply and touches nothing", () => {
  H.withFixture(
    {
      extraFiles: { ".claude/commands/warp/diff.md": "# /warp:diff\n", ".claude/commands/mc/diff.md": "# /mc:diff\n", "src/a.md": "/warp:diff\n" },
    },
    (fx) => {
      const r = fx.runCodemod(["--apply-skill-namespace"]);
      assert.notStrictEqual(r.status, 0, r.out);
      assert.match(r.out, /refused: \.claude\/commands\/warp\/diff\.md -> \.claude\/commands\/mc\/diff\.md \[target-exists\]/);
      assert.strictEqual(fx.trackedDirty(), "", "nothing touched");
    }
  );
  H.withFixture(
    {
      extraFiles: { ".claude/commands/warp/tour.md": "# /warp:tour\n" },
      partition: H.basePartition({
        mutate: (p) => p.pathGlobs.push({ pattern: ".claude/commands/warp/tour.md", class: 2, writeProtected: true, warrant: "fixture operator-gated skill" }),
      }),
    },
    (fx) => {
      const r = fx.runCodemod(["--apply-skill-namespace"]);
      assert.notStrictEqual(r.status, 0, r.out);
      assert.match(r.out, /\[source-write-protected\]/);
      assert.strictEqual(fx.trackedDirty(), "", "nothing touched");
    }
  );
});
