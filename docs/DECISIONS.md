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

## Implemented backend

The current backend provides auth/session, practice profile and profession setup, branches, staff roles and branch assignment, staff invitations, professional profiles, services, recurring hours, exceptions, booking policies, public discovery, availability, public booking, client lookup, and appointment lifecycle routes. Migrations through `0012_famous_silver_samurai.sql` are applied to the local Ayushman database. The database has 33 tables; reference permissions/role grants are seeded, while user and practice data remain empty.

Use `docs/API.md` for route order and `docs/DATABASE.md` for schema relationships. The generated Swagger UI is mounted by the API app.

## Not included in this backend slice

Automated invitation email, reminders, email notifications, payment processing, client self-service cancellation, and clinical-record modules need separate providers or product decisions. Online booking returns a conflict when prepayment is required but no payment provider exists. The platform superadmin account is created explicitly with the `bootstrap:superadmin` command; credentials are not stored in migrations.

The implementation has passed TypeScript typechecking and Drizzle reports no schema drift. The end-to-end API flow has not yet been smoke-tested against populated demo records; seed data and frontend wiring are the next integration step.
