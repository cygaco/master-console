"use strict";
/**
 * scripts/bootstrap/lastmile/lib/approval-gates.js — the hard human-approval gate
 * registry for bootstrap:lastmile. These actions are NEVER self-authorized and
 * NEVER bypassed by --turbo. The orchestrator + the skill body consult this before
 * any phase that would touch one of them; the sprint approval system records the
 * operator's explicit clearance.
 */

const GATES = [
  {
    id: "stripe-live",
    action: "Switch payment provider to LIVE mode",
    why: "Real money movement; mistakes charge real customers and are hard to reverse.",
    requires: "test-mode verification passed + explicit operator approval",
  },
  {
    id: "prod-db-migration",
    action: "Run a production database migration",
    why: "Can corrupt or drop real user data; needs backup + reviewed migration + approval.",
    requires: "verified backup + dry-run on a copy + explicit operator approval",
  },
  {
    id: "domain-dns",
    action: "Change domain / DNS records",
    why: "Can take the live product offline or hijack email deliverability.",
    requires: "explicit operator approval + rollback note",
  },
  {
    id: "server-provision",
    action: "Provision a self-hosted server / VPS (and run the product on it)",
    why: "Spins up paid infrastructure the operator owns + operates; carries cost, patching, and security-exposure obligations a managed host would absorb.",
    requires: "explicit operator approval + a backup/restore plan + a reverse-proxy/TLS + hardening checklist",
  },
  {
    id: "app-store-submit",
    action: "Submit to an app store (App Store / Play)",
    why: "Public, reviewed, hard to retract; binds the product's public identity.",
    requires: "explicit operator approval + store-readiness checklist passed",
  },
  {
    id: "email-real-users",
    action: "Send emails to real users",
    why: "Irreversible outbound contact; spam/deliverability + privacy implications.",
    requires: "explicit operator approval + tested template + suppression/unsub honored",
  },
  {
    id: "collect-sensitive-data",
    action: "Collect sensitive data",
    why: "Health/finance/children/biometric/etc. trigger legal obligations.",
    requires: "legal/security review recorded + explicit operator approval",
  },
  {
    id: "publish-legal-docs",
    action: "Publish privacy policy / terms as FINAL legal documents",
    why: "These are legal commitments; MC drafts compliance-by-default, not law.",
    requires: "operator (or counsel) review + explicit approval to publish as final",
  },
];

const GATE_IDS = GATES.map((g) => g.id);

function gateFor(actionId) {
  return GATES.find((g) => g.id === actionId) || null;
}

function requiresApproval(actionId) {
  return GATE_IDS.includes(actionId);
}

module.exports = { GATES, GATE_IDS, gateFor, requiresApproval };
