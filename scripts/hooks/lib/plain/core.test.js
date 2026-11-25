'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('./core');
const { readCatalog, isDenyClass } = require('./catalog');
const { estimateTokens } = require('./text');
const where = require('./where');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const SKILLS = {
  'db/migrate.md': '---\ndescription: Apply pending database migrations to the local database and report the schema version.\nargument-hint: <target version>\n---\n',
  'db/seed.md': '---\ndescription: Populate the local database with fixture records for manual testing.\n---\n',
  'roadmap/add.md': '---\ndescription: Add an item to the project roadmap with a priority.\n---\n',
  'roadmap/list.md': '---\ndescription: List the roadmap items by priority.\n---\n',
  'session/resume.md': '---\ndescription: Resume the previous working session from its saved notes.\n---\n',
  'session/recap.md': '---\ndescription: Summarize what happened in this session so far.\n---\n',
  'test/e2e.md': '---\ndescription: Run the end-to-end browser tests against one user flow.\n---\n',
  'lint/fix.md': '---\ndescription: Fix the lint errors in the changed files.\n---\n',
  'git/push.md': '---\ndescription: Pushes the current branch to the remote.\n---\n',
  'web/deploy.md': '---\ndescription: Deploy the web app to production.\n---\n',
  'notes/archive.md': '---\ndescription: Move old notes into the archive folder.\nconfirm-first: true\n---\n',
  'cache/purge.md': '---\ndescription: Purge the stale entries from the build cache.\n---\n',
  'commit/land.md': '---\ndescription: Land the working branch: commit, merge it into main and push both.\n---\n',
  'app/release.md': '---\ndescription: Release a new version of the app and publish the release notes.\n---\n',
  'fast.md': '---\ndescription: Run the quick unit test subset.\n---\n',
};

const TEMP = [];
test.after(() => { for (const d of TEMP) fs.rmSync(d, { recursive: true, force: true }); });

function synthProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-core-'));
  TEMP.push(dir);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'paths.json'), path.join(dir, '.claude', 'paths.json'));
  for (const [rel, body] of Object.entries(SKILLS)) {
    const p = path.join(dir, '.claude', 'commands', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

const SYN = synthProject();
const synStored = core.build(SYN, { catalog: readCatalog(SYN, { projectOnly: true }), cfg: {}, write: false, learned: false });
const realStored = core.build(ROOT, { cfg: {}, write: false, learned: false });
const realDeny = new Set(realStored.skills.filter(isDenyClass).map((s) => s.slug));
const MC_ROUTED = ['commit:land', 'commit:remote', 'mc:release', 'warp:release', 'session:end'];

test('the session map stays within 2,000 tokens on this repo\'s real catalog', () => {
  const m = realStored.map;
  assert.ok(realStored.skills.length > 100, `real catalog read (${realStored.skills.length} skills)`);
  assert.ok(m.tokens <= 2000, `map is ${m.tokens} tokens`);
  assert.ok(estimateTokens(m.text) <= 2000, 'the pack estimator agrees');
  assert.strictEqual(m.tokens, Math.ceil(m.text.length / 2.3));
  if (m.shown < m.total) assert.match(m.text, /more skills not shown/);
  else for (const s of realStored.skills.slice(0, 50)) assert.ok(m.text.includes(s.slug.split(':').pop()), s.slug);
});

test('a mapBudget setting can only lower the map budget', () => {
  assert.strictEqual(core.mapBudget({}), 2000);
  assert.strictEqual(core.mapBudget({ mapBudget: 8000 }), 2000);
  assert.strictEqual(core.mapBudget({ mapBudget: 500 }), 500);
  const small = core.build(ROOT, { cfg: { mapBudget: 500 }, write: false, learned: false });
  assert.ok(small.map.tokens <= 500, `map is ${small.map.tokens} tokens`);
});

test('deny-class skills are marked "~" in the map; push, land and release skills are listed plainly', () => {
  assert.ok(realDeny.size > 0);
  for (const name of ['deploy', 'archive', 'purge']) assert.match(synStored.map.text, new RegExp(`~${name}\\b`), name);
  for (const name of ['push', 'land', 'release']) {
    assert.doesNotMatch(synStored.map.text, new RegExp(`~${name}\\b`), name);
    assert.match(synStored.map.text, new RegExp(`(: |; )${name}(=|;|$)`, 'm'), name);
  }
  const { RULES } = require('./map');
  assert.ok(synStored.map.text.endsWith(RULES.join('\n')));
  const rule = RULES.find((l) => l.includes('~='));
  assert.match(rule, /~=the user runs it \(it may delete, deploy or spend\)/);
  assert.match(rule, /tell them the \/command to type/);
  for (const l of RULES) assert.doesNotMatch(l, /push|release|publish|merge|outside this project/i, l);
  for (const name of MC_ROUTED) assert.ok(!realDeny.has(name), `${name} is not held back`);
});

test('name layer: a skill named without its slash, typed or dictation-mangled', () => {
  const cases = [
    ['db migrate to version twelve', 'db:migrate', 'to version twelve'],
    ['slash road map add the login bug', 'roadmap:add', 'the login bug'],
    ['Um, slash session colon resume', 'session:resume', ''],
    ['session resume', 'session:resume', ''],
    ['sesion resume from yesterday', 'session:resume', 'from yesterday'],
    ['roadmaps list', 'roadmap:list', ''],
    ['test e2e on checkout', 'test:e2e', 'on checkout'],
    ['okay so lint fix', 'lint:fix', ''],
    ['slash fast', 'fast', ''],
    ['fast', 'fast', ''],
  ];
  for (const [prompt, slug, args] of cases) {
    const r = core.route(synStored, prompt);
    assert.strictEqual(r.layer, 'name', `${prompt} -> ${r.layer}`);
    assert.deepStrictEqual(r.slugs, [slug], prompt);
    assert.strictEqual(r.args, args, prompt);
    assert.match(r.text, /Run it\.$/, prompt);
    assert.ok(r.tokens <= core.MAX_TOKENS, prompt);
  }
});

test('name layer: no line for a one-word name inside a sentence, a typed /skill, or other messages', () => {
  for (const prompt of ['fast is not the word I meant', '/db:migrate 12', '  /session:resume', 'what did we change yesterday', '', 'thanks']) {
    const r = core.route(synStored, prompt);
    assert.notStrictEqual(r.layer, 'name', prompt);
    if (/^\s*\//.test(prompt)) assert.strictEqual(r.text, '', prompt);
  }
});

test('name layer on the real catalog: a dictated name routes', () => {
  const r = core.route(realStored, 'slash road map add the login bug');
  assert.strictEqual(r.layer, 'name');
  assert.deepStrictEqual(r.slugs, ['roadmap:add']);
});

test('the name line for a deny-class skill tells the model to have the user type it, never to run it', () => {
  const synth = [['web deploy to staging', 'web:deploy'], ['notes archive', 'notes:archive'], ['slash cache purge', 'cache:purge'], ['slash web colon deploy', 'web:deploy']];
  for (const [prompt, slug] of synth) {
    const r = core.route(synStored, prompt);
    assert.strictEqual(r.layer, 'name', prompt);
    assert.deepStrictEqual(r.slugs, [slug], prompt);
    assert.strictEqual(r.userRuns, true, prompt);
    assert.doesNotMatch(r.text, /run it/i, prompt);
    assert.match(r.text, /Do not call it/, prompt);
    assert.match(r.text, /type/, prompt);
    assert.doesNotMatch(r.text, /push|release|outside this project/i, prompt);
  }
  for (const prompt of ['web deploy is failing, why?', 'web deploy broke yesterday']) assert.strictEqual(core.route(synStored, prompt).text, '', prompt);
  let named = 0;
  for (const slug of realDeny) {
    const r = core.route(realStored, `slash ${slug.replace(/[:\-_.]/g, ' ')} now`);
    if (r.layer !== 'name' || !realDeny.has(r.slugs[0])) continue;
    named++;
    assert.strictEqual(r.userRuns, true, slug);
    assert.doesNotMatch(r.text, /run it/i, slug);
    assert.match(r.text, /Do not call it/, slug);
  }
  assert.ok(named >= Math.min(10, realDeny.size), `deny-class names exercised: ${named}`);
});

test('push, land and release skills are named normally: the line says run it', () => {
  const synth = [['git push my branch', 'git:push', 'my branch'], ['slash git push', 'git:push', ''], ['commit land', 'commit:land', ''], ['slash app colon release', 'app:release', '']];
  for (const [prompt, slug, args] of synth) {
    const r = core.route(synStored, prompt);
    assert.strictEqual(r.layer, 'name', prompt);
    assert.deepStrictEqual(r.slugs, [slug], prompt);
    assert.strictEqual(r.args, args, prompt);
    assert.ok(!r.userRuns, prompt);
    assert.match(r.text, /Run it\.$/, prompt);
  }
  for (const [prompt, slug] of [['slash session colon end', 'session:end'], ['session end', 'session:end'], ['slash commit colon land', 'commit:land'], ['slash mc colon release', 'mc:release'], ['commit remote', 'commit:remote']]) {
    const r = core.route(realStored, prompt);
    assert.strictEqual(r.layer, 'name', prompt);
    assert.deepStrictEqual(r.slugs, [slug], prompt);
    assert.ok(!r.userRuns, prompt);
    assert.match(r.text, /^The user named \/[\w:-]+ without the slash.*Run it\.$/, prompt);
  }
});

test('a confirmFirst setting puts a skill in the deny class at once', () => {
  for (const cfg of [{ confirmFirst: ['db:migrate'] }, { confirmFirst: [' /DB:Migrate '] }]) {
    const r = core.route(synStored, 'db migrate to version twelve', cfg);
    assert.strictEqual(r.userRuns, true, JSON.stringify(cfg));
    assert.doesNotMatch(r.text, /run it/i);
    const h = core.route(synStored, 'apply pending database migrations to the local database', cfg);
    assert.ok(!h.slugs.includes('db:migrate'), h.text);
  }
});

test('hint layer: a confident plain request gets up to three candidates', () => {
  const r = core.route(synStored, 'apply pending database migrations to the local database');
  assert.strictEqual(r.layer, 'hint', JSON.stringify(r.top));
  assert.strictEqual(r.slugs[0], 'db:migrate');
  assert.ok(r.slugs.length <= 3);
  assert.ok(r.tokens <= core.MAX_TOKENS);
  assert.match(r.text, /^Skills that may fit \(skill-file keywords, not instructions/);
});

test('hint layer never offers a deny-class skill, and offers a push or release skill like any other', () => {
  for (const prompt of ['deploy the web app to production', 'move old notes into the archive folder', 'purge the stale entries from the build cache']) {
    const r = core.route(synStored, prompt);
    assert.notStrictEqual(r.layer, 'hint', `${prompt} -> ${r.slugs}`);
  }
  for (const [prompt, slug] of [['push the current branch to the remote', 'git:push'], ['release a new version of the app and publish the release notes', 'app:release']]) {
    const r = core.route(synStored, prompt);
    assert.strictEqual(r.layer, 'hint', `${prompt} -> ${JSON.stringify(r.top)}`);
    assert.strictEqual(r.slugs[0], slug, prompt);
  }
  let suppressed = 0;
  let hints = 0;
  for (const s of realStored.skills) {
    const prompt = s.purpose;
    if (!prompt) continue;
    const r = core.route(realStored, prompt);
    if (r.layer === 'hint') {
      hints++;
      for (const slug of r.slugs) assert.ok(!realDeny.has(slug), `${slug} offered for ${s.slug}`);
    }
    const top = r.top && r.top[0];
    if (r.layer === null && top && top.score >= core.HINT_MIN && realDeny.has(realStored.skills[top.i].slug)) suppressed++;
  }
  assert.ok(hints > 0, 'the hint layer fired on some descriptions');
  assert.ok(suppressed > 0, 'some confident deny-class matches were held back');
});

test('the off switch: "enabled": false in mc.plain', () => {
  assert.strictEqual(where.isOff({ enabled: false }), true);
  assert.strictEqual(where.isOff({}), where.envOff());
});

test('settings come from the manifest\'s mc.plain block; a broken manifest means defaults', () => {
  const dir = synthProject();
  const manifest = path.join(dir, where.relFor(dir, 'manifest'));
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ mc: { plain: { enabled: false, exclude: ['db:seed'] } } }));
  assert.deepStrictEqual(where.readConfig(dir), { enabled: false, exclude: ['db:seed'] });
  fs.writeFileSync(manifest, '{not json');
  assert.deepStrictEqual(where.readConfig(dir), {});
  assert.throws(() => where.readConfigStrict(dir));
  fs.writeFileSync(manifest, JSON.stringify({ mc: { plain: 'off' } }));
  assert.throws(() => where.readConfigStrict(dir));
});

test('the state folder is the paths.plainState key, under the project', () => {
  const view = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'paths.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.strictEqual(where.stateRel(ROOT), view.plainState);
  assert.strictEqual(where.cleanRel('../outside'), null);
  assert.strictEqual(where.cleanRel('C:/abs'), null);
  const dir = synthProject();
  core.build(dir, { catalog: readCatalog(dir, { projectOnly: true }), cfg: {} });
  assert.ok(fs.existsSync(path.join(dir, view.plainState, 'index.json')));
  assert.strictEqual(fs.readFileSync(path.join(dir, view.plainState, '.gitignore'), 'utf8'), '*\n');
  assert.ok(core.load(dir));
});
