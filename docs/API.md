# API happy-flow contract

The API listens on `API_PORT` with `/api/v1` as its prefix. Nest Swagger is exposed at `/api/docs`. Authenticated endpoints use the `ayushman_session` HTTP-only cookie. Sign-in, registration, and public booking/discovery requests are rate-limited through Redis. All request bodies and query parameters are validated with the shared Zod contracts in `packages/contracts`.

The separate `apps/web-admin` platform UI uses the same API and `users` table, but platform sign-in is `POST /api/v1/auth/platform-login` and sets a distinct `ayushman_platform_session` cookie. `GET /api/v1/auth/platform-me` verifies the platform session; `POST /api/v1/auth/platform-logout` revokes it. `GET /api/v1/platform/overview` requires `platform.practices.read`. Platform accounts must not have active practice memberships and organization login rejects them. Bootstrap credentials are supplied through environment variables and are Argon2id hashed; rerunning the bootstrap does not reset an existing password.

## Setup and team

1. `POST /api/v1/auth/register` creates the first user, practice, owner membership, and default booking policy. `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, and `GET /api/v1/auth/me` manage the browser session and list active practice memberships.
2. `PATCH /api/v1/practices/:practiceId` configures practice profile, timezone, listing, and public booking. `GET|POST /professions` enables profession-neutral labels and terminology; `PATCH /professions/:professionId` edits or disables one.
3. `GET|POST /locations` lists or creates branches. `PATCH /locations/:locationId` updates or deactivates one. `POST /locations/:locationId/professions` enables/disables a profession for that branch.
4. `GET|POST /staff` lists or links existing accounts. `PATCH /staff/:userId/roles`, `/locations`, and `/status` manage membership access. Use `POST /staff/invitations` for new staff and `DELETE /staff/invitations/:invitationId` to revoke an invitation. Invitation acceptance is `POST /api/v1/invitations/accept` for a new account or authenticated `POST /api/v1/invitations/accept-existing` for an existing account.
5. `POST /staff/:userId/professional-profile` links a professional to an enabled practice profession and selected branches. `GET|POST /services` lists or creates a service; `PATCH /services/:serviceId` edits it and replaces its active staff/branch assignments while preserving inactive assignment rows used by historical bookings.
6. `GET|POST /availability/rules`, `DELETE /availability/rules/:ruleId`, and `GET|POST|DELETE /availability/exceptions` manage recurring hours, breaks (represented as separate intervals), closures, and extra hours. `GET|POST /booking-policy` reads or updates booking rules.
7. `GET /permissions`, `GET /staff/:userId/permissions`, and `PUT /staff/:userId/permissions` expose the permission catalog and owner-controlled per-member overrides. Deny overrides win. Only owners can grant the administrator role or change custom permission overrides.

The practice setup routes above are relative to `/api/v1/practices/:practiceId`. A professional profile must exist before adding that person to a service. A profession must be enabled at each selected branch. Service assignments require at least one active eligible professional and branch.

## Public discovery and booking

- `GET /api/v1/public/directory?q=...` searches practices, enabled profession names, bookable services, and public professional profiles.
- `GET /api/v1/public/practices/:practiceId` returns the public practice, branches, professions, services, and eligible public professional profiles.
- `GET /api/v1/public/practices/:practiceId/availability?serviceId=...&locationId=...&from=YYYY-MM-DD&to=YYYY-MM-DD&professionalUserId=...` computes future slots in the practice timezone from branch hours, professional hours, exceptions, buffers, booking policy, and existing bookings. A request can cover at most 31 days. Availability responses are cached in Redis for eight seconds; booking validation bypasses this cache.
- `POST /api/v1/public/practices/:practiceId/bookings` accepts `Idempotency-Key` plus service, branch, professional, start time, and client contact details. The server rechecks the slot, records/reuses the client, snapshots the service terms, and relies on the database exclusion constraint as the final concurrency guard. Repeating the same key and body returns the original response.

## Practice operations

- `GET /api/v1/practices/:practiceId/appointments` accepts optional `from`, `to`, `locationId`, `clientId`, `status`, and `limit` query parameters. The response includes client contact fields under the caller's `appointments.read` and `clients.read` access.
- `GET /api/v1/practices/:practiceId/clients?q=...&locationId=...` searches client records; branch-scoped and own-record permissions constrain the underlying appointment relationship.
- `POST /api/v1/practices/:practiceId/appointments/:appointmentId/status` accepts one lifecycle transition. Database triggers reject invalid transitions and write the event history; the API also writes an audit event.

The practice roles are separate from platform roles. `POST /api/v1/auth/register` is for creating a practice owner. Staff joining an existing practice should use an invitation, not general registration, so they do not accidentally create an extra practice.

## Provider-backed features still pending

Staff invitations return a one-time acceptance URL for the practice admin to deliver. No email provider is configured yet. Email notifications, payment processing, client self-service cancellation, and SMS/email reminders are not implemented; `requirePrepayment=true` therefore blocks public booking instead of silently accepting an unpaid booking. The platform superadmin role and permission grants are seeded, but a platform account must be created with the explicit `bootstrap:superadmin` command.
