#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "cert-attest";
const { NON_AUTH_SIGNAL, filterAgyLogToRunWindow, norm } = require("../dispatch/agy-auth-tells");
const ARTIFACT_DIR = path.join(ROOT, "runtime", "cert-attest");

const pv = require(path.join(__dirname, "..", "dispatch", "provenance-verifier"));
let attestSigning;
try {
  attestSigning = require(path.join(__dirname, "..", "dispatch", "attest-signing"));
} catch {
  attestSigning = { verifyRecord: () => false };
}

function loadCatalog() {
  return require(path.join(ROOT, "scripts", "dispatch", "catalog.js"));
}
function loadKernel() {
  try {
    return require(path.join(ROOT, "scripts", "dispatch", "safe-spawn.js"));
  } catch (e) {
    return { _err: e.message };
  }
}

function probeShape(providerId, model, effort) {
  if (providerId === "openai") {
    const reasoning = effort ? ["-c", `model_reasoning_effort=${effort}`] : [];
    return { toolId: "codex", argv: ["exec", "--sandbox", "workspace-write", ...reasoning, "-m", model, "-"], stdin: true };
  }
  if (providerId === "antigravity") {
    const agyModel = loadCatalog().agyModelName(model);
    return { toolId: "agy", argv: ["--model", agyModel, "--print-timeout", "90s", "-p", PROBE_PROMPT], stdin: false };
  }
  if (providerId === "claude") {
    return { toolId: "claude", argv: ["-p", "--model", model], stdin: true };
  }
  return null;
}

const PROBE_PROMPT =
  "Reply with EXACTLY: PROBE OK. Do not add anything else.";

function evaluateAttestation({ requestedModel, providerId, output, exitOk, catalog }) {
  const out = norm(output);
  const req = norm(requestedModel);
  if (!exitOk) return { attested: false, effective: null, reason: "dispatch did not exit cleanly (non-zero / reaped / empty)" };
  if (!out) return { attested: false, effective: null, reason: "empty CLI output — nothing to attest" };
  if (NON_AUTH_SIGNAL.test(out))
    return {
      attested: false,
      effective: null,
      reason:
        "served-model UNVERIFIABLE — THIS run's output carries an UNAMBIGUOUS TERMINAL default/eval/keyring signal ('resolved via default' / 'local chrome mode … eval mode' / keyring expired=true / auth-failed): agy served the DEFAULT, not the contracted model → fail-closed. Ambiguous startup transients (not-logged-in / defaulting) are NOT hard-failed here — they are carried by GATE-2 (default backend-label) + pid/time-window attribution — so a genuine authed serve is not false-RED'd.",
      defaultSignal: true,
    };
  if (providerId === "antigravity")
    return {
      attested: false,
      effective: null,
      reason:
        "HONEST-CEILING: agy cannot self-attest a genuine serve from its log — the 'backend: label' line is a CLIENT-SIDE echo agy emits even while unauthenticated. No agy log line is trusted as served-model proof → fail-closed by construction. Attestation closes ONLY via a real authenticated dispatch-agent record post-login, never this probe.",
      honestCeiling: true,
      servedSelfId: false,
    };
  let otherSeen = null;
  try {
    const prov = catalog.getProvider(providerId);
    for (const m of (prov && prov.models) || []) {
      const id = norm(m.id);
      if (id !== req && out.includes(id)) { otherSeen = m.id; break; }
    }
  } catch { }
  const reqEsc = req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const SERVED_MARKER = new RegExp(`(model[-\\s]*:[-\\s]*|(?:serving|resolved|using|active|loaded)[-:\\s]*|backend[:\\-]+label[="'\\-]*)${reqEsc}`);
  const REQUEST_CTX = /(request|requested|requesting|submit|submitting|sending|sent|input|prompt|queued|pending|asking|asked|echo)[-\s]*$/;
  let servedSelfId = false;
  const _m = SERVED_MARKER.exec(out);
  if (_m) {
    const before = out.slice(Math.max(0, _m.index - 16), _m.index);
    servedSelfId = !REQUEST_CTX.test(before);
  }
  if (otherSeen && !servedSelfId)
    return { attested: false, effective: otherSeen, reason: `CLI output names a DIFFERENT model "${otherSeen}" and no affirmative served self-id of the requested model — the opts.model||default trap (served the default, not the requested -m)`, otherSeen };
  if (servedSelfId)
    return { attested: true, effective: requestedModel, reason: "CLI output affirmatively self-identifies the requested model as SERVED (positive proof; no default/unauth signal)", requestedSeen: true, servedSelfId: true };
  return { attested: false, effective: null, reason: "no AFFIRMATIVE served-model self-identification of the requested model — a bare request echo is NOT proof it served; inconclusive → fail-closed. For agy this is the honest ceiling until an authenticated log names the contracted model as resolved.", requestedSeen: out.includes(req), servedSelfId: false, otherSeen };
}

