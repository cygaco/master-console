#!/usr/bin/env node
"use strict";
// DEPRECATED alias shim (S-OS-06, mc@2.0.0) -> scripts/checks/mc-ship-coverage.js. Legacy name kept for the 2.0.x compat window; removed in 2.1.0.
if (require.main === module) { const r = require("child_process").spawnSync(process.execPath, [require.resolve("./mc-ship-coverage.js"), ...process.argv.slice(2)], { stdio: "inherit" }); process.exit(r.error || r.status === null ? 1 : r.status); } else { module.exports = require("./mc-ship-coverage.js"); }
