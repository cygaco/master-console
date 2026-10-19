
const fs = require("fs");

const DRIFT_TYPES = new Set([
  "overwrite",
  "extension",
  "new_behavior",
  "removal",
  "matching",
]);

function parseLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const out = [];
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}

function isStatusUpdate(entry) {
  return (
    entry.type === "status_update" ||
    (entry.data && entry.data.type === "status_update")
  );
}

function isDriftEnvelope(entry) {
  if (DRIFT_TYPES.has(entry.type)) return true;
  if (
    entry.cat === "requirement_staged" &&
    entry.data &&
    DRIFT_TYPES.has(entry.data.drift_type)
  )
    return true;
  return false;
}

function statusUpdateRef(entry) {
  if (entry.type === "status_update" && entry.id) return entry.id;
  if (
    entry.cat === "requirement_staged" &&
    entry.data &&
    entry.data.type === "status_update" &&
    entry.data.id
  )
    return entry.data.id;
  return null;
}

function statusUpdateTs(entry) {
  return entry.ts || (entry.data && entry.data.reviewed_at) || "";
}

function statusUpdateStatus(entry) {
  if (entry.type === "status_update") return entry.status;
  if (entry.data && entry.data.type === "status_update")
    return entry.data.status;
  return null;
}

function reconcile(filePath) {
  const entries = parseLines(filePath);

  const latestUpdate = new Map();
  for (const e of entries) {
    if (!isStatusUpdate(e)) continue;
    const ref = statusUpdateRef(e);
    if (!ref) continue;
    const ts = statusUpdateTs(e);
    const cur = latestUpdate.get(ref);
    if (!cur || (ts && ts > cur.ts)) {
      latestUpdate.set(ref, {
        ts,
        status: statusUpdateStatus(e),
        note: e.review_note || (e.data && e.data.review_note) || null,
        reviewer: e.reviewed_by || (e.data && e.data.reviewed_by) || null,
      });
    }
  }

  const all = [];
  for (const e of entries) {
    if (!isDriftEnvelope(e)) continue;
    const id = e.id || (e.data && e.data.id);
    if (!id) continue;
    const data = e.data || e;
    const update = latestUpdate.get(id);
    const resolvedStatus = update?.status || data.status || "pending";
    all.push({
      id,
      ts: e.ts || data.ts || null,
      feature: data.feature || null,
      file: data.file || null,
      spec_file: data.spec_file || null,
      drift_type: data.drift_type || data.type || null,
      confidence: data.confidence || null,
      group: data.group || null,
      suggested_update: data.suggested_update || null,
      status: resolvedStatus,
      decidedTs: update?.ts || null,
      reviewNote: update?.note || null,
      reviewer: update?.reviewer || null,
    });
  }

  const byId = new Map();
  for (const row of all) {
    const cur = byId.get(row.id);
    if (!cur || (row.ts && cur.ts && row.ts > cur.ts)) byId.set(row.id, row);
    else if (!cur) byId.set(row.id, row);
  }
  const deduped = [...byId.values()];

  const pending = deduped.filter((r) => r.status === "pending");
  const decided = deduped.filter((r) => r.status !== "pending");

  const byStatus = {};
  const byFeature = {};
  for (const r of deduped) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.status === "pending") {
      const f = r.feature || "?";
      byFeature[f] = (byFeature[f] || 0) + 1;
    }
  }

  return { all: deduped, pending, decided, byStatus, byFeature };
}

module.exports = { reconcile, parseLines, DRIFT_TYPES };
