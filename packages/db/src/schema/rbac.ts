import { boolean, foreignKey, index, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt } from './shared.js';
import { accessScope, membershipRole, permissionEffect } from './shared.js';
import { locations, practiceMemberships, practices } from './identity.js';

export const permissionCatalog = pgTable('permission_catalog', {
  code: varchar('code', { length: 100 }).primaryKey(),
  description: varchar('description', { length: 240 }).notNull(),
  sensitive: boolean('sensitive').notNull().default(false),
  createdAt: createdAt(),
});

export const rolePermissionGrants = pgTable(
  'role_permission_grants',
  {
    role: membershipRole('role').notNull(),
    permissionCode: varchar('permission_code', { length: 100 })
      .notNull()
      .references(() => permissionCatalog.code, { onDelete: 'cascade' }),
    scope: accessScope('scope').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.role, table.permissionCode] }),
    index('role_permission_code_idx').on(table.permissionCode, table.role),
  ],
);

/** Per-practice role policy. Missing rows inherit the system role defaults. */
export const practiceRolePermissionSettings = pgTable(
  'practice_role_permission_settings',
  {
    practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    permissionCode: varchar('permission_code', { length: 100 }).notNull()
      .references(() => permissionCatalog.code, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    scope: accessScope('scope').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.practiceId, table.role, table.permissionCode] }),
    index('practice_role_permission_lookup_idx').on(table.practiceId, table.permissionCode, table.role),
  ],
);

export const membershipPermissionOverrides = pgTable(
  'membership_permission_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceId: uuid('practice_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    permissionCode: varchar('permission_code', { length: 100 })
      .notNull()
      .references(() => permissionCatalog.code, { onDelete: 'cascade' }),
    locationId: uuid('location_id'),
    effect: permissionEffect('effect').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('membership_permission_practice_uq')
      .on(table.membershipId, table.permissionCode)
      .where(sql`${table.locationId} IS NULL`),
    uniqueIndex('membership_permission_location_uq')
      .on(table.membershipId, table.permissionCode, table.locationId)
      .where(sql`${table.locationId} IS NOT NULL`),
    index('membership_permissions_lookup_idx').on(table.practiceId, table.membershipId, table.permissionCode),
    foreignKey({
      name: 'membership_permissions_membership_practice_fk',
      columns: [table.practiceId, table.membershipId],
      foreignColumns: [practiceMemberships.practiceId, practiceMemberships.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_permissions_location_practice_fk',
      columns: [table.locationId, table.practiceId],
      foreignColumns: [locations.id, locations.practiceId],
    }).onDelete('cascade'),
  ],
);
