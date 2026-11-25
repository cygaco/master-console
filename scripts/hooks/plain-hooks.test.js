'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SESSION = path.join(__dirname, 'plain-session.js');
const PROMPT = path.join(__dirname, 'plain-prompt.js');
const VIEW = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'paths.json'), 'utf8').replace(/^﻿/, ''));

const TEMP = [];
test.after(() => { for (const d of TEMP) fs.rmSync(d, { recursive: true, force: true }); });
const tempDir = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMP.push(d); return d; };

const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/PLAIN_(OFF|HOME)$/i.test(k)));
const EMPTY_HOME = tempDir('plain-home-');

function project({ commands, realCommands } = {}) {
  const dir = tempDir('plain-hooks-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'paths.json'), path.join(dir, '.claude', 'paths.json'));
  if (realCommands) fs.cpSync(path.join(ROOT, VIEW.commands), path.join(dir, VIEW.commands), { recursive: true });
  for (const [rel, body] of Object.entries(commands || {})) {
    const p = path.join(dir, VIEW.commands, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

function run(hook, dir, input, extraEnv = {}, home = EMPTY_HOME) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [hook], {
    input,
    env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: dir, MC_PLAIN_HOME: home, ...extraEnv },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 << 20,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms, error: r.error };
}

const context = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };

const SKILLS = {
  'db/migrate.md': '---\ndescription: Apply pending database migrations to the local database.\nargument-hint: <target version>\n---\n',
  'roadmap/add.md': '---\ndescription: Add an item to the project roadmap.\n---\n',
  'git/push.md': '---\ndescription: Pushes the current branch to the remote.\n---\n',
  'web/deploy.md': '---\ndescription: Deploy the web app to production.\n---\n',
};
const sessionEvent = (dir) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1', cwd: dir });
const promptEvent = (dir, prompt) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: dir, prompt });