function providerForModel(catalog, model, explicit) {
  if (explicit) return catalog.normalizeProviderId(explicit);
  for (const p of catalog.PROVIDER_LIST || []) {
    if ((p.models || []).some((m) => m.id === model || (m.aliases || []).includes(model))) return p.id;
  }
  return null;
}

function readLedgerRecords(sprintId, panelRunId, ledgerPath) {
  let file = ledgerPath;
  if (!file) {
    try { file = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.dispatchCompletionsFile; }
    catch { file = path.join(ROOT, ".claude", "runtime", "dispatch-completions.jsonl"); }
  }
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    if (sprintId && r.sprint_id !== sprintId) continue;
    if (panelRunId != null && r.panel_run_id !== panelRunId) continue;
    out.push(r);
  }
  return out;
}

function attestLane(lane, records, opts = {}) {
  const { runId = null, sprintId = null, codeSha = null, profileName = "panel-2family" } =
    typeof opts === "string" ? {} : opts || {};
  if (lane && pv.servedModelUnverifiableFromRecord(lane.provider)) {
    return {
      laneId: lane.laneId,
      attested: false,
      reason:
        "HONEST-CEILING at the panel reader: the antigravity lane cannot be attested from a ledger record — agy emits no trustworthy server-origin served-model receipt (only the client-side 'backend: label' echo). Fail-closed by construction: an agy lane never attests at this reader, so a panel-3lab BINDING run, which requires agy, does not attest.",
      honestCeiling: true,
    };
  }
  const contract = pv.laneContract(profileName, lane.provider);
  const sameRun = (records || []).filter(
    (r) => r.ok === true && r.fallback === false && (sprintId == null || r.sprint_id === sprintId) && runId != null && r.panel_run_id === runId,
  );
  const provenanceOk = (r) =>
    typeof r.code_sha === "string" && r.code_sha.length > 0 && (codeSha == null || r.code_sha === codeSha) && !!r.cmdline_checksum;
  const match = sameRun.find((r) => {
    if (!attestSigning.verifyRecord(r)) return false;
    if (!pv.recordMatchesLane(r, contract, lane.provider)) return false;
    if (contract.isHunter) return (r.evidence_sha || r.output_digest) && provenanceOk(r);
    return r.tool_id === lane.tool_id && !!r.output_digest && provenanceOk(r);
  });
  if (!match) {
    return {
      laneId: lane.laneId,
      attested: false,
      reason: contract.isHunter
        ? "no same-run in-process HUNTER record (writer-stamped shape in-process-agent + role security_claude_hunter, with evidence + provenance)"
        : `no same-run record for ${lane.provider}/${lane.tool_id} (contract ${contract.shape}/${contract.role}, panel_run_id, fallback:false, output_digest + code_sha) — a wrapper claim is NOT proof`,
    };
  }
  return {
    laneId: lane.laneId,
    attested: true,
    observedProvider: match.provider,
    tool_id: match.tool_id || null,
    invocation_digest: match.cmdline_checksum || null,
    evidence_digest: match.output_digest || match.evidence_sha || null,
    reason: "same-run observed record on the contracted provider (fallback:false + evidence)",
  };
}

