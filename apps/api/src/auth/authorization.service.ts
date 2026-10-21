import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import {
  membershipPermissionOverrides,
  practiceMembershipLocations,
  practiceMembershipRoles,
  practiceMemberships,
  platformMembershipRoles,
  platformMemberships,
  platformRolePermissionGrants,
  rolePermissionGrants,
} from '@ayushman-v2/db/schema';
import { DATABASE } from '../database.module.js';

export interface PermissionCheck {
  userId: string;
  practiceId: string;
  permissionCode: string;
  locationId?: string;
  resourceOwnerUserId?: string;
  /** Set only when the data query itself is filtered to this actor's records. */
  ownRecordsAreQueryScoped?: boolean;
}

export interface PermissionResolution {
  allowed: boolean;
  ownScoped: boolean;
}

@Injectable()
export class AuthorizationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolvePermission(check: PermissionCheck): Promise<PermissionResolution> {
    const [membership] = await this.db.select({ id: practiceMemberships.id })
      .from(practiceMemberships).where(and(
        eq(practiceMemberships.practiceId, check.practiceId),
        eq(practiceMemberships.userId, check.userId),
        eq(practiceMemberships.status, 'active'),
      )).limit(1);
    if (!membership) return { allowed: false, ownScoped: false };

    const [branchAccess, overrides, grants] = await Promise.all([
      check.locationId
        ? this.db.select({ membershipId: practiceMembershipLocations.membershipId })
          .from(practiceMembershipLocations).where(and(
            eq(practiceMembershipLocations.membershipId, membership.id),
            eq(practiceMembershipLocations.locationId, check.locationId),
          )).limit(1)
        : Promise.resolve([]),
      this.db.select({ locationId: membershipPermissionOverrides.locationId, effect: membershipPermissionOverrides.effect })
        .from(membershipPermissionOverrides).where(and(
          eq(membershipPermissionOverrides.membershipId, membership.id),
          eq(membershipPermissionOverrides.permissionCode, check.permissionCode),
        )),
      this.db.select({ scope: rolePermissionGrants.scope })
        .from(practiceMembershipRoles).innerJoin(rolePermissionGrants, eq(practiceMembershipRoles.role, rolePermissionGrants.role))
        .where(and(
          eq(practiceMembershipRoles.membershipId, membership.id),
          eq(rolePermissionGrants.permissionCode, check.permissionCode),
        )),
    ]);
    const hasBranchAccess = Boolean(branchAccess.length);
    const applicable = overrides.filter((row) =>
      row.locationId === null || (check.locationId !== undefined && row.locationId === check.locationId),
    );
    const ownScoped = !applicable.some((row) => row.effect === 'allow') &&
      grants.some(({ scope }) => scope === 'own') && !grants.some(({ scope }) => scope === 'practice');
    if (applicable.some((row) => row.effect === 'deny')) return { allowed: false, ownScoped };
    const practiceWideAllow = applicable.some((row) => row.effect === 'allow' && row.locationId === null);
    const locationAllow = applicable.some((row) => row.effect === 'allow' && row.locationId !== null);
    if (practiceWideAllow || (locationAllow && hasBranchAccess)) return { allowed: true, ownScoped: false };

