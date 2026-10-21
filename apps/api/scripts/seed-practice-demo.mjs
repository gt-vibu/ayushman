import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import argon2 from 'argon2';
import postgres from 'postgres';

const envPath = resolve(process.cwd(), '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (process.env.NODE_ENV === 'production') throw new Error('The demo seed is disabled in production.');

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.DEMO_PRACTITIONER_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_PRACTITIONER_PASSWORD;
const customerEmail = (process.env.DEMO_CUSTOMER_EMAIL ?? 'jordan.lee@example.test').trim().toLowerCase();
const customerPassword = process.env.DEMO_CUSTOMER_PASSWORD;
if (!databaseUrl || !email || !password || password.length < 12 || !customerPassword || customerPassword.length < 12) {
  throw new Error('Set DATABASE_URL, practitioner demo credentials, and a 12+ character DEMO_CUSTOMER_PASSWORD in the local environment.');
}

const db = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const customerHash = await argon2.hash(customerPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

try {
  const seeded = await db.begin(async (tx) => {
    const [user] = await tx`
      INSERT INTO users (email, full_name, password_hash)
      VALUES (${email}, 'Taylor Morgan', ${hash})
      ON CONFLICT (lower(email)) DO UPDATE
      SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, disabled_at = NULL, updated_at = now()
      RETURNING id
    `;
    const [customerUser] = await tx`
      INSERT INTO users (email, full_name, password_hash)
      VALUES (${customerEmail}, 'Jordan Lee', ${customerHash})
      ON CONFLICT (lower(email)) DO UPDATE
      SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, disabled_at = NULL, updated_at = now()
      RETURNING id
    `;
    await tx`INSERT INTO customer_profiles (user_id, phone) VALUES (${customerUser.id}, '+919876543210')
      ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = now()`;
    const [practice] = await tx`
      INSERT INTO practices (name, slug, description, timezone, currency, public_booking_enabled, public_listing_enabled)
      VALUES ('Northstar Practice', 'northstar-demo', 'A general professional practice for exploring the booking flow.', 'Asia/Kolkata', 'INR', true, true)
      ON CONFLICT (lower(slug)) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        timezone = EXCLUDED.timezone, currency = EXCLUDED.currency, public_booking_enabled = true,
        public_listing_enabled = true, active = true, updated_at = now()
      RETURNING id
    `;
    const [membership] = await tx`
      INSERT INTO practice_memberships (practice_id, user_id, status)
      VALUES (${practice.id}, ${user.id}, 'active')
      ON CONFLICT (practice_id, user_id) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING id
    `;
    await tx`INSERT INTO practice_membership_roles (membership_id, role) VALUES (${membership.id}, 'owner'), (${membership.id}, 'professional') ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO booking_policies (practice_id, max_advance_days, min_notice_minutes, cancellation_cutoff_minutes, guest_booking_enabled, patient_cancellation_enabled, email_notifications_enabled, require_prepayment, confirmation_mode)
      VALUES (${practice.id}, 30, 60, 360, true, true, false, false, 'immediate')
      ON CONFLICT (practice_id) DO UPDATE SET max_advance_days = 30, min_notice_minutes = 60, guest_booking_enabled = true, require_prepayment = false, confirmation_mode = 'immediate', updated_at = now()`;

    const [profession] = await tx`
      INSERT INTO practice_professions (practice_id, profession_code, name, enabled, term_overrides)
      VALUES (${practice.id}, 'general', 'Professional Services', true,
        '{"professionalSingular":"professional","professionalPlural":"professionals","clientSingular":"client","clientPlural":"clients","serviceSingular":"service","servicePlural":"services","appointmentSingular":"appointment","locationSingular":"location"}'::jsonb)
      ON CONFLICT (practice_id, profession_code) DO UPDATE SET name = EXCLUDED.name, enabled = true, term_overrides = EXCLUDED.term_overrides
      RETURNING id
    `;
    const [location] = await tx`
      INSERT INTO locations (practice_id, name, address, timezone, active)
      VALUES (${practice.id}, 'Central Workspace', '{"line1":"100 Demo Avenue","city":"Bengaluru","state":"Karnataka","postalCode":"560001","countryCode":"IN"}'::jsonb, 'Asia/Kolkata', true)
      ON CONFLICT (practice_id, name) DO UPDATE SET address = EXCLUDED.address, timezone = EXCLUDED.timezone, active = true, updated_at = now()
      RETURNING id
    `;
    await tx`INSERT INTO location_professions (practice_profession_id, practice_id, location_id, enabled)
      VALUES (${profession.id}, ${practice.id}, ${location.id}, true)
      ON CONFLICT (practice_profession_id, location_id) DO UPDATE SET enabled = true`;
    await tx`INSERT INTO professional_profiles (practice_profession_id, practice_id, user_id, headline, bio, profile_attributes, public_profile)
      VALUES (${profession.id}, ${practice.id}, ${user.id}, 'Independent professional', 'Book a focused introductory session and explore how this practice works.', '{}'::jsonb, true)
      ON CONFLICT (practice_profession_id, user_id) DO UPDATE SET headline = EXCLUDED.headline, bio = EXCLUDED.bio, public_profile = true, updated_at = now()`;
    await tx`INSERT INTO professional_locations (practice_profession_id, practice_id, user_id, location_id, is_primary)
      VALUES (${profession.id}, ${practice.id}, ${user.id}, ${location.id}, true)
      ON CONFLICT (practice_profession_id, user_id, location_id) DO UPDATE SET is_primary = true`;
    await tx`INSERT INTO practice_membership_locations (practice_id, membership_id, location_id)
      VALUES (${practice.id}, ${membership.id}, ${location.id}) ON CONFLICT DO NOTHING`;

    let [service] = await tx`SELECT id FROM services WHERE practice_id = ${practice.id} AND name = 'Introductory Session' LIMIT 1`;
    if (service) {
      [service] = await tx`UPDATE services SET practice_profession_id = ${profession.id}, description = 'A first session to understand your goals and agree on next steps.', duration_minutes = 30, buffer_before_minutes = 0, buffer_after_minutes = 0, price_minor = 120000, currency = 'INR', online_bookable = true, active = true, updated_at = now() WHERE id = ${service.id} RETURNING id`;
    } else {
      [service] = await tx`INSERT INTO services (practice_id, practice_profession_id, name, description, duration_minutes, price_minor, currency, online_bookable, active)
        VALUES (${practice.id}, ${profession.id}, 'Introductory Session', 'A first session to understand your goals and agree on next steps.', 30, 120000, 'INR', true, true) RETURNING id`;
    }
    await tx`INSERT INTO service_professionals (service_id, practice_id, practice_profession_id, professional_user_id, active)
      VALUES (${service.id}, ${practice.id}, ${profession.id}, ${user.id}, true)
      ON CONFLICT (service_id, professional_user_id) DO UPDATE SET active = true`;
    await tx`INSERT INTO service_locations (service_id, practice_id, practice_profession_id, location_id, active)
      VALUES (${service.id}, ${practice.id}, ${profession.id}, ${location.id}, true)
      ON CONFLICT (service_id, location_id) DO UPDATE SET active = true`;

    await tx`DELETE FROM availability_rules WHERE practice_id = ${practice.id} AND location_id = ${location.id} AND scope IN ('location', 'professional_location') AND (professional_user_id IS NULL OR professional_user_id = ${user.id})`;
    const weekdays = [1, 2, 3, 4, 5];
    for (const weekday of weekdays) {
      await tx`INSERT INTO availability_rules (practice_id, scope, location_id, weekday, start_minute, end_minute, slot_interval_minutes)
        VALUES (${practice.id}, 'location', ${location.id}, ${weekday}, 480, 1080, 30)`;
      await tx`INSERT INTO availability_rules (practice_id, scope, practice_profession_id, location_id, professional_user_id, weekday, start_minute, end_minute, slot_interval_minutes)
        VALUES (${practice.id}, 'professional_location', ${profession.id}, ${location.id}, ${user.id}, ${weekday}, 540, 1020, 30)`;
    }

    const clientEmail = 'jordan.lee@example.test';
    const existingClient = await tx`SELECT id FROM clients WHERE practice_id = ${practice.id} AND lower(email) = ${clientEmail} LIMIT 1`;
    if (existingClient.length) {
      await tx`UPDATE clients SET user_id = ${customerUser.id}, full_name = 'Jordan Lee', email = ${clientEmail}, phone = '+919876543210', updated_at = now() WHERE id = ${existingClient[0].id}`;
    } else {
      await tx`INSERT INTO clients (practice_id, user_id, full_name, email, phone) VALUES (${practice.id}, ${customerUser.id}, 'Jordan Lee', ${clientEmail}, '+919876543210')`;
    }
    return { practiceId: practice.id, locationName: 'Central Workspace', serviceName: 'Introductory Session' };
  });
  console.log(`Demo practice ready: ${seeded.practiceId}`);
  console.log(`Practitioner sign-in: ${email}`);
  console.log(`Customer sign-in: ${customerEmail}`);
  console.log(`Customer booking page: http://localhost:3101/book/${seeded.practiceId}`);
} finally {
  await db.end();
}
