import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, updatedAt, appointmentStatus } from './shared.js';
import { locations, practiceMemberships, practiceProfessions, practices, users } from './identity.js';
import { professionalLocations, serviceLocations, serviceProfessionals, services } from './professionals.js';

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    email: varchar('email', { length: 320 }),
    phone: varchar('phone', { length: 32 }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    mergedIntoClientId: uuid('merged_into_client_id'),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    mergedByUserId: uuid('merged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('clients_practice_email_idx').on(table.practiceId, sql`lower(${table.email})`),
    index('clients_practice_phone_idx').on(table.practiceId, table.phone),
    uniqueIndex('clients_id_practice_uq').on(table.id, table.practiceId),
    uniqueIndex('clients_practice_user_uq').on(table.practiceId, table.userId).where(sql`${table.userId} IS NOT NULL`),
    index('clients_practice_merge_idx').on(table.practiceId, table.mergedIntoClientId),
    foreignKey({ name: 'clients_merge_target_practice_fk', columns: [table.mergedIntoClientId, table.practiceId], foreignColumns: [table.id, table.practiceId] }).onDelete('restrict'),
    check('clients_merge_metadata_check', sql`(${table.mergedIntoClientId} IS NULL AND ${table.mergedAt} IS NULL) OR (${table.mergedIntoClientId} IS NOT NULL AND ${table.mergedAt} IS NOT NULL AND ${table.mergedIntoClientId} <> ${table.id})`),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'restrict' }),
    practiceProfessionId: uuid('practice_profession_id').notNull().references(() => practiceProfessions.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'restrict' }),
    professionalUserId: uuid('professional_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
    followUpToAppointmentId: uuid('follow_up_to_appointment_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reservedStartsAt: timestamp('reserved_starts_at', { withTimezone: true }).notNull(),
    reservedEndsAt: timestamp('reserved_ends_at', { withTimezone: true }).notNull(),
    actualArrivedAt: timestamp('actual_arrived_at', { withTimezone: true }),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualEndedAt: timestamp('actual_ended_at', { withTimezone: true }),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    serviceNameSnapshot: varchar('service_name_snapshot', { length: 160 }).notNull(),
    durationMinutesSnapshot: integer('duration_minutes_snapshot').notNull(),
    bufferBeforeMinutesSnapshot: integer('buffer_before_minutes_snapshot').notNull(),
    bufferAfterMinutesSnapshot: integer('buffer_after_minutes_snapshot').notNull(),
    priceMinorSnapshot: integer('price_minor_snapshot'),
    currencySnapshot: varchar('currency_snapshot', { length: 3 }).notNull(),
    isWalkIn: boolean('is_walk_in').notNull().default(false),
    visitDescription: varchar('visit_description', { length: 1000 }),
    amountPaidMinor: integer('amount_paid_minor').notNull().default(0),
    paymentMethod: varchar('payment_method', { length: 24 }),
    status: appointmentStatus('status').notNull().default('confirmed'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    clientNote: varchar('client_note', { length: 1000 }),
    practitionerNote: varchar('practitioner_note', { length: 1000 }),
    cancellationReason: varchar('cancellation_reason', { length: 240 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('appointments_time_order_check', sql`${table.startsAt} < ${table.endsAt}`),
    check('appointments_reserved_range_check', sql`${table.reservedStartsAt} <= ${table.startsAt} AND ${table.endsAt} <= ${table.reservedEndsAt}`),
    check('appointments_duration_snapshot_check', sql`${table.durationMinutesSnapshot} > 0`),
    check('appointments_duration_matches_snapshot_check', sql`${table.endsAt} = ${table.startsAt} + (${table.durationMinutesSnapshot} * interval '1 minute')`),
    check('appointments_actual_visit_time_order_check', sql`(${table.actualArrivedAt} IS NULL OR ${table.actualStartedAt} IS NULL OR ${table.actualArrivedAt} <= ${table.actualStartedAt}) AND (${table.actualEndedAt} IS NULL OR (${table.actualStartedAt} IS NOT NULL AND ${table.actualStartedAt} <= ${table.actualEndedAt}))`),
    check('appointments_buffers_snapshot_check', sql`${table.bufferBeforeMinutesSnapshot} >= 0 AND ${table.bufferAfterMinutesSnapshot} >= 0 AND ${table.reservedStartsAt} = ${table.startsAt} - (${table.bufferBeforeMinutesSnapshot} * interval '1 minute') AND ${table.reservedEndsAt} = ${table.endsAt} + (${table.bufferAfterMinutesSnapshot} * interval '1 minute')`),
    check('appointments_price_snapshot_check', sql`${table.priceMinorSnapshot} IS NULL OR ${table.priceMinorSnapshot} >= 0`),
    check('appointments_payment_values_check', sql`${table.amountPaidMinor} >= 0 AND (${table.paymentMethod} IS NULL OR ${table.paymentMethod} IN ('cash','upi','card','bank_transfer','insurance','other'))`),
    check('appointments_cancel_metadata_check', sql`(${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL) OR (${table.status} <> 'cancelled' AND ${table.cancelledAt} IS NULL)`),
    index('appointments_professional_time_idx').on(table.professionalUserId, table.status, table.startsAt),
    index('appointments_professional_global_reserved_idx').on(table.professionalUserId, table.reservedStartsAt, table.reservedEndsAt)
      .where(sql`${table.status} IN ('held', 'pending', 'confirmed', 'checked_in', 'in_progress')`),
    index('appointments_practice_professional_reserved_idx').on(table.practiceId, table.professionalUserId, table.reservedStartsAt),
    index('appointments_practice_time_idx').on(table.practiceId, table.status, table.startsAt),
    index('appointments_location_time_idx').on(table.locationId, table.startsAt),
    index('appointments_client_time_idx').on(table.clientId, table.startsAt),
    index('appointments_follow_up_parent_idx').on(table.followUpToAppointmentId),
    index('appointments_hold_expiry_idx').on(table.status, table.holdExpiresAt),
    uniqueIndex('appointments_id_practice_uq').on(table.id, table.practiceId),
    foreignKey({
      name: 'appointments_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_service_profession_practice_fk',
      columns: [table.serviceId, table.practiceId, table.practiceProfessionId],
      foreignColumns: [services.id, services.practiceId, services.practiceProfessionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_client_practice_fk',
      columns: [table.clientId, table.practiceId],
      foreignColumns: [clients.id, clients.practiceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_follow_up_parent_practice_fk',
      columns: [table.followUpToAppointmentId, table.practiceId],
      foreignColumns: [table.id, table.practiceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_professional_membership_fk',
      columns: [table.practiceId, table.professionalUserId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_service_professional_assignment_fk',
      columns: [table.serviceId, table.professionalUserId, table.practiceId],
      foreignColumns: [serviceProfessionals.serviceId, serviceProfessionals.professionalUserId, serviceProfessionals.practiceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_service_location_assignment_fk',
      columns: [table.serviceId, table.locationId],
      foreignColumns: [serviceLocations.serviceId, serviceLocations.locationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_professional_location_assignment_fk',
      columns: [table.practiceProfessionId, table.professionalUserId, table.locationId],
      foreignColumns: [professionalLocations.practiceProfessionId, professionalLocations.userId, professionalLocations.locationId],
    }).onDelete('restrict'),
  ],
);

export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    fromStatus: appointmentStatus('from_status'),
    toStatus: appointmentStatus('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: varchar('reason', { length: 500 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('appointment_events_appointment_time_idx').on(table.appointmentId, table.occurredAt),
    index('appointment_events_practice_time_idx').on(table.practiceId, table.occurredAt),
    foreignKey({
      name: 'appointment_events_appointment_practice_fk',
      columns: [table.appointmentId, table.practiceId],
      foreignColumns: [appointments.id, appointments.practiceId],
    }).onDelete('cascade'),
  ],
);

export const appointmentNotifications = pgTable(
  'appointment_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 40 }).notNull().default('new_booking'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('appointment_notifications_recipient_appointment_uq').on(table.recipientUserId, table.appointmentId, table.kind),
    index('appointment_notifications_inbox_idx').on(table.recipientUserId, table.readAt, table.createdAt),
    index('appointment_notifications_practice_idx').on(table.practiceId, table.createdAt),
    foreignKey({
      name: 'appointment_notifications_appointment_practice_fk',
      columns: [table.appointmentId, table.practiceId],
      foreignColumns: [appointments.id, appointments.practiceId],
    }).onDelete('cascade'),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: jsonb('response'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('idempotency_practice_key_uq').on(table.practiceId, table.key),
    index('idempotency_expiry_idx').on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }).notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_practice_created_idx').on(table.practiceId, table.createdAt),
  ],
);
