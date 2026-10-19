"use strict";

const { duplicateKeys } = require("./dedup-util");

const ED_ID_RE = /^ED-(\d+)$/;
const DESCRIPTION_FIELDS = ["policy", "origin", "gap"];

function parseRegister(text) {
  const out = [];
  for (const line of String(text == null ? "" : text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { out.push({ raw: t, malformed: true }); continue; }
    const id = typeof obj.id === "string" ? obj.id : null;
    const m = id ? id.match(ED_ID_RE) : null;
    const num = m ? Number(m[1]) : null;
    const isUpdateMarked = obj.amendment === true || obj.record_kind !== undefined || obj.amends !== undefined;
    const hasDescription = DESCRIPTION_FIELDS.some((k) => typeof obj[k] === "string" && obj[k].length > 0);
    const isGenesis = hasDescription && !isUpdateMarked;
    out.push({ raw: t, obj, id, num, isGenesis, malformed: false });
  }
  return out;
}

function nextEdId(text) {
  let max = 0;
  for (const r of parseRegister(text)) {
    if (r.num != null && Number.isFinite(r.num) && r.num > max) max = r.num;
  }
  return "ED-" + String(max + 1).padStart(3, "0");
}

function findDuplicateGenesisIds(text) {
  const rows = parseRegister(text);
  const dups = duplicateKeys(rows, (r) => (!r.malformed && r.isGenesis && r.id && ED_ID_RE.test(r.id) ? r.id : null));
  return dups.map((d) => ({ id: d.key, count: d.count }));
}

function findGenesisEvadingUpdates(text) {
  const out = [];
  for (const r of parseRegister(text)) {
    if (r.malformed || !r.id || !ED_ID_RE.test(r.id)) continue;
    const o = r.obj || {};
    const isUpdate = o.amendment === true || o.record_kind !== undefined || o.amends !== undefined;
    const hasDesc = DESCRIPTION_FIELDS.some((k) => typeof o[k] === "string" && o[k].length > 0);
    if (isUpdate && hasDesc) out.push({ id: r.id });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { parseRegister, nextEdId, findDuplicateGenesisIds, findGenesisEvadingUpdates, ED_ID_RE };
