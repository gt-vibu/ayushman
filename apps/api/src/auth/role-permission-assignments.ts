import { and, eq, inArray } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { practiceMembershipRoles, practiceRolePermissionSettings, rolePermissionGrants } from '@ayushman-v2/db/schema';

export async function getRolePermissionAssignments(db: Database, practiceId: string, membershipId: string, permissionCode?: string) {
  // Keep the role lookup inside each permissions query. Fetching roles first
  // added an avoidable database round trip to every authorization check.
  const roles = db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
    .where(eq(practiceMembershipRoles.membershipId, membershipId));

  const [defaults, practiceSettings] = await Promise.all([
    db.select({ role: rolePermissionGrants.role, permissionCode: rolePermissionGrants.permissionCode, scope: rolePermissionGrants.scope })
      .from(rolePermissionGrants).where(and(inArray(rolePermissionGrants.role, roles), permissionCode ? eq(rolePermissionGrants.permissionCode, permissionCode) : undefined)),
    db.select({ role: practiceRolePermissionSettings.role, permissionCode: practiceRolePermissionSettings.permissionCode, enabled: practiceRolePermissionSettings.enabled, scope: practiceRolePermissionSettings.scope })
      .from(practiceRolePermissionSettings).where(and(eq(practiceRolePermissionSettings.practiceId, practiceId), inArray(practiceRolePermissionSettings.role, roles), permissionCode ? eq(practiceRolePermissionSettings.permissionCode, permissionCode) : undefined)),
  ]);

  const defaultByKey = new Map(defaults.map((row) => [`${row.role}:${row.permissionCode}`, row.scope]));
  const practiceByKey = new Map(practiceSettings.map((row) => [`${row.role}:${row.permissionCode}`, row]));
  const keys = new Set([...defaultByKey.keys(), ...practiceByKey.keys()]);
  return [...keys].flatMap((key) => {
    const [role, code] = key.split(':');
    const custom = practiceByKey.get(key);
    const scope = custom ? custom.enabled ? custom.scope : null : defaultByKey.get(key) ?? null;
    return scope ? [{ role, permissionCode: code, scope }] : [];
  });
}
