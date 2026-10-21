import { boolean, check, date, foreignKey, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, updatedAt, availabilityScope, exceptionKind } from './shared.js';
import { locations, practiceMemberships, practiceProfessions, practices, users } from './identity.js';
import { professionalLocations, professionalProfiles } from './professionals.js';

export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    scope: availabilityScope('scope').notNull(),
    practiceProfessionId: uuid('practice_profession_id').references(() => practiceProfessions.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    professionalUserId: uuid('professional_user_id').references(() => users.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    slotIntervalMinutes: integer('slot_interval_minutes').notNull().default(30),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('availability_weekday_check', sql`${table.weekday} BETWEEN 0 AND 6`),
    check('availability_time_range_check', sql`${table.startMinute} >= 0 AND ${table.startMinute} < ${table.endMinute} AND ${table.endMinute} <= 1440`),
    check('availability_interval_check', sql`${table.slotIntervalMinutes} BETWEEN 5 AND 240`),
    check('availability_scope_refs_check', sql`(${table.scope} = 'practice' AND ${table.locationId} IS NULL AND ${table.professionalUserId} IS NULL AND ${table.practiceProfessionId} IS NULL) OR (${table.scope} = 'location' AND ${table.locationId} IS NOT NULL AND ${table.professionalUserId} IS NULL AND ${table.practiceProfessionId} IS NULL) OR (${table.scope} = 'professional' AND ${table.locationId} IS NULL AND ${table.professionalUserId} IS NOT NULL AND ${table.practiceProfessionId} IS NOT NULL) OR (${table.scope} = 'professional_location' AND ${table.locationId} IS NOT NULL AND ${table.professionalUserId} IS NOT NULL AND ${table.practiceProfessionId} IS NOT NULL)`),
    index('availability_lookup_idx').on(table.practiceId, table.weekday, table.active),
    index('availability_location_idx').on(table.locationId, table.weekday),
    index('availability_professional_idx').on(table.professionalUserId, table.weekday),
    foreignKey({
      name: 'availability_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_professional_membership_fk',
      columns: [table.practiceId, table.professionalUserId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_professional_profile_fk',
      columns: [table.practiceProfessionId, table.professionalUserId],
      foreignColumns: [professionalProfiles.practiceProfessionId, professionalProfiles.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_professional_location_fk',
      columns: [table.practiceProfessionId, table.professionalUserId, table.locationId],
      foreignColumns: [professionalLocations.practiceProfessionId, professionalLocations.userId, professionalLocations.locationId],
    }).onDelete('cascade'),
  ],
);

export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    professionalUserId: uuid('professional_user_id').references(() => users.id, { onDelete: 'cascade' }),
    practiceProfessionId: uuid('practice_profession_id').references(() => practiceProfessions.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    kind: exceptionKind('kind').notNull(),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    reason: varchar('reason', { length: 240 }),
    createdAt: createdAt(),
  },
  (table) => [
    check('exception_time_pair_check', sql`(${table.startMinute} IS NULL AND ${table.endMinute} IS NULL) OR (${table.startMinute} >= 0 AND ${table.startMinute} < ${table.endMinute} AND ${table.endMinute} <= 1440)`),
    check('exception_scope_check', sql`(${table.locationId} IS NOT NULL OR ${table.professionalUserId} IS NOT NULL) AND ((${table.professionalUserId} IS NULL AND ${table.practiceProfessionId} IS NULL) OR (${table.professionalUserId} IS NOT NULL AND ${table.practiceProfessionId} IS NOT NULL))`),
    check('exception_extra_hours_range_check', sql`${table.kind} <> 'extra_hours' OR (${table.startMinute} IS NOT NULL AND ${table.endMinute} IS NOT NULL)`),
    index('availability_exceptions_practice_date_idx').on(table.practiceId, table.date),
    index('availability_exceptions_location_date_idx').on(table.locationId, table.date),
    index('availability_exceptions_professional_date_idx').on(table.professionalUserId, table.date),
    foreignKey({
      name: 'availability_exceptions_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_exceptions_profession_practice_fk',
      columns: [table.practiceProfessionId, table.practiceId],
      foreignColumns: [practiceProfessions.id, practiceProfessions.practiceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_exceptions_professional_membership_fk',
      columns: [table.practiceId, table.professionalUserId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_exceptions_professional_profile_fk',
      columns: [table.practiceProfessionId, table.professionalUserId],
      foreignColumns: [professionalProfiles.practiceProfessionId, professionalProfiles.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'availability_exceptions_professional_location_fk',
      columns: [table.practiceProfessionId, table.professionalUserId, table.locationId],
      foreignColumns: [professionalLocations.practiceProfessionId, professionalLocations.userId, professionalLocations.locationId],
    }).onDelete('cascade'),
  ],
);

export const bookingPolicies = pgTable('booking_policies', {
  practiceId: uuid('practice_id').primaryKey().references(() => practices.id, { onDelete: 'cascade' }),
  maxAdvanceDays: integer('max_advance_days').notNull().default(30),
  minNoticeMinutes: integer('min_notice_minutes').notNull().default(120),
  cancellationCutoffMinutes: integer('cancellation_cutoff_minutes').notNull().default(360),
  guestBookingEnabled: boolean('guest_booking_enabled').notNull().default(true),
  patientCancellationEnabled: boolean('patient_cancellation_enabled').notNull().default(true),
  patientReschedulingEnabled: boolean('patient_rescheduling_enabled').notNull().default(true),
  reschedulingCutoffMinutes: integer('rescheduling_cutoff_minutes').notNull().default(360),
  emailNotificationsEnabled: boolean('email_notifications_enabled').notNull().default(false),
  requirePrepayment: boolean('require_prepayment').notNull().default(false),
  confirmationMode: varchar('confirmation_mode', { length: 16 }).notNull().default('immediate'),
  updatedAt: updatedAt(),
}, (table) => [
  check('booking_policy_advance_check', sql`${table.maxAdvanceDays} BETWEEN 1 AND 365`),
  check('booking_policy_notice_check', sql`${table.minNoticeMinutes} >= 0`),
  check('booking_policy_cancel_check', sql`${table.cancellationCutoffMinutes} >= 0`),
  check('booking_policy_reschedule_check', sql`${table.reschedulingCutoffMinutes} >= 0`),
  check('booking_policy_confirmation_check', sql`${table.confirmationMode} IN ('immediate', 'approval')`),
]);
