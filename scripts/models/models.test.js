#!/usr/bin/env node
"use strict";
const path = require("path");
const r = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "swap.test.js")], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
