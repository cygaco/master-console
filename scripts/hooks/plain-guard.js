#!/usr/bin/env node
'use strict';
const fs = require('fs');

const MAX_STDIN = 1 << 20;
const STDIN_WAIT_MS = 3000;

function say(text) {
  try { fs.writeSync(2, `${text}\n`); } catch { }
}

function failed(err) {
  const what = (err && (err.code || err.name)) || 'error';
  say(`Plain-language guard: blocked this skill call: the guard failed (${String(what).replace(/[^\w.-]/g, '').slice(0, 40)}). Do not retry it, and do not call another skill that deletes, deploys or spends instead. Tell the person to type the command for what they asked, themselves.`);
  process.exit(2);
}

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
    setTimeout(finish, STDIN_WAIT_MS);
  });
}

async function main() {
  const guard = require('./lib/plain/guard.js');
  const { s, over } = await readStdin();
  if (over) return { deny: true, reason: guard.reasonFor(null, 'the call is too large to read') };
  let event;
  try { event = JSON.parse(s); } catch { return { deny: true, reason: guard.reasonFor(null, 'the call is not valid JSON') }; }
  const cwd = event && typeof event === 'object' && typeof event.cwd === 'string' && event.cwd ? event.cwd : null;
  const root = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  return guard.judge(root, event);
}

process.on('uncaughtException', failed);
process.on('unhandledRejection', failed);
process.on('beforeExit', () => failed(new Error('no verdict')));
main().then((v) => {
  if (!v || typeof v.deny !== 'boolean') return failed(new Error('no verdict'));
  if (!v.deny) process.exit(0);
  say(v.reason);
  process.exit(2);
}, failed);
