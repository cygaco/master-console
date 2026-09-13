# Analytics and Product Event Taxonomy

MC-generated apps use a small, stable event vocabulary. Events describe user or system outcomes, not implementation details.

## Standard Events

| Event | Required properties | Notes |
|---|---|---|
| `user_signed_up` | `user_id`, `method`, `created_at` | Do not include email unless explicitly approved. |
| `workspace_created` | `workspace_id`, `user_id`, `plan` | One event per workspace. |
| `invite_sent` | `workspace_id`, `inviter_id`, `invite_role` | Do not log invitee email in public telemetry. |
| `checkout_started` | `user_id`, `plan`, `price_id` | Pair with server-side payment logs. |
| `feature_completed` | `user_id`, `feature_id`, `duration_ms` | Use canonical feature IDs. |
| `error_seen` | `surface`, `error_code`, `recoverable` | Message text must be safe to log. |

## Event Rules

- Use snake_case names.
- Use stable IDs, not display names, for users, workspaces, plans, and features.
- Never log secrets, raw prompts, uploaded files, resumes, payment details, or OAuth tokens.
- Every event must have an owner, retention policy, and purpose.
- Product analytics and framework runtime events stay separate. Framework runtime events use the existing event logger.

## Review

New event names require an entry in this document or a feature-specific extension section. Reviewers should flag unregistered product events as design drift.
