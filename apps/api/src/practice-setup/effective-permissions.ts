import { ForbiddenException } from '@nestjs/common';
import { and, eq } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import {
  membershipPermissionOverrides, permissionCatalog, practiceMembershipLocations,
  practiceMembershipRoles, practiceMemberships, rolePermissionGrants,
} from '@ayushman-v2/db/schema';

export async function getEffectivePermissions(db: Database, userId: string, practiceId: string, locationId?: string) {
  const [membership] = await db.select({ id: practiceMemberships.id }).from(practiceMemberships)
    .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active'))).limit(1);
  if (!membership) throw new ForbiddenException('Active practice membership required');
  const [catalog, grants, overrides, branchAccess] = await Promise.all([
    db.select({ code: permissionCatalog.code }).from(permissionCatalog),
    db.select({ code: rolePermissionGrants.permissionCode, scope: rolePermissionGrants.scope })
      .from(practiceMembershipRoles).innerJoin(rolePermissionGrants, eq(rolePermissionGrants.role, practiceMembershipRoles.role))
      .where(eq(practiceMembershipRoles.membershipId, membership.id)),
    db.select({ code: membershipPermissionOverrides.permissionCode, locationId: membershipPermissionOverrides.locationId, effect: membershipPermissionOverrides.effect })
      .from(membershipPermissionOverrides).where(eq(membershipPermissionOverrides.membershipId, membership.id)),
    locationId ? db.select({ id: practiceMembershipLocations.locationId }).from(practiceMembershipLocations)
      .where(and(eq(practiceMembershipLocations.membershipId, membership.id), eq(practiceMembershipLocations.locationId, locationId))).limit(1) : Promise.resolve([]),
  ]);
  const hasBranchAccess = branchAccess.length > 0;
  return Object.fromEntries(catalog.map(({ code }) => {
    const applicable = overrides.filter((item) => item.code === code && (item.locationId === null || item.locationId === locationId));
    const denied = applicable.some((item) => item.effect === 'deny');
    const allowed = applicable.some((item) => item.effect === 'allow' && (item.locationId === null || hasBranchAccess));
    const roleAllowed = grants.some((grant) => grant.code === code && (
      grant.scope === 'practice' || (grant.scope === 'assigned_locations' && hasBranchAccess) || grant.scope === 'own'
    ));
    return [code, !denied && (allowed || roleAllowed)];
  }));
}
