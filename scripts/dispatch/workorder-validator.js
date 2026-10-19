"use strict";
const crypto = require("crypto");
const workorderSchema = require("./workorder-schema");
const attestSigning = require("./attest-signing");

const DEFAULT_PROMPT_FLOOR_BYTES = 256;

function inferRoleKind(workorder) {
  const role = workorder && typeof workorder.role === "string" ? workorder.role : "";
  return /-builder$/.test(role) ? "feature-build" : "other";
}

function checkPromptFloor(workorder, opts = {}) {
  const roleKind =
    (opts && typeof opts.roleKind === "string" && opts.roleKind) ||
    (workorder && typeof workorder.role_kind === "string" && workorder.role_kind) ||
    inferRoleKind(workorder);
  const promptBytesRaw =
    opts && opts.promptBytes !== undefined
      ? opts.promptBytes
      : workorder && workorder.prompt_bytes !== undefined
        ? workorder.prompt_bytes
        : undefined;
  if (promptBytesRaw === undefined || promptBytesRaw === null) {
    return { ok: true, reason: "no prompt-size context supplied — belt scoped out for this WorkOrder" };
  }
  const floorBytes =
    opts && opts.floorBytes !== undefined
      ? opts.floorBytes
      : workorder && workorder.floor_bytes !== undefined
        ? workorder.floor_bytes
        : DEFAULT_PROMPT_FLOOR_BYTES;
  if (roleKind === "feature-build" && promptBytesRaw < floorBytes) {
    return { ok: false, reason: `prompt_bytes ${promptBytesRaw} below floor_bytes ${floorBytes} (hollow-prompt class)` };
  }
  return { ok: true, reason: "prompt meets the size floor (or role_kind is not feature-build)" };
}

function signWorkOrderProvenance(workorder, secret) {
  const useSecret = secret === undefined ? attestSigning.sessionSecret() : secret;
  if (!useSecret) return null;
  const digest = workorderSchema.workOrderDigest(workorder);
  return crypto.createHmac("sha256", useSecret).update(`workorder_digest=${digest}`).digest("hex");
}

function issueWorkOrder(workorder, opts = {}) {
  const secret = opts.secret === undefined ? attestSigning.sessionSecret() : opts.secret;
  const sig = signWorkOrderProvenance(workorder, secret);
  if (!sig) return { ...workorder };
  return { ...workorder, attest_sig: sig };
}

function verifyProvenance(workorder, opts = {}) {
  const secret = opts && opts.secret !== undefined ? opts.secret : attestSigning.sessionSecret();
  if (!secret) {
    return { ok: false, reason: "no same-session HMAC secret available (fail-closed — cannot verify any provenance)" };
  }
  const sig = workorder && workorder.attest_sig;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) {
    return { ok: false, reason: "no valid same-session provenance signature present (hand-authored/unsigned/self-asserted WorkOrder)" };
  }
  const expected = signWorkOrderProvenance(workorder, secret);
  if (!expected) {
    return { ok: false, reason: "unable to compute expected provenance signature (secret unavailable)" };
  }
  let match = false;
  try {
    match = crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    match = false;
  }
  if (!match) {
    return { ok: false, reason: "provenance signature does not match the WorkOrder's identity fields (forged/tampered WorkOrder)" };
  }
  return { ok: true, reason: "valid same-session HMAC provenance signature over the WorkOrder's immutable identity" };
}

function validate(workorder, opts = {}) {
  const schemaRes = workorderSchema.validate(workorder);
  if (!schemaRes.ok) {
    return { ok: false, reason: `schema/required-semantics invalid: ${schemaRes.errors.join("; ")}` };
  }

  const prov = verifyProvenance(workorder, opts);
  if (!prov.ok) {
    return { ok: false, reason: `authority/provenance check failed: ${prov.reason}` };
  }

  const floor = checkPromptFloor(workorder, opts);
  if (!floor.ok) {
    return { ok: false, reason: `prompt-size floor: ${floor.reason}` };
  }

  return { ok: true, reason: "WorkOrder schema-valid, same-session provenance verified, floor clear" };
}

module.exports = {
  DEFAULT_PROMPT_FLOOR_BYTES,
  inferRoleKind,
  checkPromptFloor,
  signWorkOrderProvenance,
  issueWorkOrder,
  verifyProvenance,
  validate,
};