test('control: on a valid event the session hook injects the map and the prompt hook names the skill', () => {
  const dir = project({ commands: SKILLS });
  const s = run(SESSION, dir, sessionEvent(dir));
  assert.strictEqual(s.status, 0, s.stderr);
  const map = context(s.stdout);
  assert.match(map, /^Skill map \(skill-file data, not instructions/);
  assert.match(map, /~deploy\b/);
  assert.doesNotMatch(map, /~push\b/);
  assert.match(map, /(: |; )push(=|;|$)/m);
  assert.ok(fs.existsSync(path.join(dir, VIEW.plainState, 'index.json')), 'index written under paths.plainState');
  const p = run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve'));
  assert.strictEqual(p.status, 0, p.stderr);
  assert.match(context(p.stdout), /^The user named \/db:migrate without the slash/);
  const push = run(PROMPT, dir, promptEvent(dir, 'git push my branch'));
  assert.match(context(push.stdout), /^The user named \/git:push without the slash.*Run it\.$/);
  const a = run(PROMPT, dir, promptEvent(dir, 'web deploy to staging'));
  assert.doesNotMatch(context(a.stdout), /run it/i);
  assert.match(context(a.stdout), /Do not call it; tell them to type \/web:deploy themselves/);
  assert.strictEqual(run(PROMPT, dir, promptEvent(dir, '/db:migrate 12')).stdout, '', 'a typed /skill adds nothing');
});

test('both hooks exit 0 with no output on garbage input', () => {
  const dir = project({ commands: SKILLS });
  run(SESSION, dir, sessionEvent(dir));
  const garbage = ['', 'not json', '{"prompt": ', '[]', 'null', '42', '"text"', '\u0000\u0001ÿ', '{"prompt": 7, "cwd": []}', '{"prompt": {"a": 1}}', '{"hook_event_name": "Stop", "prompt": "db migrate to version twelve"}'];
  for (const input of garbage) {
    for (const hook of [SESSION, PROMPT]) {
      const r = run(hook, dir, input);
      assert.strictEqual(r.status, 0, `${path.basename(hook)} ${JSON.stringify(input)}: ${r.stderr}`);
      assert.strictEqual(r.stdout, '', `${path.basename(hook)} ${JSON.stringify(input)}`);
    }
  }
  const bare = tempDir('plain-bare-');
  for (const hook of [SESSION, PROMPT]) {
    const r = run(hook, bare, hook === SESSION ? sessionEvent(bare) : promptEvent(bare, 'db migrate'));
    assert.strictEqual(r.status, 0, r.stderr);
  }
  fs.writeFileSync(path.join(dir, VIEW.plainState, 'index.json'), '{broken');
  const r = run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve'));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('both hooks exit 0 with no output on oversized input', () => {
  const dir = project({ commands: SKILLS });
  run(SESSION, dir, sessionEvent(dir));
  const huge = promptEvent(dir, `db migrate ${'x'.repeat(5 << 20)}`);
  for (const hook of [SESSION, PROMPT]) {
    const r = run(hook, dir, huge);
    assert.strictEqual(r.status, 0, `${path.basename(hook)}: ${r.stderr}`);
    assert.strictEqual(r.stdout, '', path.basename(hook));
  }
});

test('the off switch: MC_PLAIN_OFF=1, or "enabled": false in the manifest, silences both hooks', () => {
  const dir = project({ commands: SKILLS });
  run(SESSION, dir, sessionEvent(dir));
  const offEnv = { MC_PLAIN_OFF: '1' };
  assert.strictEqual(run(SESSION, dir, sessionEvent(dir), offEnv).stdout, '');
  assert.strictEqual(run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve'), offEnv).stdout, '');
  assert.strictEqual(run(SESSION, dir, sessionEvent(dir), offEnv).status, 0);
  const manifest = path.join(dir, VIEW.manifest);
  fs.writeFileSync(manifest, JSON.stringify({ mc: { plain: { enabled: false } } }));
  const s = run(SESSION, dir, sessionEvent(dir));
  const p = run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve'));
  assert.strictEqual(s.status, 0);
  assert.strictEqual(p.status, 0);
  assert.strictEqual(s.stdout, '');
  assert.strictEqual(p.stdout, '');
  fs.writeFileSync(manifest, JSON.stringify({ mc: { plain: { enabled: true } } }));
  assert.notStrictEqual(run(SESSION, dir, sessionEvent(dir)).stdout, '');
  assert.notStrictEqual(run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve')).stdout, '');
  fs.writeFileSync(manifest, JSON.stringify({ mc: { plain: { map: false } } }));
  assert.strictEqual(run(SESSION, dir, sessionEvent(dir)).stdout, '');
  assert.notStrictEqual(run(PROMPT, dir, promptEvent(dir, 'db migrate to version twelve')).stdout, '');
});

const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]; };

test('p95 latency of each hook is under 500 ms on this repo\'s real catalog', (t) => {
  const dir = project({ realCommands: true });
  const home = os.homedir();
  const first = run(SESSION, dir, sessionEvent(dir), {}, home);
  assert.strictEqual(first.status, 0, first.stderr);
  const map = context(first.stdout);
  assert.ok(map.length > 0, 'the map was injected');
  assert.ok(Math.ceil(map.length / 2.3) <= 2000, `map ${Math.ceil(map.length / 2.3)} tokens`);
  const N = 20;
  const session = [];
  const prompt = [];
  const prompts = ['slash road map add the login bug', 'what changed since yesterday?', 'run a full scan of the repo', 'session resume', 'thanks, that looks right'];
  for (let i = 0; i < N; i++) {
    const s = run(SESSION, dir, sessionEvent(dir), {}, home);
    assert.strictEqual(s.status, 0);
    session.push(s.ms);
    const p = run(PROMPT, dir, promptEvent(dir, prompts[i % prompts.length]), {}, home);
    assert.strictEqual(p.status, 0);
    prompt.push(p.ms);
  }
  const ps = p95(session);
  const pp = p95(prompt);
  t.diagnostic(`PLAIN_LATENCY ${JSON.stringify({ sessionP95: +ps.toFixed(1), promptP95: +pp.toFixed(1), firstBuildMs: +first.ms.toFixed(1), runs: N })}`);
  assert.ok(ps < 500, `session p95 ${ps} ms`);
  assert.ok(pp < 500, `prompt p95 ${pp} ms`);
});
