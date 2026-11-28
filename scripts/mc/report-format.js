
const ORDER = [
  "verdict",
  "whatChanged",
  "why",
  "risksRemaining",
  "whatWasRejected",
  "whatWasTested",
  "needsHumanDecision",
  "recommendedNextAction",
];

const LABELS = {
  verdict: "Verdict",
  whatChanged: "What changed",
  why: "Why",
  risksRemaining: "Risks remaining",
  whatWasRejected: "What was rejected",
  whatWasTested: "What was tested",
  needsHumanDecision: "What needs human decision",
  recommendedNextAction: "Recommended next action",
};

function list(value) {
  if (value == null) return ["None."];
  if (Array.isArray(value)) return value.length ? value.map(String) : ["None."];
  return [String(value)];
}

function renderHumanReport(title, report) {
  const lines = [`${title} report`];
  for (const key of ORDER) {
    lines.push(``);
    lines.push(`${LABELS[key]}:`);
    for (const item of list(report[key])) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

function printHumanReport(title, report) {
  console.log("");
  console.log(renderHumanReport(title, report));
}

const KEPT_EDIT_LABELS = {
  MERGE_CLEAN: "merged",
  LOCAL_CUSTOMIZED: "kept your edit",
  MERGE_KEPT_LOCAL: "kept yours, new version beside",
  ORPHAN_KEPT: "kept (removed in this version)",
};

function renderKeptEdits(applyResult) {
  const rows = ((applyResult && applyResult.perFile) || []).filter(
    (p) => KEPT_EDIT_LABELS[p.category] && p.status !== "kept_unverified",
  );
  if (!rows.length) return [];
  const counts = applyResult.counts || {};
  const totals =
    "your edits: merged=" + (counts.merged || 0) +
    " kept-edited=" + (counts.kept_edited || 0) +
    " kept-with-new-beside=" + (counts.kept_new_beside || 0) +
    " kept-removed=" + (counts.kept_modified || 0);
  return [
    totals,
    ...rows.map(
      (p) =>
        "  " + KEPT_EDIT_LABELS[p.category] + ": " + p.dest + (p.sibling ? " -> " + p.sibling : ""),
    ),
  ];
}

module.exports = {
  ORDER,
  LABELS,
  renderHumanReport,
  printHumanReport,
  renderKeptEdits,
};
