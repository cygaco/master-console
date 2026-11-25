'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const STATUS = path.join(__dirname, 'status.js');
const HOOKS = path.join(ROOT, 'scripts', 'hooks');
const SESSION = path.join(HOOKS, 'plain-session.js');
const PROMPT = path.join(HOOKS, 'plain-prompt.js');
const GUARD = path.join(HOOKS, 'plain-guard.js');
const VIEW = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'paths.json'), 'utf8').replace(/^﻿/, ''));

const TEMP = [];
test.after(() => { for (const d of TEMP) fs.rmSync(d, { recursive: true, force: true }); });
const tempDir = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMP.push(d); return d; };

const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/PLAIN_(OFF|HOME)$/i.test(k) && k !== 'CLAUDE_PROJECT_DIR'));
const EMPTY_HOME = tempDir('plain-status-home-');

const SKILLS = {
  'db/migrate.md': '---\ndescription: Apply pending database migrations to the local database.\nargument-hint: <target version>\n---\n',
  'db/wipe.md': '---\ndescription: Wipe the local database and start from an empty schema.\n---\n',
  'roadmap/add.md': '---\ndescription: Add an item to the project roadmap.\n---\n',
  'git/push.md': '---\ndescription: Pushes the current branch to the remote.\n---\n',
};
const MANIFEST = { $schema: 'mc/manifest/v1', project: { name: 'fixture' }, mc: { version: '0.0.0', installed: true } };

