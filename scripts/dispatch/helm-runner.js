"use strict";

const panelLanes = require("./panel-lanes");
const controller = require("./trusted-controller");

const DEFAULT_PROFILE = "panel-2family";

const CONTROLLER_OPT_ALLOWLIST = Object.freeze(["bundleManifestPath", "bundleRoot", "candidateRoot", "spId", "leaseRoot", "gitRoot"]);

function sanitizeControllerOpts(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k of CONTROLLER_OPT_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  }
  return out;
}

const INTEGRATION_BLOCKED = "INTEGRATION-BLOCKED";

function collectLaneEvidence(helm, runResult) {
  const laneId = (helm && (helm.laneId || helm.id)) || null;
  const contractedProvider = (helm && helm.provider) || null;
  const r = runResult && typeof runResult === "object" ? runResult : {};
  return {
    laneId,
    contractedProvider,
    observedProvider: r.observedProvider != null ? r.observedProvider : null,
    fallback: r.fallback === true,
    alive: r.alive === true,
    verdict: typeof r.verdict === "string" ? r.verdict : "",
    hasEvidence: r.hasEvidence === true,
    controlPlane: r.controlPlane && typeof r.controlPlane === "object" ? r.controlPlane : null,
  };
}

function runHelms(input = {}, opts = {}) {
  const agyOperatorOwned = opts.agyOperatorOwned !== false;
  const integrateFn = typeof opts.integrateFn === "function" ? opts.integrateFn : controller.integrate;

  let manifest, profile;
  try {
    manifest = opts.manifest || panelLanes.loadManifest();
    profile = panelLanes.getProfile(manifest, input.profile || DEFAULT_PROFILE);
  } catch (e) {
    const panel = panelLanes.panelStatus({ required: [], min_families: 2, binding: false }, [], { loaderError: true });
    return { status: panel.status, perHelm: [], panel: { ...panel, loaderDetail: e.message }, integration: undefined };
  }

  const rawLanes = Array.isArray(input.lanes) ? input.lanes : [];
  const perHelm = rawLanes.map((l) => collectLaneEvidence(l, l && l.runResult));

  const panel = panelLanes.panelStatus(profile, perHelm, { agyOperatorOwned });

  let integration;
  if (panel.status === panelLanes.STATUS.PASS && input.integrate) {
    try {
      integration = integrateFn(input.integrate, { ...sanitizeControllerOpts(opts.controllerOpts), performRefUpdate: true });
    } catch (e) {
      integration = { ok: false, decision: "BLOCKED", reason: "integrate-threw", detail: e && e.message ? e.message : String(e) };
    }

    const committedCorrectly =
      integration &&
      integration.ok === true &&
      integration.decision === "INTEGRATED" &&
      integration.receipt &&
      integration.receipt.committed_head === input.integrate.result_commit;
    if (!committedCorrectly) {
      return { status: INTEGRATION_BLOCKED, perHelm, panel, integration };
    }
  }

  return { status: panel.status, perHelm, panel, integration };
}

module.exports = {
  runHelms,
  collectLaneEvidence,
  sanitizeControllerOpts,
  CONTROLLER_OPT_ALLOWLIST,
  DEFAULT_PROFILE,
  INTEGRATION_BLOCKED,
};
