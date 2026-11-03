# Database schema

The rebuild uses PostgreSQL with Drizzle migrations. The schema is profession-neutral: a practice can register one or more profession codes and provide its own visible terminology. Profession-specific profile fields and terminology are stored as JSONB configuration; scheduling, services, locations, clients, and appointments use typed relational tables.

## Model

- `users` and `sessions` store sign-in identities and revocable, expiring sessions. Passwords are stored as hashes; session tokens are stored as hashes.
- `practices` is the tenant boundary and stores public profile, listing, booking, currency, and timezone settings. `practice_memberships` and `practice_membership_roles` assign people to a practice with multiple roles. `practice_membership_locations` restricts branch-scoped staff accounts to their assigned branches.
- `profession_catalog` contains generic reference defaults. `practice_professions` stores each practice's enabled profession codes and terminology overrides.
- `locations`, `professional_profiles`, and `professional_locations` model branches, profession-specific public profiles, and where professionals work.
- `services`, `service_professionals`, and `service_locations` model duration, buffers, optional price, active state, and explicitly eligible staff/branches. Assignment rows are deactivated rather than deleted so appointments retain their historical foreign-key links. Composite foreign keys keep these assignments within the same practice and profession.
- `availability_rules`, `availability_exceptions`, and `booking_policies` keep business opening times, professional availability, closures/extra hours, and booking rules separate.
- `clients` and `appointments` persist the shared booking flow. Every appointment references a client in the same practice, so all of that client's appointments can be queried together. Appointments also reference a same-practice location, service, profession, and professional membership, and snapshot service name, duration, price, currency, and buffers when booked. `appointment_events` records the initial status and each allowed status transition. `idempotency_keys` make booking retries safe; `audit_events` provide a practice-scoped change trail.
- `booking_waitlist` stores a requested service, location, date, and customer contact. Partial unique indexes prevent duplicate active requests for the same practice/service/location/date when either normalized email or phone matches; closed/booked requests do not block a later request.
- `permission_catalog`, `role_permission_grants`, and `membership_permission_overrides` define the RBAC matrix. The seeded roles are owner, admin, professional, and scheduler. Owners have all catalogued permissions; admins have practice-management permissions; professionals receive own-record permissions; schedulers receive branch-assigned booking permissions. Per-member deny overrides take precedence over role grants. The API authorization service checks active membership, branch assignment, role scope, and overrides. Sensitive clinical-record permissions are not granted to schedulers.
- `staff_invitations` and its role/branch join tables store expiring one-time staff invitations. The token is stored as a hash, and accepting an invitation creates the user, practice membership, roles, and branch assignments in one transaction.
- `platform_memberships`, `platform_membership_roles`, `platform_permission_catalog`, and `platform_role_permission_grants` provide separate platform-level superadmin/support permissions. Platform roles are not practice roles and must never be inferred from a practice membership.

## Integrity and performance

- Foreign keys use explicit delete behavior. Appointment composite foreign keys prevent pairing a practice with another practice's location, service, client, or professional membership.
- Check constraints validate durations, prices, currencies, time ranges, weekdays, and policy ranges.
- A PostgreSQL GiST exclusion constraint prevents overlapping reserved appointment ranges for the same professional; cancelled appointments release their reserved time.
- Availability rules reject overlapping active periods at the same practice, branch, professional, or professional/branch scope. Appointment transitions are constrained to the supported booking lifecycle and recorded automatically by database triggers.
- Unique indexes enforce normalized user email, practice membership, profession code, location name, idempotency key, and active waitlist request uniqueness.
- Composite B-tree indexes cover public discovery, the main tenant/date/status lists, availability lookups, session expiry, normalized client contact search, service discovery, reverse lookups on join tables, exception dates, appointment history, and audit history. Indexes are attached to query paths or foreign-key reverse lookups rather than added indiscriminately.
- Composite foreign keys on branch/profession, service/professional, service/branch, membership/branch, and appointment references prevent records from being linked across practices. A practitioner assigned to a service must have a profile for that practice profession; a service branch must have that profession enabled there.

## Local database

The rebuild's ignored `.env` points to the local `Ayushman` database (`127.0.0.1`). Migrations are applied through `0041_flat_vindicator.sql`. The schema currently defines 46 tables, including practice and platform permissions, invoice/payment records, client files, session recordings, and the booking waitlist. Migration state does not imply that every table is empty or that hosted databases are current. No hosted database was changed as part of this local pass.

Run `pnpm --filter @ayushman-v2/api db:seed` after setting `SUPERADMIN_EMAIL` and a unique 12–128 character `SUPERADMIN_PASSWORD` in the ignored `.env` to create the initial platform account. The script does not overwrite an existing user's password. Platform accounts use the same `users` identity table, but are required to remain outside active practice memberships and have a separate platform session cookie and login flow.

The API exposes the setup, booking, appointment lifecycle, customer self-service cancellation/rescheduling, records, billing, and in-app notification routes documented in `API.md`. External email/SMS delivery and payment gateways are not configured; manual payment records and invoices remain separate app functionality.

From `rebuild/packages/db`, use `pnpm db:generate` to create a migration and `pnpm db:migrate` to apply pending migrations. Do not point this local development configuration at production data.
