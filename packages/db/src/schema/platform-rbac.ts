import { boolean, foreignKey, index, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, membershipStatus, platformRole } from './shared.js';
import { users } from './identity.js';

export const platformMemberships = pgTable('platform_memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  status: membershipStatus('status').notNull().default('active'),
  grantedByUserId: uuid('granted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('platform_memberships_status_idx').on(table.status, table.userId)]);

export const platformMembershipRoles = pgTable('platform_membership_roles', {
  membershipId: uuid('membership_id').notNull().references(() => platformMemberships.id, { onDelete: 'cascade' }),
  role: platformRole('role').notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.membershipId, table.role] })]);

export const platformPermissionCatalog = pgTable('platform_permission_catalog', {
  code: varchar('code', { length: 100 }).primaryKey(),
  description: varchar('description', { length: 240 }).notNull(),
  sensitive: boolean('sensitive').notNull().default(false),
  createdAt: createdAt(),
});

export const platformRolePermissionGrants = pgTable('platform_role_permission_grants', {
  role: platformRole('role').notNull(),
  permissionCode: varchar('permission_code', { length: 100 }).notNull()
    .references(() => platformPermissionCatalog.code, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.role, table.permissionCode] }),
  index('platform_role_permission_lookup_idx').on(table.permissionCode, table.role),
]);
