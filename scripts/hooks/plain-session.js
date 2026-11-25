#!/usr/bin/env node
'use strict';
const fs = require('fs');

const MAX_STDIN = 1 << 20;

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
    setTimeout(finish, 1000);
  });
}

async function main() {
  const where = require('./lib/plain/where.js');
  if (where.envOff()) return;
  const { s, over } = await readStdin();
  let event = null;
  if (!over) { try { event = JSON.parse(s); } catch { event = null; } }
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.hook_event_name !== 'SessionStart') return;
  const root = process.env.CLAUDE_PROJECT_DIR || (typeof event.cwd === 'string' && event.cwd) || process.cwd();
  const cfg = where.readConfig(root);
  if (where.isOff(cfg)) return;
  const core = require('./lib/plain/core.js');
  const { readCatalog } = require('./lib/plain/catalog.js');
  const misslog = require('./lib/plain/misslog.js');
  let stored = core.load(root);
  const catalog = readCatalog(root);
  let logTime = 0;
  try { logTime = fs.statSync(misslog.logFile(root)).mtimeMs; } catch { }
  const stale = !stored || stored.fingerprint !== catalog.fingerprint || stored.configHash !== core.configHash(cfg) || (logTime && logTime > Date.parse(stored.builtAt));
  if (stale) stored = core.build(root, { catalog, cfg });
  if (cfg.map === false || !stored || !stored.map || !stored.map.text || !stored.skills.length) return;
  if (!(stored.map.tokens <= core.MAP_MAX_TOKENS)) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: stored.map.text } }));
}

main().catch(() => {}).then(() => process.exit(0));
