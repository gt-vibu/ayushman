# Architecture and implementation status

## Product boundary

The medical clinic happy flow is one example of a profession-neutral practice workflow. A practice can enable professions, set its terminology, open branches, assign professionals, configure services and schedules, and book a client. The data model does not require doctor, patient, or consultation terminology; a different profession can use its own labels.

Medical-only records such as prescriptions and diagnoses are outside the appointment-booking core and belong in later profession-specific modules.

## Architecture

- pnpm + Turborepo workspace with a NestJS modular API, PostgreSQL/Drizzle, Redis, and shared Zod contracts.
- PostgreSQL is the source of truth. Tenant relationships are reinforced with composite foreign keys, availability and appointment exclusion constraints, and lifecycle triggers.
- Schedules are recurring local wall-clock intervals in an IANA timezone. Slots are computed from branch hours, professional hours, service duration/buffers, exceptions, booking policy, and reserved appointments.
- Redis caches public directory results for 30 seconds and availability results for 8 seconds. Booking always recomputes availability and relies on the database overlap constraint as the final guard.
- Client records remain practice-scoped and appointments reference those records. Client lookup and history queries filter to practice, branch, and/or professional access.
- Practice membership RBAC is separate from platform superadmin/support RBAC. Custom per-member denies win; only practice owners can change custom overrides or grant the admin role.
- Sessions use random opaque tokens with hashed server-side storage, Argon2id password hashes, HTTP-only cookies, rate limits, and generic sign-in failures.

## Current implementation status

The current app includes practice/customer authentication, practice setup, team roles and permission overrides, professional profiles, branches, services, schedules, public booking, appointment lifecycle and follow-ups, client history, files and session recordings, invoices/manual payment recording, customer cancellation/rescheduling, in-app notifications, and a basic waitlist capture/staff queue. See `docs/API.md` and `docs/edge-case-requirements.md` for route and scenario status; those status documents are maintained separately from this architecture note.

The ignored `rebuild/.env` is the local-only database configuration. Local migrations are applied through `0041_flat_vindicator.sql`; this does not establish the migration state of Neon or any other hosted database. Do not use the local migration command against hosted data without an explicit deployment task.

## External integrations and product boundaries

Email/SMS delivery and payment gateways are not configured. The app can store manual payment entries and in-app notifications; it does not claim that a gateway or external delivery provider is active. Medical-only records such as prescriptions and diagnoses remain profession-specific modules outside the appointment-booking core. Platform superadmin accounts are created explicitly with the `bootstrap:superadmin` command; credentials are not stored in migrations.
