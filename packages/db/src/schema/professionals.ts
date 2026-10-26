import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, updatedAt } from './shared.js';
import { locations, practiceMemberships, practiceProfessions, practices, users } from './identity.js';

export const locationProfessions = pgTable(
  'location_professions',
  {
    practiceProfessionId: uuid('practice_profession_id').notNull().references(() => practiceProfessions.id, { onDelete: 'cascade' }),
    practiceId: uuid('practice_id').notNull(),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.practiceProfessionId, table.locationId] }),
    index('location_professions_location_idx').on(table.locationId),
    foreignKey({
      name: 'location_professions_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'location_professions_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
  ],
);

export const professionalProfiles = pgTable(
  'professional_profiles',
  {
    practiceProfessionId: uuid('practice_profession_id').notNull().references(() => practiceProfessions.id, { onDelete: 'cascade' }),
    practiceId: uuid('practice_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    headline: varchar('headline', { length: 160 }),
    bio: text('bio'),
    profileAttributes: jsonb('profile_attributes').$type<Record<string, string | string[]>>().notNull().default({}),
    publicProfile: boolean('public_profile').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.practiceProfessionId, table.userId] }),
    index('professional_profiles_user_idx').on(table.userId, table.publicProfile),
    index('professional_profiles_public_search_idx').on(table.practiceProfessionId, table.publicProfile),
    foreignKey({
      name: 'professional_profiles_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_profiles_membership_fk',
      columns: [table.practiceId, table.userId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const professionalLocations = pgTable(
  'professional_locations',
  {
    practiceProfessionId: uuid('practice_profession_id').notNull().references(() => practiceProfessions.id, { onDelete: 'cascade' }),
    practiceId: uuid('practice_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.practiceProfessionId, table.userId, table.locationId] }),
    index('professional_locations_user_idx').on(table.userId, table.locationId),
    index('professional_locations_location_idx').on(table.locationId),
    foreignKey({
      name: 'professional_locations_profile_fk',
      columns: [table.practiceProfessionId, table.userId],
      foreignColumns: [professionalProfiles.practiceProfessionId, professionalProfiles.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_locations_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_locations_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_locations_branch_profession_fk',
      columns: [table.practiceProfessionId, table.locationId],
      foreignColumns: [locationProfessions.practiceProfessionId, locationProfessions.locationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'professional_locations_membership_fk',
      columns: [table.practiceId, table.userId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    practiceProfessionId: uuid('practice_profession_id').notNull().references(() => practiceProfessions.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
    priceMinor: integer('price_minor'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    onlineBookable: boolean('online_bookable').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('services_duration_positive_check', sql`${table.durationMinutes} > 0`),
    check('services_buffers_nonnegative_check', sql`${table.bufferBeforeMinutes} >= 0 AND ${table.bufferAfterMinutes} >= 0`),
    check('services_price_nonnegative_check', sql`${table.priceMinor} IS NULL OR ${table.priceMinor} >= 0`),
    index('services_practice_active_idx').on(table.practiceId, table.active, table.onlineBookable),
    index('services_profession_active_idx').on(table.practiceProfessionId, table.active),
    uniqueIndex('services_id_practice_uq').on(table.id, table.practiceId),
    uniqueIndex('services_id_practice_profession_uq').on(table.id, table.practiceId, table.practiceProfessionId),
    foreignKey({
      name: 'services_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('restrict'),
  ],
);

export const serviceProfessionals = pgTable(
  'service_professionals',
  {
    serviceId: uuid('service_id').notNull(),
    practiceId: uuid('practice_id').notNull(),
    practiceProfessionId: uuid('practice_profession_id').notNull(),
    professionalUserId: uuid('professional_user_id').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.professionalUserId] }),
    index('service_professionals_professional_idx').on(table.professionalUserId, table.serviceId),
    uniqueIndex('service_professionals_assignment_uq').on(table.serviceId, table.professionalUserId, table.practiceId),
    foreignKey({
      name: 'service_professionals_service_practice_fk',
      columns: [table.serviceId, table.practiceId, table.practiceProfessionId],
      foreignColumns: [services.id, services.practiceId, services.practiceProfessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_professionals_profile_fk',
      columns: [table.practiceProfessionId, table.professionalUserId],
      foreignColumns: [professionalProfiles.practiceProfessionId, professionalProfiles.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_professionals_membership_fk',
      columns: [table.practiceId, table.professionalUserId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const serviceLocations = pgTable(
  'service_locations',
  {
    serviceId: uuid('service_id').notNull(),
    practiceId: uuid('practice_id').notNull(),
    practiceProfessionId: uuid('practice_profession_id').notNull(),
    locationId: uuid('location_id').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.locationId] }),
    index('service_locations_location_idx').on(table.locationId, table.serviceId),
    foreignKey({
      name: 'service_locations_service_practice_fk',
      columns: [table.serviceId, table.practiceId, table.practiceProfessionId],
      foreignColumns: [services.id, services.practiceId, services.practiceProfessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_locations_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_locations_profession_enabled_fk',
      columns: [table.practiceProfessionId, table.locationId],
      foreignColumns: [locationProfessions.practiceProfessionId, locationProfessions.locationId],
    }).onDelete('cascade'),
  ],
);
