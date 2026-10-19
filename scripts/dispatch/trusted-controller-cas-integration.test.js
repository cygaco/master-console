"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const CONTROLLER = path.join(__dirname, "trusted-controller.js");

test("trusted-controller-cas-integration — a successful integrate() advances the target ref by CAS from base to EXACTLY result_commit, and the receipt names that exact head", (t) => {
  if (!fs.existsSync(CONTROLLER)) return t.skip("controller not built");
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const { headSha } = require("./falsifiers/_lib/git-scratch");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("cas-integration-happy");
  t.after(() => fx.cleanup());

  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "PRECONDITION: the target ref starts at base");

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.decision, "INTEGRATED");
  assert.ok(result.receipt, "a receipt must be returned on a successful integration");
  assert.strictEqual(result.receipt.committed_head, fx.result, "the receipt must name EXACTLY the accepted result_commit");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result, "the target ref must have advanced by CAS to EXACTLY result_commit");
});

test("trusted-controller-cas-integration — without opts.performRefUpdate:true, the CAS determination succeeds but the ref is NEVER actually mutated", (t) => {
  if (!fs.existsSync(CONTROLLER)) return t.skip("controller not built");
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const { headSha } = require("./falsifiers/_lib/git-scratch");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("cas-integration-no-write");
  t.after(() => fx.cleanup());

  const result = ctl.integrate(standardInput(fx), standardOpts(fx, { performRefUpdate: false }));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must NOT advance without performRefUpdate:true");
});

test("trusted-controller-cas-integration — an integration that is NOT authorized never reaches commitIntegration (the ref stays at base)", (t) => {
  if (!fs.existsSync(CONTROLLER)) return t.skip("controller not built");
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const { headSha } = require("./falsifiers/_lib/git-scratch");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("cas-integration-unauthorized");
  t.after(() => fx.cleanup());

  const result = ctl.integrateForTest(standardInput(fx), standardOpts(fx), { leaseTokenResolver: () => 999999 });
  assert.strictEqual(result.ok, false, "MUST-BLOCK: an invalid lease fencing token must never authorize");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must remain untouched — commitIntegration was never reached");
});
