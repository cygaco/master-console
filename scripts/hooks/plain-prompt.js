#!/usr/bin/env node
'use strict';
const MAX_STDIN = 4 << 20;

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    let done = false;
    let over = false;
    const finish = () => { if (!done) { done = true; resolve({ s, over }); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { if (over) return; s += d; if (s.length > MAX_STDIN) { over = true; s = ''; } });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 3000);
  });
}

async function main() {
  const where = require('./lib/plain/where.js');
  if (where.envOff()) return;
  const { s, over } = await readStdin();
  let event = null;
  if (!over) { try { event = JSON.parse(s); } catch { event = null; } }
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.hook_event_name !== 'UserPromptSubmit') return;
  const root = process.env.CLAUDE_PROJECT_DIR || (typeof event.cwd === 'string' && event.cwd) || process.cwd();
  const cfg = where.readConfig(root);
  if (where.isOff(cfg)) return;
  const prompt = typeof event.prompt === 'string' ? event.prompt : '';
  const core = require('./lib/plain/core.js');
  const misslog = require('./lib/plain/misslog.js');
  const stored = core.load(root);
  const r = stored ? core.route(stored, prompt, cfg) : { layer: null, slugs: [], text: '' };
  misslog.settleAndRecord(root, event.transcript_path, prompt, r);
  if (r.text && r.tokens <= core.MAX_TOKENS) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: r.text } }));
  }
}

main().catch(() => {}).then(() => process.exit(0));