function attestPanelRun({ runId, sprintId, profile, lanes, records, codeSha, role = "security-reviewer" } = {}) {
  const laneResults = (lanes || []).map((lane) => attestLane(lane, records || [], { role, runId, sprintId, codeSha, profileName: (profile && profile.name) || "panel-2family" }));
  const attestedLanes = laneResults.filter((l) => l.attested);
  const allAttested = laneResults.length > 0 && laneResults.every((l) => l.attested);
  const codeShaBound = typeof codeSha === "string" && codeSha.length > 0;
  const runBound = typeof runId === "string" && runId.length > 0;
  const ok = allAttested && codeShaBound && runBound;
  const evidenceDigest = crypto
    .createHash("sha256")
    .update(attestedLanes.map((l) => `${l.laneId}:${l.evidence_digest || ""}`).join("|"))
    .digest("hex");
  return {
    ok,
    profile: (profile && profile.name) || null,
    run_id: runId || null,
    sprint_id: sprintId || null,
    code_sha: codeSha || null,
    invocation_digests: attestedLanes.map((l) => l.invocation_digest).filter(Boolean),
    evidence_digest: evidenceDigest,
    lanes: laneResults,
    reason: !runBound
      ? "no runId supplied — a binding panel attestation must certify a SPECIFIC run (an omitted runId certifies historical evidence) → NOT ok"
      : !allAttested
        ? `unattested required lane(s): ${laneResults.filter((l) => !l.attested).map((l) => l.laneId).join(", ")} — attestation FAILS (a wrapper claim is not proof)`
        : !codeShaBound
          ? "every required lane attested SAME-RUN, but code_sha is absent — a binding attestation must bind to a code SHA → NOT ok"
          : "every required lane attested SAME-RUN on its contracted provider (fallback:false), bound to run_id + code_sha",
  };
}

function gitHeadSha() {
  try {
    return require(path.join(ROOT, "scripts", "dispatch", "git-head")).readGitHead(ROOT) || null;
  } catch {
    return null;
  }
}

function attestPanelRunLive({ runId, sprintId, profileName = "panel-2family" } = {}) {
  let lanes;
  try {
    const pl = require(path.join(ROOT, "scripts", "dispatch", "panel-lanes"));
    lanes = pl.requiredLanes(pl.loadManifest(), profileName);
  } catch (e) {
    return { ok: false, reason: `panel-lanes loader failed (fail-closed): ${e.message}`, lanes: [] };
  }
  const records = readLedgerRecords(sprintId, runId);
  return attestPanelRun({ runId, sprintId, profile: { name: profileName }, lanes, records, codeSha: gitHeadSha() });
}

