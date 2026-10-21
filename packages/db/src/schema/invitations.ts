import { foreignKey, index, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, membershipRole } from './shared.js';
import { locations, practices, users } from './identity.js';

export const staffInvitations = pgTable('staff_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 320 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('staff_invitations_id_practice_uq').on(table.id, table.practiceId),
  uniqueIndex('staff_invitation_active_email_uq').on(table.practiceId, sql`lower(${table.email})`)
    .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  index('staff_invitations_practice_expiry_idx').on(table.practiceId, table.expiresAt),
]);

export const staffInvitationRoles = pgTable('staff_invitation_roles', {
  invitationId: uuid('invitation_id').notNull().references(() => staffInvitations.id, { onDelete: 'cascade' }),
  role: membershipRole('role').notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.invitationId, table.role] })]);

export const staffInvitationLocations = pgTable('staff_invitation_locations', {
  practiceId: uuid('practice_id').notNull(),
  invitationId: uuid('invitation_id').notNull(),
  locationId: uuid('location_id').notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.invitationId, table.locationId] }),
  index('staff_invitation_locations_location_idx').on(table.locationId, table.invitationId),
  foreignKey({
    name: 'staff_invitation_locations_invitation_practice_fk',
    columns: [table.invitationId, table.practiceId],
    foreignColumns: [staffInvitations.id, staffInvitations.practiceId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'staff_invitation_locations_location_practice_fk',
    columns: [table.locationId, table.practiceId],
    foreignColumns: [locations.id, locations.practiceId],
  }).onDelete('cascade'),
]);
