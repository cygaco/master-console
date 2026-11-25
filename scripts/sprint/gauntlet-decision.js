#!/usr/bin/env node

"use strict";

const { execFileSync } = require("child_process");

const HALT_REASONS = Object.freeze([
  "change_trailer_missing",
  "change_trailer_invalid",
  "change_trailer_downgraded",
  "sprint_registry_unreadable",
  "head_unreadable",
  "no_base",
  "base_is_head",
  "selector_refused",
  "decision_invalid",
  "selection_threw",
]);

const DEFAULTS = Object.freeze({ leanAuto: true });

function forceFullTrailer(trailer) {
  return { ...(trailer || {}), change: "release", blast: "major" };
}

function decideFromInput(input, opts = {}) {
  const leanAuto = opts.leanAuto === undefined ? DEFAULTS.leanAuto : Boolean(opts.leanAuto);
  const packageMode = opts.packageMode || "auto";
  try {
    const gauntletPackage = require("./gauntlet-package");
    const forced = packageMode === "full" || !leanAuto;
    const effective = forced ? { ...input, trailer: forceFullTrailer(input && input.trailer) } : input;
    const decision = gauntletPackage.selectPackage(effective);
    if (decision && decision.halt_reason) {
      const detail = decision.error || decision.halt_reason;
      return { decision: null, halt_reason: "selector_refused", error: detail, detail };
    }
    const problems = gauntletPackage.validateDecision(decision);
    if (problems.length) {
      return { decision: null, halt_reason: "decision_invalid", error: `selectPackage produced an invalid decision: ${problems.join("; ")}` };
    }
    return { decision, halt_reason: null, error: null };
  } catch (e) {
    return { decision: null, halt_reason: "selection_threw", error: `resolveGauntletDecision failed: ${e && e.message ? e.message : String(e)}` };
  }
}

function defaultGit(root) {
  return (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

function resolveGauntletDecision(sprintId, composition, opts = {}) {
  try {
    const gauntletPackage = require("./gauntlet-package");
    const changeTrailer = require("../checks/change-trailer");
    const root = opts.root || require("./paths").PROJECT;
    const git = typeof opts.git === "function" ? opts.git : defaultGit(root);
    const defaultBranch = opts.defaultBranch || "main";
    composition = composition || {};

    const fail = (halt_reason, error) => ({ decision: null, halt_reason, error });

    let headMsg;
    try {
      headMsg = git(["log", "-1", "--format=%B", "HEAD"]);
    } catch (e) {
      return fail("head_unreadable", `head_unreadable: could not read HEAD commit message: ${e && e.message ? e.message : String(e)}`);
    }
    const parsedHead = changeTrailer.parse(headMsg);
    const headTrailerPresent = Boolean(
      parsedHead && (parsedHead.change !== null || parsedHead.blast !== null || parsedHead.risks !== null || (parsedHead.errors || []).length > 0),
    );

    let trailer = null;
    if (composition.change && composition.blast) {
      const ticketTrailer = { change: composition.change, blast: composition.blast, risks: composition.risks || ["none"] };
      const hv = changeTrailer.validate(parsedHead);
      if (headTrailerPresent && hv && !hv.ok) {
        return fail(
          "change_trailer_invalid",
          `change_trailer_invalid: HEAD commit carries an invalid change-classification trailer (cannot reconcile against the ticket's ${JSON.stringify(ticketTrailer)}): ${hv.errors.join("; ")}`,
        );
      }
      if (!headTrailerPresent) {
        let baseForSprintCheck = null;
        try {
          baseForSprintCheck = git(["merge-base", "HEAD", defaultBranch]).trim();
        } catch {
          baseForSprintCheck = null;
        }
        let headForSprintCheck = null;
        try {
          headForSprintCheck = git(["rev-parse", "HEAD"]).trim();
        } catch {
          headForSprintCheck = null;
        }
        const sprint = changeTrailer.activeSprintAtRef(root, { base: baseForSprintCheck, head: headForSprintCheck });
        if (!sprint.ok) return fail("sprint_registry_unreadable", `sprint_registry_unreadable: ${sprint.reason}`);
        if (sprint.active) {
          return fail(
            "change_trailer_missing",
            `change_trailer_missing: HEAD commit carries no change-classification trailer while sprint ${sprint.id} is active — the ticket's own classification (${JSON.stringify(ticketTrailer)}) may only widen an existing HEAD trailer, never substitute for a missing one`,
          );
        }
      }
      if (hv && hv.ok) {
        const cmp = changeTrailer.compareClassification(ticketTrailer, hv.value);
        if (cmp.blocked) {
          return fail(
            "change_trailer_downgraded",
            `change-trailer downgrade blocked: ticket declared ${JSON.stringify(ticketTrailer)}, HEAD commit trailer is lower (${cmp.downgrades.join(", ")})`,
          );
        }
        Object.assign(ticketTrailer, changeTrailer.widenClassification(ticketTrailer, hv.value));
      }
      trailer = { ...ticketTrailer, source: "ticket" };
    } else {
      const v = changeTrailer.validate(headMsg);
      if (!v.ok) {
        return fail(headTrailerPresent ? "change_trailer_invalid" : "change_trailer_missing", `no ticket classification and HEAD trailer invalid: ${v.errors.join("; ")}`);
      }
      trailer = { ...v.value, source: "commit" };
    }

    let head;
    try {
      head = git(["rev-parse", "HEAD"]).trim();
    } catch (e) {
      return fail("head_unreadable", `head_unreadable: could not resolve HEAD: ${e && e.message ? e.message : String(e)}`);
    }
    let base;
    try {
      base = git(["merge-base", "HEAD", defaultBranch]).trim();
    } catch {
      return fail("no_base", `no_base: could not resolve merge-base HEAD ${defaultBranch} (missing/unreachable default branch)`);
    }
    if (!base || base === head) return fail("base_is_head", "base === head (nothing to diff yet) — skipping the selector for this run");

    const packageMode = opts.packageMode || "auto";
    const leanAuto = opts.leanAuto === undefined ? DEFAULTS.leanAuto : Boolean(opts.leanAuto);
    const assembled = gauntletPackage.assembleInput({ root, trailer, composition, base, head, sprint: sprintId, runId: `run-${sprintId}-${Date.now()}` });
    return decideFromInput(assembled, { leanAuto, packageMode });
  } catch (e) {
    return { decision: null, halt_reason: "selection_threw", error: `resolveGauntletDecision failed: ${e && e.message ? e.message : String(e)}` };
  }
}

module.exports = { HALT_REASONS, DEFAULTS, forceFullTrailer, decideFromInput, resolveGauntletDecision };