    const allowed = grants.some(({ scope }) => {
      if (scope === 'practice') return true;
      if (scope === 'assigned_locations') return Boolean(check.locationId && hasBranchAccess);
      return scope === 'own' && check.ownRecordsAreQueryScoped === true;
    });
    return { allowed, ownScoped };
  }

  async hasPermission(check: PermissionCheck): Promise<boolean> {
    const [membership] = await this.db
      .select({ id: practiceMemberships.id })
      .from(practiceMemberships)
      .where(and(
        eq(practiceMemberships.practiceId, check.practiceId),
        eq(practiceMemberships.userId, check.userId),
        eq(practiceMemberships.status, 'active'),
      ))
      .limit(1);
    if (!membership) return false;

    const [hasBranchAccess] = check.locationId
      ? await this.db.select({ membershipId: practiceMembershipLocations.membershipId })
          .from(practiceMembershipLocations)
          .where(and(
            eq(practiceMembershipLocations.membershipId, membership.id),
            eq(practiceMembershipLocations.locationId, check.locationId),
          ))
          .limit(1)
      : [];

    const overrides = await this.db
      .select({ locationId: membershipPermissionOverrides.locationId, effect: membershipPermissionOverrides.effect })
      .from(membershipPermissionOverrides)
      .where(and(
        eq(membershipPermissionOverrides.membershipId, membership.id),
        eq(membershipPermissionOverrides.permissionCode, check.permissionCode),
      ));
    const applicable = overrides.filter((row) =>
      row.locationId === null || (check.locationId !== undefined && row.locationId === check.locationId),
    );
    if (applicable.some((row) => row.effect === 'deny')) return false;

    const [practiceWideAllow] = applicable.filter((row) => row.effect === 'allow' && row.locationId === null);
    const [locationAllow] = applicable.filter((row) => row.effect === 'allow' && row.locationId !== null);
    if (practiceWideAllow) return true;
    if (locationAllow && hasBranchAccess) return true;

    const grants = await this.db
      .select({ scope: rolePermissionGrants.scope })
      .from(practiceMembershipRoles)
      .innerJoin(rolePermissionGrants, eq(practiceMembershipRoles.role, rolePermissionGrants.role))
      .where(and(
        eq(practiceMembershipRoles.membershipId, membership.id),
        eq(rolePermissionGrants.permissionCode, check.permissionCode),
      ));

    return grants.some(({ scope }) => {
      if (scope === 'practice') return true;
      if (scope === 'assigned_locations') return Boolean(check.locationId && hasBranchAccess);
      if (scope === 'own') {
        if (check.resourceOwnerUserId) return check.resourceOwnerUserId === check.userId;
        return check.ownRecordsAreQueryScoped === true;
      }
      return false;
    });
  }

  async assertPermission(check: PermissionCheck): Promise<void> {
    if (!await this.hasPermission(check)) {
      throw new ForbiddenException(`Missing permission: ${check.permissionCode}`);
    }
  }

  async requiresOwnScope(check: PermissionCheck): Promise<boolean> {
    const [membership] = await this.db.select({ id: practiceMemberships.id })
      .from(practiceMemberships).where(and(
        eq(practiceMemberships.practiceId, check.practiceId), eq(practiceMemberships.userId, check.userId),
        eq(practiceMemberships.status, 'active'),
      )).limit(1);
    if (!membership) return false;
    const overrides = await this.db.select({ effect: membershipPermissionOverrides.effect, locationId: membershipPermissionOverrides.locationId })
      .from(membershipPermissionOverrides).where(and(
        eq(membershipPermissionOverrides.membershipId, membership.id),
        eq(membershipPermissionOverrides.permissionCode, check.permissionCode),
      ));
    const applicableAllow = overrides.some((item) => item.effect === 'allow' &&
      (item.locationId === null || item.locationId === check.locationId));
    if (applicableAllow) return false;
    const grants = await this.db.select({ scope: rolePermissionGrants.scope })
      .from(practiceMembershipRoles).innerJoin(rolePermissionGrants, eq(practiceMembershipRoles.role, rolePermissionGrants.role))
      .where(and(eq(practiceMembershipRoles.membershipId, membership.id), eq(rolePermissionGrants.permissionCode, check.permissionCode)));
    return grants.some((grant) => grant.scope === 'own') && !grants.some((grant) => grant.scope === 'practice');
  }

  async hasPlatformPermission(userId: string, permissionCode: string): Promise<boolean> {
    const [membership] = await this.db.select({ id: platformMemberships.id })
      .from(platformMemberships).where(and(
        eq(platformMemberships.userId, userId), eq(platformMemberships.status, 'active'),
      )).limit(1);
    if (!membership) return false;
    const [grant] = await this.db.select({ permissionCode: platformRolePermissionGrants.permissionCode })
      .from(platformMembershipRoles)
      .innerJoin(platformRolePermissionGrants, eq(platformRolePermissionGrants.role, platformMembershipRoles.role))
      .where(and(eq(platformMembershipRoles.membershipId, membership.id), eq(platformRolePermissionGrants.permissionCode, permissionCode)))
      .limit(1);
    return Boolean(grant);
  }

  async assertPlatformPermission(userId: string, permissionCode: string): Promise<void> {
    if (!await this.hasPlatformPermission(userId, permissionCode)) {
      throw new ForbiddenException(`Missing platform permission: ${permissionCode}`);
    }
  }
}