function mainPanel(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const json = argv.includes("--json");
  const sprintId = get("--sprint");
  const runId = get("--run");
  const profileName = get("--profile") || "panel-2family";
  if (!sprintId || !runId) {
    process.stderr.write("usage: cert-attest.js panel --sprint <id> --run <panel_run_id> [--profile panel-2family|panel-3lab] [--json]\n");
    return 2;
  }
  const out = attestPanelRunLive({ runId, sprintId, profileName });
  if (json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else if (out.ok) process.stdout.write(`ATTESTED [panel] ${profileName} sprint=${sprintId} — every required lane same-run attested on its contracted provider.\n`);
  else process.stderr.write(`FAIL [panel] ${profileName} sprint=${sprintId} — ${out.reason}\n`);
  return out.ok ? 0 : 1;
}

function main(argv) {
  if (argv[0] === "panel") return mainPanel(argv.slice(1));
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const json = argv.includes("--json");
  const model = get("--model");
  const effort = get("--effort") || "low";
  if (!model) {
    process.stderr.write("usage: cert-attest.js --model <id> [--provider <p>] [--effort <e>] [--json]\n");
    return 2;
  }
  const catalog = loadCatalog();
  const providerId = providerForModel(catalog, model, get("--provider"));
  if (!providerId) {
    process.stderr.write(`${NAME}: cannot resolve a provider for model "${model}" (pass --provider) — is it in the catalog?\n`);
    return 2;
  }
  const attestModel = providerId === "antigravity" ? catalog.agyModelName(model) : model;
  if (providerId === "antigravity") {
    const prov = catalog.getProvider("antigravity");
    const contracted = ((prov && prov.models) || []).some((m) => m.id === model || m.agyModelName === model);
    if (!contracted) {
      process.stderr.write(`${NAME}: "${model}" is not a contracted antigravity model (catalog entry required by id or agyModelName) — refusing to spawn a non-contracted model.\n`);
      return 2;
    }
  }
  const shape = probeShape(providerId, model, providerId === "openai" ? effort : null);
  if (!shape) {
    process.stderr.write(`${NAME}: no probe shape for provider "${providerId}"\n`);
    return 2;
  }
  const kernel = loadKernel();
  if (kernel._err || typeof kernel.safeSpawnSync !== "function") {
    process.stderr.write(`${NAME}: safe-spawn kernel unavailable (${kernel._err || "no safeSpawnSync"}) — fail-closed\n`);
    return 2;
  }

  mcEnv.setEnv("PROVIDER_PROBE", "1");
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  let agyDefaultLog = null;
  let agyLogPreSize = 0;
  let agyLogPrePrefix = null;
  if (providerId === "antigravity") {
    agyDefaultLog = path.join(process.env.USERPROFILE || require("os").homedir(), ".gemini", "antigravity-cli", "cli.log");
    try {
      agyLogPreSize = fs.statSync(agyDefaultLog).size;
      const fd0 = fs.openSync(agyDefaultLog, "r");
      const pre = Buffer.alloc(Math.min(256, agyLogPreSize));
      fs.readSync(fd0, pre, 0, pre.length, 0);
      fs.closeSync(fd0);
      agyLogPrePrefix = pre.toString("utf8");
    } catch { agyLogPreSize = 0; agyLogPrePrefix = null; }
  }
  const started = Date.now();
  const spawned = kernel.safeSpawnSync(shape.toolId, shape.argv, {
    cwd: ROOT,
    env: process.env,
    input: shape.stdin ? PROBE_PROMPT : undefined,
    timeoutMs: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  const stdout = spawned.stdout || "";
  const stderr = spawned.stderr || "";
  let agyLog = "";
  if (agyDefaultLog) {
    try {
      const fd = fs.openSync(agyDefaultLog, "r");
      const size = fs.fstatSync(fd).size;
      let rotated = true;
      if (agyLogPrePrefix && size >= agyLogPrePrefix.length) {
        const chk = Buffer.alloc(agyLogPrePrefix.length);
        fs.readSync(fd, chk, 0, chk.length, 0);
        rotated = chk.toString("utf8") !== agyLogPrePrefix;
      }
      const start = rotated ? 0 : agyLogPreSize;
      const len = Math.max(0, size - start);
      if (len > 0) {
        const buf = Buffer.alloc(Math.min(len, 4 * 1024 * 1024));
        fs.readSync(fd, buf, 0, buf.length, start);
        agyLog = buf.toString("utf8");
      }
      fs.closeSync(fd);
    } catch { }
    agyLog = filterAgyLogToRunWindow(agyLog, started);
  }
  const combined = `${stdout}\n${stderr}\n${agyLog}`;
  // liveness-verified: `spawned` is a SUBPROCESS spawn result (carries .exitCode), NOT a dispatch-completion
  const exitOk = spawned.ok === true && spawned.exitCode === 0;

  const verdict = evaluateAttestation({ requestedModel: attestModel, providerId, output: combined, exitOk, catalog });

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const artifact = {
    check: NAME,
    requested_model: model,
    attested_model_id: attestModel,
    provider: providerId,
    effort: providerId === "openai" ? effort : null,
    attested: verdict.attested,
    effective_model: verdict.effective,
    reason: verdict.reason,
    exit_ok: exitOk,
    exit_code: spawned.exitCode,
    reaped: spawned.reaped || false,
    violations: spawned.violations || null,
    stdout_bytes: Buffer.byteLength(stdout, "utf8"),
    stderr_bytes: Buffer.byteLength(stderr, "utf8"),
    elapsed_ms: elapsedMs,
    ts,
    cli_output_sha256: crypto.createHash("sha256").update(combined).digest("hex"),
    cli_output_head: combined.slice(0, 2000),
  };
  const file = path.join(ARTIFACT_DIR, `${norm(model)}-${ts.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2) + "\n");

  if (json) {
    process.stdout.write(JSON.stringify({ ...artifact, artifact_path: path.relative(ROOT, file) }, null, 2) + "\n");
  } else if (verdict.attested) {
    process.stdout.write(`ATTESTED [${NAME}] ${model} (${providerId}) — CLI self-identified the requested model. artifact: ${path.relative(ROOT, file)}\n`);
  } else {
    process.stderr.write(`FAIL [${NAME}] ${model} (${providerId}) — ${verdict.reason}. artifact: ${path.relative(ROOT, file)}\n`);
  }
  return verdict.attested ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = {
  evaluateAttestation,
  providerForModel,
  probeShape,
  norm,
  filterAgyLogToRunWindow,
  NAME,
  attestLane,
  attestPanelRun,
  attestPanelRunLive,
  readLedgerRecords,
  gitHeadSha,
};
