import { boolean, check, foreignKey, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, invoiceKind, invoicePaymentMethod, invoiceStatus, invoiceTaxMode, updatedAt } from './shared.js';
import { appointments, clients } from './appointments.js';
import { locations, practices, users } from './identity.js';

export type AddressSnapshot = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  countryCode?: string;
};

export const clientDocuments = pgTable('client_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  storageKey: uuid('storage_key').notNull().defaultRandom(),
  originalName: varchar('original_name', { length: 240 }).notNull(),
  mediaType: varchar('media_type', { length: 100 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  category: varchar('category', { length: 40 }).notNull(),
  description: varchar('description', { length: 500 }),
  customerVisible: boolean('customer_visible').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  check('client_documents_size_positive_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 20971520`),
  index('client_documents_practice_client_created_idx').on(table.practiceId, table.clientId, table.createdAt),
  index('client_documents_client_visibility_idx').on(table.clientId, table.customerVisible, table.createdAt),
  uniqueIndex('client_documents_storage_key_uq').on(table.storageKey),
  foreignKey({ name: 'client_documents_client_practice_fk', columns: [table.clientId, table.practiceId], foreignColumns: [clients.id, clients.practiceId] }).onDelete('cascade'),
]);

export const sessionRecordings = pgTable('session_recordings', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull(),
  clientId: uuid('client_id').notNull(),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  professionalUserId: uuid('professional_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  storageKey: uuid('storage_key').defaultRandom().notNull(),
  status: varchar('status', { length: 32 }).notNull().default('awaiting_customer_consent'),
  sharingStatus: varchar('sharing_status', { length: 24 }).notNull().default('private'),
  consentNoticeVersion: varchar('consent_notice_version', { length: 40 }).notNull(),
  retentionDays: integer('retention_days').notNull().default(90),
  mimeType: varchar('mime_type', { length: 100 }),
  sizeBytes: integer('size_bytes').notNull().default(0),
  durationSeconds: integer('duration_seconds'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  stopRequestedAt: timestamp('stop_requested_at', { withTimezone: true }),
  retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
  sharedAt: timestamp('shared_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  check('session_recordings_status_check', sql`${table.status} IN ('awaiting_customer_consent','declined','ready_to_record','recording','uploading','ready_for_review','shared','stop_requested','failed','deleted','expired')`),
  check('session_recordings_sharing_check', sql`${table.sharingStatus} IN ('private','shared','restricted','expired')`),
  check('session_recordings_size_check', sql`${table.sizeBytes} >= 0 AND ${table.sizeBytes} <= 536870912`),
  check('session_recordings_duration_check', sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} BETWEEN 1 AND 10800`),
  check('session_recordings_retention_check', sql`${table.retentionDays} BETWEEN 1 AND 3650`),
  uniqueIndex('session_recordings_storage_key_uq').on(table.storageKey),
  index('session_recordings_practice_appointment_idx').on(table.practiceId, table.appointmentId, table.createdAt),
  uniqueIndex('session_recordings_active_appointment_uq').on(table.practiceId, table.appointmentId).where(sql`${table.deletedAt} IS NULL AND ${table.status} IN ('awaiting_customer_consent','ready_to_record','recording','uploading','ready_for_review','shared','stop_requested')`),
  index('session_recordings_customer_idx').on(table.clientId, table.sharingStatus, table.createdAt),
  index('session_recordings_retention_idx').on(table.retentionExpiresAt).where(sql`${table.deletedAt} IS NULL`),
  foreignKey({ name: 'session_recordings_appointment_client_practice_fk', columns: [table.appointmentId, table.practiceId], foreignColumns: [appointments.id, appointments.practiceId] }).onDelete('cascade'),
  foreignKey({ name: 'session_recordings_client_practice_fk', columns: [table.clientId, table.practiceId], foreignColumns: [clients.id, clients.practiceId] }).onDelete('cascade'),
]);

export const sessionRecordingConsents = pgTable('session_recording_consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordingId: uuid('recording_id').notNull().references(() => sessionRecordings.id, { onDelete: 'cascade' }),
  participantUserId: uuid('participant_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  participantRole: varchar('participant_role', { length: 24 }).notNull(),
  noticeVersion: varchar('notice_version', { length: 40 }).notNull(),
  decision: varchar('decision', { length: 16 }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  check('session_recording_consents_role_check', sql`${table.participantRole} IN ('practitioner','customer')`),
  check('session_recording_consents_decision_check', sql`${table.decision} IN ('pending','accepted','declined','withdrawn')`),
  uniqueIndex('session_recording_consents_participant_uq').on(table.recordingId, table.participantUserId),
  index('session_recording_consents_recording_idx').on(table.recordingId, table.participantRole, table.decision),
]);

export const sessionRecordingChunks = pgTable('session_recording_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordingId: uuid('recording_id').notNull().references(() => sessionRecordings.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  storageKey: uuid('storage_key').defaultRandom().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: createdAt(),
}, (table) => [
  check('session_recording_chunks_index_check', sql`${table.chunkIndex} >= 0`),
  check('session_recording_chunks_size_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 5242880`),
  uniqueIndex('session_recording_chunks_recording_index_uq').on(table.recordingId, table.chunkIndex),
  uniqueIndex('session_recording_chunks_storage_key_uq').on(table.storageKey),
]);

export const billingProfiles = pgTable('billing_profiles', {
  practiceId: uuid('practice_id').primaryKey().references(() => practices.id, { onDelete: 'cascade' }),
  legalName: varchar('legal_name', { length: 180 }),
  gstin: varchar('gstin', { length: 15 }),
  address: jsonb('address').$type<AddressSnapshot>(),
  email: varchar('email', { length: 320 }),
  phone: varchar('phone', { length: 32 }),
  invoicePrefix: varchar('invoice_prefix', { length: 12 }).notNull().default('INV'),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [check('billing_profiles_gstin_format_check', sql`${table.gstin} IS NULL OR ${table.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`)]);

export const invoiceSequences = pgTable('invoice_sequences', {
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  financialYear: varchar('financial_year', { length: 7 }).notNull(),
  lastNumber: integer('last_number').notNull().default(0),
}, (table) => [
  check('invoice_sequences_number_check', sql`${table.lastNumber} >= 0`),
  uniqueIndex('invoice_sequences_practice_year_uq').on(table.practiceId, table.financialYear),
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id').notNull(),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
  invoiceNumber: varchar('invoice_number', { length: 32 }).notNull(),
  kind: invoiceKind('kind').notNull(),
  status: invoiceStatus('status').notNull().default('issued'),
  currency: varchar('currency', { length: 3 }).notNull(),
  issueDate: varchar('issue_date', { length: 10 }).notNull(),
  dueDate: varchar('due_date', { length: 10 }),
  supplierSnapshot: jsonb('supplier_snapshot').$type<Record<string, string | null>>().notNull(),
  recipientSnapshot: jsonb('recipient_snapshot').$type<Record<string, string | null>>().notNull(),
  placeOfSupply: varchar('place_of_supply', { length: 120 }),
  sacCode: varchar('sac_code', { length: 12 }),
  taxMode: invoiceTaxMode('tax_mode').notNull().default('none'),
  subtotalMinor: integer('subtotal_minor').notNull(),
  discountMinor: integer('discount_minor').notNull().default(0),
  taxMinor: integer('tax_minor').notNull().default(0),
  centralTaxMinor: integer('central_tax_minor').notNull().default(0),
  stateTaxMinor: integer('state_tax_minor').notNull().default(0),
  integratedTaxMinor: integer('integrated_tax_minor').notNull().default(0),
  totalMinor: integer('total_minor').notNull(),
  amountPaidMinor: integer('amount_paid_minor').notNull().default(0),
  notes: varchar('notes', { length: 1000 }),
  issuedByUserId: uuid('issued_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: varchar('void_reason', { length: 300 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  check('invoices_amounts_nonnegative_check', sql`${table.subtotalMinor} >= 0 AND ${table.discountMinor} >= 0 AND ${table.taxMinor} >= 0 AND ${table.totalMinor} >= 0 AND ${table.amountPaidMinor} >= 0 AND ${table.amountPaidMinor} <= ${table.totalMinor}`),
  check('invoices_due_after_issue_check', sql`${table.dueDate} IS NULL OR ${table.dueDate} >= ${table.issueDate}`),
  check('invoices_void_metadata_check', sql`(${table.status} = 'void' AND ${table.voidedAt} IS NOT NULL) OR (${table.status} <> 'void' AND ${table.voidedAt} IS NULL)`),
  uniqueIndex('invoices_practice_number_uq').on(table.practiceId, table.invoiceNumber),
  uniqueIndex('invoices_id_practice_uq').on(table.id, table.practiceId),
  index('invoices_practice_issue_idx').on(table.practiceId, table.issueDate),
  index('invoices_client_issue_idx').on(table.clientId, table.issueDate),
  foreignKey({ name: 'invoices_client_practice_fk', columns: [table.clientId, table.practiceId], foreignColumns: [clients.id, clients.practiceId] }).onDelete('restrict'),
]);

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  sacCode: varchar('sac_code', { length: 12 }),
  quantityMilli: integer('quantity_milli').notNull().default(1000),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  lineTotalMinor: integer('line_total_minor').notNull(),
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  taxMinor: integer('tax_minor').notNull().default(0),
  lineOrder: integer('line_order').notNull(),
  createdAt: createdAt(),
}, (table) => [
  check('invoice_items_values_check', sql`${table.quantityMilli} > 0 AND ${table.unitPriceMinor} >= 0 AND ${table.lineTotalMinor} >= 0 AND ${table.taxRateBps} >= 0 AND ${table.taxMinor} >= 0 AND ${table.lineOrder} >= 0`),
  index('invoice_items_invoice_idx').on(table.practiceId, table.invoiceId),
  foreignKey({ name: 'invoice_items_invoice_practice_fk', columns: [table.invoiceId, table.practiceId], foreignColumns: [invoices.id, invoices.practiceId] }).onDelete('cascade'),
]);

export const invoicePayments = pgTable('invoice_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  method: invoicePaymentMethod('method').notNull(),
  reference: varchar('reference', { length: 120 }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  recordedByUserId: uuid('recorded_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
}, (table) => [
  check('invoice_payments_amount_positive_check', sql`${table.amountMinor} > 0`),
  index('invoice_payments_invoice_idx').on(table.practiceId, table.invoiceId, table.receivedAt),
  foreignKey({ name: 'invoice_payments_invoice_practice_fk', columns: [table.invoiceId, table.practiceId], foreignColumns: [invoices.id, invoices.practiceId] }).onDelete('restrict'),
]);
