"use strict";

const SUITE_VERSION = "check-suite/v1";

const CHECK_NAMES = Object.freeze(["false-green-envelope", "no-nul-bytes", "suite-completeness"]);

const REQUIRED_CHECKS = Object.freeze(["false-green-envelope", "no-nul-bytes", "suite-completeness"]);

module.exports = { SUITE_VERSION, CHECK_NAMES, REQUIRED_CHECKS };
