#!/usr/bin/env node
"use strict";
// DEPRECATED alias shim (S-OS-06, mc@2.0.0) -> scripts/checks/mc-tracked-transients.js. Retained for the 2.0.x compat
// window so .github/workflows/leak-gate.yml + scripts/checks/leak-gate.js keep invoking this frozen name unedited; removed in 2.1.0.
const impl = require("./mc-tracked-transients.js");
module.exports = impl;
if (require.main === module) impl.main();
