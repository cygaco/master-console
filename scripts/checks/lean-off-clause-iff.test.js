'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOC_FILES = [
  '.claude/agents/president/epsilon.md',
  '.claude/agents/_system/guides/agent-dispatch-guide.md',
  '.claude/agents/engineering/backend/reviewer.md',
  '.claude/agents/engineering/frontend/reviewer.md',
];
const CHANGELOG = 'CHANGELOG.md';
const OPEN = '<!-- lean-off-clause -->';
const CLOSE = '<!-- /lean-off-clause -->';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const onOwnLine = (hay, marker) => new RegExp('(^|\\n)[ \\t]*' + esc(marker) + '[ \\t]*(\\n|$)').test(hay);
function unreleasedSection(clog) {
  const m = clog.match(/\n## \[Unreleased\]([\s\S]*?)(?=\n## \[)/);
  return m ? m[1] : '';
}
function readDocOrNull(rel, readFile) {
  const read = readFile || ((p) => fs.readFileSync(p, 'utf8'));
  try {
    return read(path.join(ROOT, rel));
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function checkLeanOffClause(leanAuto, population) {
  const off = leanAuto === false;
  const violations = [];
  const docs = population.docs || {};
  const clogRaw = population.changelog;
  const listed = [
    ...Object.keys(docs).map((f) => [f, docs[f]]),
    ['CHANGELOG.md', clogRaw === undefined ? null : clogRaw],
  ];
  const present = listed.filter(([, t]) => t !== null && t !== undefined);
  const absent = listed.filter(([, t]) => t === null || t === undefined);
  const read = `${present.length} of ${listed.length} docs read`;
  if (present.length === 0) return { violations, skipped: true, read };
  for (const [f] of absent) violations.push(`listed doc missing: ${f} (partial population — ${read}; a stale list or a deleted doc must not silently shrink the iff check)`);
  for (const [f, t] of present) {
    if (f === 'CHANGELOG.md') {
      const unrel = unreleasedSection(t);
      const p = unrel.includes(OPEN);
      if (p !== off) violations.push(`CHANGELOG [Unreleased]: off-clause present=${p} but DEFAULTS.leanAuto===false is ${off}`);
      if (off && p) {
        if (!onOwnLine(unrel, OPEN)) violations.push('CHANGELOG [Unreleased]: open marker not on its own line');
        if (!onOwnLine(unrel, CLOSE)) violations.push('CHANGELOG [Unreleased]: close marker not on its own line');
      }
      const releasedOnly = t.replace(/\n## \[Unreleased\][\s\S]*?(?=\n## \[)/, '\n');
      if (releasedOnly.includes(OPEN)) violations.push('CHANGELOG: off-clause marker in a RELEASED section (must be [Unreleased]-only)');
    } else {
      const p = t.includes(OPEN);
      if (p !== off) violations.push(`${f}: off-clause present=${p} but DEFAULTS.leanAuto===false is ${off} (docs/code drift)`);
      if (off && p) {
        if (!onOwnLine(t, OPEN)) violations.push(`${f}: open marker not on its own line (CommonMark raw-HTML-block hazard)`);
        if (!onOwnLine(t, CLOSE)) violations.push(`${f}: close marker not on its own line`);
      }
      if (!off && t.includes(CLOSE)) violations.push(`${f}: close marker still present while leanAuto is ON`);
    }
  }
  return { violations, skipped: false, read };
}

test('live tree: lean-off-clause present IFF DEFAULTS.leanAuto===false', () => {
  const gd = require(path.join(ROOT, 'scripts', 'sprint', 'gauntlet-decision.js'));
  const rd = (rel) => readDocOrNull(rel);
  const population = { docs: Object.fromEntries(DOC_FILES.map((f) => [f, rd(f)])), changelog: rd(CHANGELOG) };
  const { violations, skipped, read } = checkLeanOffClause(gd.DEFAULTS.leanAuto, population);
  console.log(`[lean-off-clause-iff] ${read}`);
  if (skipped) { console.log('SKIP [lean-off-clause-iff] no doc population present — nothing to enforce'); return; }
  assert.deepStrictEqual(violations, [], `lean-off-clause drift (${read}):\n${violations.join('\n')}`);
});

const ownLineClause = `prose before\n\n${OPEN}\nnarrowing is off in shipped code until the S-LEAN-01 flip.\n${CLOSE}\n\nprose after`;
test('RED: a clause present while leanAuto===true is flagged', () => {
  const r = checkLeanOffClause(true, { docs: { 'd.md': ownLineClause }, changelog: null });
  assert.ok(r.violations.some((v) => /present=true but.*false is false|still present while leanAuto is ON/.test(v)), JSON.stringify(r.violations));
});
test('RED: a clause ABSENT while leanAuto===false is flagged', () => {
  const r = checkLeanOffClause(false, { docs: { 'd.md': 'no marker here' }, changelog: null });
  assert.ok(r.violations.some((v) => /present=false but.*false is true/.test(v)), JSON.stringify(r.violations));
});
test('RED: an INLINE (not own-line) marker while leanAuto===false is flagged', () => {
  const inline = `text ${OPEN}clause${CLOSE} more text`;
  const r = checkLeanOffClause(false, { docs: { 'd.md': inline }, changelog: null });
  assert.ok(r.violations.some((v) => /not on its own line/.test(v)), JSON.stringify(r.violations));
});
test('RED: a marker in a RELEASED CHANGELOG section is flagged', () => {
  const clog = `# CL\n\n## [Unreleased]\n\n(empty)\n\n## [2.1.0]\n\n${OPEN}\nx\n${CLOSE}\n\n## [2.0.0]\n`;
  const r = checkLeanOffClause(true, { docs: {}, changelog: clog });
  assert.ok(r.violations.some((v) => /RELEASED section/.test(v)), JSON.stringify(r.violations));
});
test('GREEN control: own-line clause present while leanAuto===false → no violation', () => {
  const clog = `# CL\n\n## [Unreleased]\n\n${OPEN}\n- narrowing is off until the flip.\n${CLOSE}\n\n## [2.1.0]\n\nx\n`;
  const r = checkLeanOffClause(false, { docs: { 'd.md': ownLineClause }, changelog: clog });
  assert.deepStrictEqual(r.violations, [], JSON.stringify(r.violations));
});
test('SKIP: EVERY listed doc absent (ENOENT) → skipped, no violations, "0 of N docs read"', () => {
  const r = checkLeanOffClause(true, { docs: { 'a.md': null, 'b.md': null }, changelog: null });
  assert.strictEqual(r.skipped, true);
  assert.deepStrictEqual(r.violations, []);
  assert.match(r.read, /^0 of 3 docs read$/);
});
test('FAIL (partial population): one listed doc ENOENT while others present → "listed doc missing: <path>", NOT a silent shrink', () => {
  const r = checkLeanOffClause(true, { docs: { 'a.md': 'no marker', 'b.md': null }, changelog: 'cl' });
  assert.strictEqual(r.skipped, false);
  assert.ok(r.violations.some((v) => /listed doc missing: b\.md/.test(v)), JSON.stringify(r.violations));
  assert.match(r.read, /^2 of 3 docs read$/);
});
test('readDocOrNull-driven MIXED: b.md ENOENT, a.md present → the built population is partial → FAIL', () => {
  const reader = (p) => {
    if (/b\.md$/.test(p)) { const e = new Error('nope'); e.code = 'ENOENT'; throw e; }
    return 'present';
  };
  const population = { docs: { 'a.md': readDocOrNull('a.md', reader), 'b.md': readDocOrNull('b.md', reader) }, changelog: 'cl' };
  const r = checkLeanOffClause(true, population);
  assert.ok(r.violations.some((v) => /listed doc missing: b\.md/.test(v)), JSON.stringify(r.violations));
});
test('readDocOrNull: a genuinely ABSENT doc (ENOENT) returns null (skip-eligible)', () => {
  const enoent = () => { const e = new Error('no file'); e.code = 'ENOENT'; throw e; };
  assert.strictEqual(readDocOrNull('nope.md', enoent), null);
});
test('readDocOrNull: a present-but-UNREADABLE doc (non-ENOENT) THROWS — fail-closed, never a vacuous skip', () => {
  for (const code of ['EACCES', 'EISDIR', 'EIO']) {
    const err = () => { const e = new Error(code); e.code = code; throw e; };
    assert.throws(() => readDocOrNull('present.md', err), (e) => e && e.code === code, `${code} must propagate, not become null`);
  }
});

module.exports = { checkLeanOffClause, readDocOrNull };
