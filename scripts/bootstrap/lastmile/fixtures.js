"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CASES = [
  {
    name: "no-auth",
    why: "prototype with persistence but no auth",
    files: {
      "package.json": JSON.stringify({
        name: "fx-no-auth",
        dependencies: { next: "15.0.0", react: "19.0.0", "@supabase/supabase-js": "2.45.0" },
      }),
    },
    expect: [
      { path: "persistence.provider", equals: "supabase" },
      { path: "auth.provider", equals: null },
    ],
  },
  {
    name: "auth-no-payments",
    why: "auth present, no payment provider",
    files: {
      "package.json": JSON.stringify({
        name: "fx-auth-no-payments",
        dependencies: { next: "15.0.0", react: "19.0.0", "@clerk/nextjs": "5.7.0" },
      }),
    },
    expect: [
      { path: "auth.provider", equals: "clerk" },
      { path: "payments.provider", equals: null },
    ],
  },
  {
    name: "stripe-no-webhook-verify",
    why: "Stripe present but webhook signature NOT verified (forgeable events)",
    files: {
      "package.json": JSON.stringify({
        name: "fx-stripe-no-webhook",
        dependencies: { next: "15.0.0", react: "19.0.0", stripe: "17.0.0" },
      }),
      "app/api/webhook/route.ts":
        'import Stripe from "stripe";\n' +
        'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");\n' +
        "export async function POST(req) {\n" +
        "  // NO signature verification here — the forgeable-events gap.\n" +
        "  const event = await req.json();\n" +
        "  return new Response('ok');\n" +
        "}\n",
    },
    expect: [
      { path: "payments.provider", equals: "stripe" },
      { path: "payments.webhookVerified", equals: false },
    ],
  },
  {
    name: "db-no-deletion-path",
    why: "database present, no account deletion/export path",
    files: {
      "package.json": JSON.stringify({
        name: "fx-db-no-deletion",
        dependencies: { next: "15.0.0", react: "19.0.0", "@prisma/client": "5.20.0" },
        devDependencies: { prisma: "5.20.0" },
      }),
      "prisma/schema.prisma":
        "model User {\n  id    String @id @default(cuid())\n  email String @unique\n}\n",
    },
    expect: [
      { path: "persistence.provider", equals: "prisma" },
      { path: "account.deletionPath", equals: false },
    ],
  },
  {
    name: "no-funnel",
    why: "API-only backend, no landing/pricing/conversion funnel",
    files: {
      "package.json": JSON.stringify({
        name: "fx-no-funnel",
        dependencies: { express: "4.21.0" },
      }),
      "server.js": "const express = require('express'); const app = express();\n",
    },
    expect: [
      { path: "funnel.hasLanding", equals: false },
      { path: "funnel.hasPricing", equals: false },
    ],
  },
  {
    name: "mobile-appstore",
    why: "mobile app needing app-store readiness",
    files: {
      "package.json": JSON.stringify({
        name: "fx-mobile",
        dependencies: { expo: "52.0.0", react: "18.3.1", "react-native": "0.76.0" },
      }),
    },
    expect: [
      { path: "framework", equals: "expo" },
      { path: "platform", equals: "mobile" },
    ],
  },
  {
    name: "sensitive-data-redflag",
    why: "sensitive (health) data → MUST trigger escalation",
    files: {
      "package.json": JSON.stringify({
        name: "fx-sensitive",
        dependencies: { next: "15.0.0", react: "19.0.0" },
      }),
      "lib/records.ts":
        "// Handles HIPAA-regulated PHI: patient medical record + diagnosis.\n" +
        "export interface PatientRecord { patientId: string; diagnosis: string; medicalRecordNumber: string; }\n",
    },
    expect: [{ path: "sensitive.escalate", equals: true }],
  },
  {
    name: "self-hosted-postgres",
    why: "own server + self-hosted Postgres (not a managed BaaS) → self-hosted profile + server-deploy",
    files: {
      "package.json": JSON.stringify({
        name: "fx-self-hosted",
        dependencies: { next: "15.0.0", react: "19.0.0", pg: "8.13.0" },
      }),
      "docker-compose.yml":
        "services:\n  app:\n    build: .\n  db:\n    image: postgres:16\n",
    },
    expect: [
      { path: "persistence.provider", equals: "postgres" },
      { path: "persistence.hostingModel", equals: "self-hosted" },
    ],
  },
];

function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function materialize(caseObj, baseDir) {
  const dir =
    baseDir || fs.mkdtempSync(path.join(os.tmpdir(), `lastmile-fx-${caseObj.name}-`));
  for (const [rel, content] of Object.entries(caseObj.files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

module.exports = { CASES, materialize, getByPath };
