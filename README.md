# Ayushman Happy Flow (rebuild)

Isolated Turborepo workspace for general practice setup and service booking across professions. The existing Ayushman application remains in the parent workspace while this backend is developed.

## Workspace

- `apps/api`: NestJS modular monolith and versioned HTTP API.
- `apps/web`: practice workspace UI on port 3101, wired to authenticated setup, team, service, client, and appointment routes.
- `apps/web-admin`: independent platform administration UI on port 3102; it uses the shared Ayushman API and identity store with platform-only login and permissions.
- `packages/db`: Drizzle schema, migrations, and database connection.
- `packages/contracts`: Zod request/response contracts shared with the future frontend.

## Local setup

Use Node 22+, pnpm 10, PostgreSQL, and Redis. The ignored local `.env` currently points to the cleaned `Ayushman` development database; no SmartTeam HR database is used. Copy `.env.example` only if creating a different local setup, then run `pnpm install`, `pnpm db:migrate`, and `pnpm dev`.

The API listens on port 4100, the practice app runs on port 3101, and the separate platform admin UI runs on port 3102. Platform credentials are not hard-coded: set `SUPERADMIN_EMAIL` and a unique 12–128 character `SUPERADMIN_PASSWORD` in `.env`, then run `pnpm --filter @ayushman-v2/api db:seed`. The seed hashes with Argon2id, grants the platform role, and does not change an existing password. Platform-only accounts cannot have active practice memberships and use the `ayushman_platform_session` cookie.

## General happy-flow demo

Set `DEMO_PRACTITIONER_EMAIL`, `DEMO_PRACTITIONER_PASSWORD`, and `DEMO_CUSTOMER_PASSWORD` in `.env`, then run:

```bash
pnpm db:migrate
pnpm db:seed:demo
```

The idempotent seed creates a general professional-services practice, practitioner account, location, bookable service, weekday availability, and Jordan Lee's linked customer account and practice client record. It refuses to run when `NODE_ENV=production`.

- Practice teams sign in at `/login`.
- Customers sign in at `/customer/login` or register at `/customer/register`.
- Customers discover practices at `/book`, then must sign in before booking.
- `/customer/account` provides contact profile, linked practice records, and appointment history.
- Authenticated bookings are attached to the customer's account and the selected practice's client record; the practitioner sees the same client and appointment in the practice workspace.

Customer auth uses a separate HttpOnly session cookie. Email verification is not wired yet; existing historical client records are not claimed from an unverified email address. The seeded Jordan Lee client record is explicitly linked by the demo seed.

See `docs/API.md` for routes and setup order and `docs/DATABASE.md` for tenant relationships, migrations, and RBAC boundaries. Email verification, payments, and client self-cancellation are not wired yet.
