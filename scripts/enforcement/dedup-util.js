"use strict";
function duplicateKeys(items, keyFn) {
  const counts = new Map();
  for (const it of items || []) {
    const k = keyFn(it);
    if (k === null || k === undefined) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const dups = [];
  for (const [key, count] of counts) if (count > 1) dups.push({ key, count });
  return dups.sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

module.exports = { duplicateKeys };