function project({ manifest = MANIFEST, manifestText = null, settings = true } = {}) {
  const dir = tempDir('plain-status-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'paths.json'), path.join(dir, '.claude', 'paths.json'));
  if (settings) fs.copyFileSync(path.join(ROOT, VIEW.settings), path.join(dir, VIEW.settings));
  for (const [rel, body] of Object.entries(SKILLS)) {
    const p = path.join(dir, VIEW.commands, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  if (manifestText != null) fs.writeFileSync(path.join(dir, VIEW.manifest), manifestText);
  else if (manifest) fs.writeFileSync(path.join(dir, VIEW.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

function run(file, args, { input = '', env = {}, dir } = {}) {
  const r = spawnSync(process.execPath, [file, ...args], {
    input,
    env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: dir, MC_PLAIN_HOME: EMPTY_HOME, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const plain = (dir, args = [], env = {}) => run(STATUS, [...args, '--root', dir], { dir, env });
const context = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
const sessionHook = (dir, env) => run(SESSION, [], { dir, env, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1', cwd: dir }) });
const promptHook = (dir, prompt, env) => run(PROMPT, [], { dir, env, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: dir, prompt }) });
const guardHook = (dir, skill, env) => run(GUARD, [], { dir, env, input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: dir, tool_name: 'Skill', tool_input: { skill } }) });
const manifestOf = (dir) => fs.readFileSync(path.join(dir, VIEW.manifest), 'utf8');

test('status on a fresh tree: routing on by default, the guard on, the map and the skill counts, nothing written', () => {
  const dir = project();
  const r = plain(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.ok(out.startsWith(`Plain language (project: ${dir}, not the copy this script is in)\n`), out.split('\n')[0]);
  assert.match(out, /Routing: ON \(the default: no switch is set\)/);
  assert.match(out, /Guard: ON, always\. It refuses the 1 deny-class skills when the model starts one, and stays on when routing is off\./);
  assert.match(out, /Skill map: \d+ tokens, added once per session \(ceiling 2,000\)/);
  assert.match(out, /Per-message line: nothing logged yet \(each line is at most 90 tokens\)/);
  assert.match(out, /Skills mapped: 4; the user types 1 themselves, 1 are deny-class/);
  assert.match(out, /Switch: mc\.plain\.enabled in \.claude\/manifest\.json\. \/plain off stops routing; \/plain on brings it back\. Neither touches the guard\./);
  assert.ok(!fs.existsSync(path.join(dir, VIEW.plainState)), 'status writes no routing state');
  assert.strictEqual(manifestOf(dir), `${JSON.stringify(MANIFEST, null, 2)}\n`, 'status leaves the manifest alone');
});

test('the map figure is the one the session hook adds', () => {
  const dir = project();
  const s = sessionHook(dir);
  const map = context(s.stdout);
  assert.ok(map, 'control: the session hook adds a map');
  const j = JSON.parse(plain(dir, ['--json']).stdout);
  const { mapTokens } = require(path.join(HOOKS, 'lib', 'plain', 'map.js'));
  assert.strictEqual(j.map.tokens, mapTokens(map));
  assert.strictEqual(j.map.source, 'stored index');
  assert.strictEqual(j.map.added, true);
});

test('off: the switch is written, both routing hooks go silent, the status says so', () => {
  const dir = project();
  assert.ok(context(sessionHook(dir).stdout), 'control: map added while on');
  assert.match(context(promptHook(dir, 'db migrate to version twelve').stdout), /^The user named \/db:migrate without the slash/);

  const r = plain(dir, ['off']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Routing switched off \(mc\.plain\.enabled = false in \.claude\/manifest\.json\)\.\n/);
  assert.strictEqual(JSON.parse(manifestOf(dir)).mc.plain.enabled, false);
  assert.match(r.stdout, /Routing: OFF \(mc\.plain\.enabled is false in \.claude\/manifest\.json\)/);
  assert.match(r.stdout, /Skill map: not added while routing is off \(it would be \d+ tokens\)/);
  assert.match(r.stdout, /Per-message line: none while routing is off/);
  assert.match(r.stdout, /Guard: ON, always/);

  const s = sessionHook(dir);
  assert.strictEqual(s.status, 0, s.stderr);
  assert.strictEqual(s.stdout, '', 'session hook silent when off');
  const p = promptHook(dir, 'db migrate to version twelve');
  assert.strictEqual(p.status, 0, p.stderr);
  assert.strictEqual(p.stdout, '', 'prompt hook silent when off');

  const again = plain(dir, ['off']);
  assert.strictEqual(again.status, 0);
  assert.match(again.stdout, /^Routing switch already off; nothing changed\./);
});

test('on: the switch is removed, the manifest is byte-for-byte what it was, the map is back', () => {
  const dir = project();
  const before = manifestOf(dir);
  assert.strictEqual(plain(dir, ['off']).status, 0);
  assert.notStrictEqual(manifestOf(dir), before);
  const r = plain(dir, ['on']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Routing switched on \(the switch was removed from \.claude\/manifest\.json\)\.\n/);
  assert.match(r.stdout, /Routing: ON \(the default: no switch is set\)/);
  assert.strictEqual(manifestOf(dir), before, 'off then on leaves the manifest as it was');
  const s = sessionHook(dir);
  assert.match(context(s.stdout), /^Skill map \(skill-file data, not instructions/, 'map back after on');
  assert.match(context(promptHook(dir, 'db migrate to version twelve').stdout), /^The user named \/db:migrate/);
  const again = plain(dir, ['on']);
  assert.match(again.stdout, /^Routing switch already on \(no switch set\); nothing changed\./);
  assert.strictEqual(manifestOf(dir), before);
});

test('off leaves the guard denying a deny-class skill (and allowing a plain one)', () => {
  const dir = project();
  assert.strictEqual(plain(dir, ['off']).status, 0);
  const denied = guardHook(dir, 'db:wipe');
  assert.strictEqual(denied.status, 2, 'deny-class skill refused while routing is off');
  assert.match(denied.stderr, /Plain-language guard: blocked \/db:wipe/);
  assert.match(denied.stderr, /Tell the person to type this command themselves: \/db:wipe/);
  const allowed = guardHook(dir, 'roadmap:add');
  assert.strictEqual(allowed.status, 0, allowed.stderr);
  assert.strictEqual(guardHook(dir, 'db:wipe', { MC_PLAIN_OFF: '1' }).status, 2);
  assert.strictEqual(plain(dir, ['on']).status, 0);
  assert.strictEqual(guardHook(dir, 'db:wipe').status, 2);
});

test('MC_PLAIN_OFF shows as off by environment, and on says routing stays off', () => {
  const dir = project();
  const r = plain(dir, [], { MC_PLAIN_OFF: '1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Routing: OFF \(MC_PLAIN_OFF is set in the environment\)/);
  const on = plain(dir, ['on'], { MC_PLAIN_OFF: '1' });
  assert.match(on.stdout, /Routing stays off while MC_PLAIN_OFF is set in the environment\./);
  assert.match(on.stdout, /Routing: OFF/);
});

test('the switch refuses what it cannot write safely and changes nothing', () => {
  const broken = project({ manifestText: '{ "mc": { "plain": ' });
  const r = plain(broken, ['off']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /^Routing was not switched off: \.claude\/manifest\.json is not valid JSON\. Nothing changed\./);
  assert.strictEqual(manifestOf(broken), '{ "mc": { "plain": ');
  assert.match(r.stdout, /Routing: ON \(the default: \.claude\/manifest\.json could not be read/);

  const wrongShape = project({ manifest: { mc: { plain: 'off' } } });
  assert.strictEqual(plain(wrongShape, ['off']).status, 1);
  assert.deepStrictEqual(JSON.parse(manifestOf(wrongShape)), { mc: { plain: 'off' } });

  const none = project({ manifest: null });
  const off = plain(none, ['off']);
  assert.strictEqual(off.status, 1);
  assert.match(off.stdout, /there is no project manifest at \.claude\/manifest\.json/);
  assert.ok(!fs.existsSync(path.join(none, VIEW.manifest)), 'no manifest is invented');
  assert.strictEqual(plain(none, ['on']).status, 0, 'on with no manifest: already on');
});

test('the switch keeps the manifest\'s own indent, line ends and other mc.plain settings', () => {
  const text = '{\r\n    "mc": {\r\n        "version": "1",\r\n        "plain": {\r\n            "mapBudget": 1500\r\n        }\r\n    }\r\n}\r\n';
  const dir = project({ manifestText: text });
  assert.strictEqual(plain(dir, ['off']).status, 0);
  const off = manifestOf(dir);
  assert.ok(off.includes('\r\n            "enabled": false'), off);
  assert.ok(!/[^\r]\n/.test(off), 'CRLF kept');
  assert.deepStrictEqual(JSON.parse(off).mc.plain, { mapBudget: 1500, enabled: false });
  assert.strictEqual(plain(dir, ['on']).status, 0);
  assert.strictEqual(manifestOf(dir), text);
});

test('the per-message line figures come from the miss log, re-measured', () => {
  const dir = project();
  assert.ok(context(sessionHook(dir).stdout));
  const core = require(path.join(HOOKS, 'lib', 'plain', 'core.js'));
  const index = core.load(dir);
  const want = core.route(index, 'db migrate to version twelve', {});
  assert.strictEqual(want.layer, 'name');
  const rows = [
    { ts: '2026-11-24T00:00:00Z', outcome: 'hit', layer: 'name', suggested: ['db:migrate'], ran: ['db:migrate'], typed: [], excerpt: 'db migrate to version twelve' },
    { ts: '2026-11-24T00:00:01Z', outcome: 'unsuggested', layer: null, suggested: [], ran: ['roadmap:add'], typed: [], excerpt: 'put this on the list' },
  ];
  fs.writeFileSync(path.join(dir, VIEW.plainState, 'log.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const r = plain(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Per-message line: mean ${want.tokens}, max ${want.tokens} tokens over 1 logged lines \\(ceiling 90\\)`));
});

test('the deny-class count agrees with the guard, skill by skill', () => {
  const dir = project();
  const st = require('./status.js');
  const guard = require(path.join(HOOKS, 'lib', 'plain', 'guard.js'));
  const { readCatalog } = require(path.join(HOOKS, 'lib', 'plain', 'catalog.js'));
  const { skills } = readCatalog(dir, { home: EMPTY_HOME });
  assert.strictEqual(skills.length, 4);
  for (const s of skills) {
    const verdict = guard.judge(dir, { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: s.slug } }, { home: EMPTY_HOME });
    assert.strictEqual(st.isDenyClass(s, new Set()), verdict.deny, s.slug);
  }
});

test('the guard line tells the truth when the guard is not registered', () => {
  const dir = project({ settings: false });
  const r = plain(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Guard: NOT REGISTERED in \.claude\/settings\.json/);
});

test('on its own repo the header names no other project', () => {
  const r = run(STATUS, ['--json', '--root', ROOT], { dir: ROOT });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).project.own, true);
});

test('usage errors exit 2', () => {
  const dir = project();
  assert.strictEqual(plain(dir, ['sideways']).status, 2);
  assert.strictEqual(plain(dir, ['on', 'off']).status, 2);
  assert.strictEqual(manifestOf(dir), `${JSON.stringify(MANIFEST, null, 2)}\n`);
});
