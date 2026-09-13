# Sprint v0.1 — External Service Readiness

Real product sprints often require third-party services that need human
signup, billing, credentials, OAuth approval, DNS configuration, or
compliance review BEFORE terminal-based implementation can proceed.

Sprint v0.1 treats these as first-class artifacts called **External
Service Dependencies (ESDs)**.

## Why ESDs are first-class

Without ESDs, a sprint plan can silently assume:

- Stripe is already set up (it's not).
- Twilio credentials are in `.env` (they're not).
- The OAuth app is approved (it's pending review).
- The DNS record is propagated (it's not).
- The user has authority to enter a billing relationship (they may
  not).

When implementation hits one of these, the work stalls. With ESDs:

- The Plan Contract identifies the dependency.
- `/sprint:design` mints an ESD record.
- `/sprint:execute` refuses to run tickets dependent on a not-ready
  ESD.
- `/sprint:release` refuses to mark deployed if ESDs aren't ready.

## The ESD lifecycle

```
identified
  ↓
needs_human_signup     ─┐
needs_credentials      ─┼─► (human work outside the terminal)
needs_billing          ─┤
needs_configuration    ─┤
                       ─┘
ready_for_terminal_work  (terminal-implementable)
  ↓
mocked      (test mode)
  OR
integrated  (production mode, after approval)

blocked     (something stops progress)
deferred    (intentionally postponed)
abandoned   (no longer needed)
```

## Categories supported

The schema declares 16 categories:

`payment | auth | email | sms | analytics | database | cloud_storage |
llm_provider | voice_calling | oauth_app | domain_dns |
deployment_host | monitoring_logging | search_indexing |
customer_support | marketplace | other`

These are vendor-neutral. Sprint v0.1 does NOT hard-code Stripe,
Twilio, Auth0, etc. The category captures the SHAPE of the dependency;
the `service_name` captures the specific vendor.

## What an ESD record contains

(See `schemas/sprint/external-service-dependency.schema.json` for the
full schema.)

Key fields:

- `service_name`, `service_category`, `purpose`
- `required_phase` — which sprint phase blocks on this
- `signup_required`, `billing_required`, `credentials_required`,
  `oauth_required`, `domain_dns_required`,
  `compliance_review_required`
- `human_owner` — who is responsible for the human steps
- `can_mock`, `mock_strategy`, `sandbox_available`,
  `production_required`
- `approval_required`, `approval_state`, `approval_ref`
- `required_env_vars[]` — NAMES only, never values
- `human_setup_steps[]` — what the human must do outside terminal
- `terminal_setup_steps[]` — what the agent can do after credentials
  exist

## Approval rule

ESDs MUST have `approval_required: true` (and a recorded approval)
when they involve:

- New paid services
- Billing setup
- Sensitive user data
- Production credentials
- Changes to privacy / security posture
- Sending user communications
- Payments, authentication, user identity, compliance
- Contract, legal, or domain ownership decisions

`/sprint:execute external-service.js gate` enforces this — it refuses
to let dependent tickets run if a required approval is `pending`.

## Secrets discipline

`required_env_vars[]` records **names only**. Secret values NEVER appear
in any tracker file. Storage rules:

- Plain-text local: `.env` (gitignored).
- Production: a secret manager (e.g. cloud secret store, K8s secret,
  vendor vault).
- Per-developer: a `.env.local` (gitignored).

Sprint commands do not read or store secret values. They check whether
the `name` is present in the environment, not whether the value is
correct. (Correctness is the responsibility of the actual integration
code at runtime.)

## Mock-vs-sandbox-vs-production

Three runtime modes for an ESD:

1. **Mock** — `can_mock: true`, `status: mocked`. A fake implementation
   answers requests deterministically. Useful in QA and unit tests.
   `mock_strategy` describes what the mock does.
2. **Sandbox** — `sandbox_available: true`, `status: integrated`.
   Real provider, but using test credentials. No real money / SMS /
   email goes out.
3. **Production** — `production_required: true`, `status: integrated`,
   with `approval_required: true` enforced.

Most sprints should ship via Mock → Sandbox → Production transitions
with approval gates between each.

## Adoption: portable, vendor-neutral, downstream-specific

Vendor-specific provider adapters live in the **downstream** product
repo, not in the framework. The framework only provides:

- The ESD schema + template.
- The lifecycle commands (`scripts/sprint/external-service.js`).
- The approval enforcement (`external-service.js gate`).
- The dependency artifact format that's portable across vendors.

A downstream product that adopts Stripe writes a Stripe-specific adapter
under its own `src/integrations/payment/stripe/` and references the ESD
via `linked_external_services` on the relevant ticket.

## Setup checklist

Sprint v0.1 ships a per-ESD setup checklist template at
`framework/templates/sprint/external-service/setup-checklist.md.tmpl`.
Rendered into the downstream repo's documentation. Covers:

- Human setup (signup, billing, credentials, OAuth, DNS, compliance).
- Terminal setup (env vars, adapter implementation, mock, TRACE wiring,
  QA additions).
- Required env vars (names only).
- Approval gate.
- Documentation scaling note.

## See also

- `paths.sprintReference`
- `_docs/sprint/OVERVIEW.md`
- `schemas/sprint/external-service-dependency.schema.json`
