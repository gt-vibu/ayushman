import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, updatedAt, membershipRole, membershipStatus } from './shared.js';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('users_email_normalized_uq').on(sql`lower(${table.email})`)]);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_user_expiry_idx').on(table.userId, table.expiresAt)],
);

export const customerProfiles = pgTable('customer_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  phone: varchar('phone', { length: 32 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const practices = pgTable(
  'practices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 180 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    description: text('description'),
    phone: varchar('phone', { length: 32 }),
    website: varchar('website', { length: 500 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    publicBookingEnabled: boolean('public_booking_enabled').notNull().default(true),
    publicListingEnabled: boolean('public_listing_enabled').notNull().default(true),
    sessionRecordingEnabled: boolean('session_recording_enabled').notNull().default(false),
    sessionRecordingRetentionDays: integer('session_recording_retention_days').notNull().default(90),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('practices_slug_normalized_uq').on(sql`lower(${table.slug})`),
    index('practices_public_discovery_idx').on(table.active, table.publicListingEnabled, table.slug),
    check('practices_currency_length_check', sql`length(${table.currency}) = 3`),
    check('practices_session_recording_retention_check', sql`${table.sessionRecordingRetentionDays} BETWEEN 1 AND 3650`),
    check('practices_slug_format_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const professionCatalog = pgTable('profession_catalog', {
  code: varchar('code', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  defaultTerms: jsonb('default_terms').$type<Record<string, string>>().notNull(),
  profileFields: jsonb('profile_fields').$type<Array<{
    key: string;
    label: string;
    type: 'text' | 'long_text' | 'select';
    options?: string[];
  }>>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const practiceProfessions = pgTable(
  'practice_professions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    professionCode: varchar('profession_code', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    termOverrides: jsonb('term_overrides').$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('practice_professions_code_uq').on(table.practiceId, table.professionCode),
    uniqueIndex('practice_professions_id_practice_uq').on(table.id, table.practiceId),
    check('practice_profession_code_format_check', sql`${table.professionCode} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const practiceMemberships = pgTable(
  'practice_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('practice_memberships_practice_user_uq').on(table.practiceId, table.userId),
    uniqueIndex('practice_memberships_practice_id_uq').on(table.practiceId, table.id),
    index('practice_memberships_user_idx').on(table.userId, table.status),
  ],
);

export const practiceMembershipRoles = pgTable(
  'practice_membership_roles',
  {
    membershipId: uuid('membership_id').notNull().references(() => practiceMemberships.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.role] })],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 140 }).notNull(),
    address: jsonb('address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postalCode?: string;
      countryCode: string;
      latitude?: number;
      longitude?: number;
    }>(),
    timezone: varchar('timezone', { length: 64 }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('locations_practice_name_uq').on(table.practiceId, table.name),
    index('locations_practice_active_idx').on(table.practiceId, table.active),
    uniqueIndex('locations_id_practice_uq').on(table.id, table.practiceId),
    uniqueIndex('locations_practice_id_uq').on(table.practiceId, table.id),
  ],
);

export const practiceMembershipLocations = pgTable(
  'practice_membership_locations',
  {
    practiceId: uuid('practice_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    locationId: uuid('location_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.locationId] }),
    index('membership_locations_location_idx').on(table.locationId, table.membershipId),
    foreignKey({
      name: 'membership_locations_membership_practice_fk',
      columns: [table.practiceId, table.membershipId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_locations_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
  ],
);
