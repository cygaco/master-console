"use strict";
const { verifyRecord } = require("./attest-signing");

function isVerifiedLivenessRecord(record, opts = {}) {
  if (!record || typeof record !== "object") return false;
  if (record.ok !== true) return false;
  const requireSignature = opts.requireSignature !== false;
  if (!requireSignature) return true;
  const verify = opts.verify || verifyRecord;
  return verify(record) === true;
}

function filterVerifiedLiveness(records, opts = {}) {
  return (Array.isArray(records) ? records : []).filter((r) => isVerifiedLivenessRecord(r, opts));
}

module.exports = { isVerifiedLivenessRecord, filterVerifiedLiveness };
