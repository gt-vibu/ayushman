import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import {
  locations, locationProfessions, practiceMembershipLocations, practiceMembershipRoles,
  membershipPermissionOverrides, permissionCatalog, practiceMemberships, practiceProfessions, practices, professionalLocations,
  professionalProfiles, serviceLocations, serviceProfessionals, services, users,
} from '@ayushman-v2/db/schema';
import type {
  LocationInput, LocationProfessionInput, PracticeProfessionInput, PracticeUpdateInput,
  LocationUpdateInput, MembershipPermissionOverridesInput, MembershipStatusInput, PracticeProfessionUpdateInput,
  ProfessionalProfileInput, ServiceInput,
  StaffAssignmentInput, StaffLocationsInput, StaffRolesInput,
} from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { isUniqueViolation } from './practice-setup.helpers.js';
import { getEffectivePermissions } from './effective-permissions.js';
import { listPracticeServices } from './list-practice-services.js';

@Injectable()
export class PracticeSetupService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authorization: AuthorizationService,
  ) {}

  async getPractice(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'practice.read' });
    const [practice] = await this.db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
    if (!practice) throw new NotFoundException('Practice not found');
    return practice;
  }

  async getMyPermissions(userId: string, practiceId: string, locationId?: string) {
    return getEffectivePermissions(this.db, userId, practiceId, locationId);
  }

  async updatePractice(userId: string, practiceId: string, input: PracticeUpdateInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'practice.update' });
    const [practice] = await this.db.update(practices).set({ ...input, updatedAt: new Date() })
      .where(eq(practices.id, practiceId)).returning();
    if (!practice) throw new NotFoundException('Practice not found');
    return practice;
  }

  async listProfessions(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'practice.read' });
    return this.db.select().from(practiceProfessions).where(eq(practiceProfessions.practiceId, practiceId));
  }

  async addProfession(userId: string, practiceId: string, input: PracticeProfessionInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'practice.update' });
    try {
      const [profession] = await this.db.insert(practiceProfessions).values({
        practiceId, professionCode: input.professionCode, name: input.name, termOverrides: input.termOverrides,
      }).returning();
      return profession;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This profession is already enabled for the practice');
      throw error;
    }
  }

  async updateProfession(userId: string, practiceId: string, professionId: string, input: PracticeProfessionUpdateInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'practice.update' });
    const [profession] = await this.db.update(practiceProfessions).set(input)
      .where(and(eq(practiceProfessions.id, professionId), eq(practiceProfessions.practiceId, practiceId))).returning();
    if (!profession) throw new NotFoundException('Profession not found in this practice');
    return profession;
  }

  async listLocations(userId: string, practiceId: string, locationId?: string) {
    const check = { userId, practiceId, permissionCode: 'locations.read', locationId, ownRecordsAreQueryScoped: true } as const;
    const ownScope = await this.authorization.requiresOwnScope(check);
    const filters = [eq(locations.practiceId, practiceId), locationId ? eq(locations.id, locationId) : sql`true`];
    if (ownScope) filters.push(sql`exists (select 1 from professional_locations pl where pl.location_id = ${locations.id} and pl.user_id = ${userId}::uuid)`);
    const candidates = await this.db.select().from(locations).where(and(...filters));
    if (locationId) {
      await this.authorization.assertPermission(check);
      return candidates;
    }
    if (!candidates.length) {
      await this.authorization.assertPermission(check);
      return [];
    }
    const access = await Promise.all(candidates.map((location) => this.authorization.hasPermission({
      ...check, locationId: location.id, ownRecordsAreQueryScoped: true,
    })));
    return candidates.filter((_, index) => access[index]);
  }

  async createLocation(userId: string, practiceId: string, input: LocationInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'locations.manage' });
    const [practice] = await this.db.select({ timezone: practices.timezone }).from(practices)
      .where(eq(practices.id, practiceId)).limit(1);
    if (!practice) throw new NotFoundException('Practice not found');
    const [location] = await this.db.insert(locations).values({
      practiceId, name: input.name, address: input.address, timezone: input.timezone ?? practice.timezone,
    }).returning();
    return location;
  }

  async updateLocation(userId: string, practiceId: string, locationId: string, input: LocationUpdateInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'locations.manage', locationId });
    const [location] = await this.db.update(locations).set({ ...input, updatedAt: new Date() })
      .where(and(eq(locations.practiceId, practiceId), eq(locations.id, locationId))).returning();
    if (!location) throw new NotFoundException('Branch not found in this practice');
    return location;
  }

  async enableProfessionAtLocation(userId: string, practiceId: string, locationId: string, input: LocationProfessionInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'locations.manage', locationId });
    await this.assertLocation(practiceId, locationId);
    await this.assertProfession(practiceId, input.practiceProfessionId);
    const [row] = await this.db.insert(locationProfessions).values({
      practiceId, locationId, practiceProfessionId: input.practiceProfessionId, enabled: input.enabled,
    }).onConflictDoUpdate({
      target: [locationProfessions.practiceProfessionId, locationProfessions.locationId],
      set: { enabled: input.enabled },
    }).returning();
    return row;
  }

  async addStaff(userId: string, practiceId: string, input: StaffAssignmentInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'staff.manage' });
    if (input.roles.includes('admin')) {
      const actorRoles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
        .innerJoin(practiceMemberships, eq(practiceMemberships.id, practiceMembershipRoles.membershipId))
        .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active')));
      if (!actorRoles.some((row) => row.role === 'owner')) throw new ForbiddenException('Only a practice owner can grant administrator access');
    }
    const email = input.email.trim().toLowerCase();
    const [staffUser] = await this.db.select({ id: users.id, email: users.email, fullName: users.fullName, disabledAt: users.disabledAt })
      .from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (!staffUser) throw new NotFoundException('This email has no account yet. The staff member must register before being assigned.');
    if (staffUser.disabledAt) throw new BadRequestException('This account is disabled and cannot be assigned to a practice');
    const validLocations = await this.assertLocations(practiceId, input.locationIds);

    return this.db.transaction(async (tx) => {
      const [membership] = await tx.insert(practiceMemberships).values({ practiceId, userId: staffUser.id })
        .onConflictDoUpdate({
          target: [practiceMemberships.practiceId, practiceMemberships.userId],
          set: { status: 'active', updatedAt: new Date() },
        }).returning();
      await tx.insert(practiceMembershipRoles).values(input.roles.map((role) => ({ membershipId: membership.id, role })))
        .onConflictDoNothing();
      if (validLocations.length) {
        await tx.insert(practiceMembershipLocations).values(validLocations.map((locationId) => ({ practiceId, membershipId: membership.id, locationId })))
          .onConflictDoNothing();
      }
      return { user: staffUser, membershipId: membership.id, roles: input.roles, locationIds: validLocations };
    });
  }

  async listStaff(userId: string, practiceId: string, locationId?: string) {
    const check = { userId, practiceId, permissionCode: 'staff.read', locationId } as const;
    await this.authorization.assertPermission(check);
    const rows = await this.db.select({
      membershipId: practiceMemberships.id, userId: users.id, email: users.email, fullName: users.fullName,
      status: practiceMemberships.status, role: practiceMembershipRoles.role,
      locationId: practiceMembershipLocations.locationId, locationName: locations.name,
    }).from(practiceMemberships)
      .innerJoin(users, eq(users.id, practiceMemberships.userId))
      .leftJoin(practiceMembershipRoles, eq(practiceMembershipRoles.membershipId, practiceMemberships.id))
      .leftJoin(practiceMembershipLocations, and(eq(practiceMembershipLocations.membershipId, practiceMemberships.id), locationId ? eq(practiceMembershipLocations.locationId, locationId) : sql`true`))
      .leftJoin(locations, eq(locations.id, practiceMembershipLocations.locationId))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.status, 'active'), locationId ? eq(practiceMembershipLocations.locationId, locationId) : sql`true`));
    const members = new Map<string, { membershipId: string; userId: string; email: string; fullName: string; status: string; roles: Set<string>; locations: Map<string, string> }>();
    for (const row of rows) {
      const member = members.get(row.membershipId) ?? {
        membershipId: row.membershipId, userId: row.userId, email: row.email, fullName: row.fullName,
        status: row.status, roles: new Set<string>(), locations: new Map<string, string>(),
      };
      if (row.role) member.roles.add(row.role);
      if (row.locationId && row.locationName) member.locations.set(row.locationId, row.locationName);
      members.set(member.membershipId, member);
    }
    return [...members.values()].map((member) => ({ ...member, roles: [...member.roles], locations: [...member.locations].map(([id, name]) => ({ id, name })) }));
  }

  async updateStaffRoles(actorId: string, practiceId: string, targetUserId: string, input: StaffRolesInput) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [target] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, targetUserId))).limit(1);
    if (!target) throw new NotFoundException('Staff member not found in this practice');
    const currentRoles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .where(eq(practiceMembershipRoles.membershipId, target.id));
    if (currentRoles.some((row) => row.role === 'owner')) throw new ForbiddenException('Owner access cannot be changed through staff role management');
    if (input.roles.includes('admin') && !await this.isOwner(actorId, practiceId)) {
      throw new ForbiddenException('Only a practice owner can grant administrator access');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(practiceMembershipRoles).where(eq(practiceMembershipRoles.membershipId, target.id));
      await tx.insert(practiceMembershipRoles).values(input.roles.map((role) => ({ membershipId: target.id, role })));
    });
    return { membershipId: target.id, roles: input.roles };
  }

  async updateStaffLocations(actorId: string, practiceId: string, targetUserId: string, input: StaffLocationsInput) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [target] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, targetUserId))).limit(1);
    if (!target) throw new NotFoundException('Staff member not found in this practice');
    const locationIds = await this.assertLocations(practiceId, input.locationIds);
    await this.db.transaction(async (tx) => {
      await tx.delete(practiceMembershipLocations).where(eq(practiceMembershipLocations.membershipId, target.id));
      if (locationIds.length) await tx.insert(practiceMembershipLocations).values(locationIds.map((locationId) => ({ practiceId, membershipId: target.id, locationId })));
    });
    return { membershipId: target.id, locationIds };
  }

  async updateStaffStatus(actorId: string, practiceId: string, targetUserId: string, input: MembershipStatusInput) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [target] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, targetUserId))).limit(1);
    if (!target) throw new NotFoundException('Staff member not found in this practice');
    const roles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .where(eq(practiceMembershipRoles.membershipId, target.id));
    if (roles.some((row) => row.role === 'owner')) throw new ForbiddenException('The practice owner cannot be suspended through staff management');
    const [membership] = await this.db.update(practiceMemberships).set({ status: input.status, updatedAt: new Date() })
      .where(eq(practiceMemberships.id, target.id)).returning({ id: practiceMemberships.id, status: practiceMemberships.status });
    return membership;
  }

  async listPermissionCatalog(actorId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    return this.db.select().from(permissionCatalog).orderBy(permissionCatalog.code);
  }

  async listStaffPermissionOverrides(actorId: string, practiceId: string, targetUserId: string) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [target] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, targetUserId))).limit(1);
    if (!target) throw new NotFoundException('Staff member not found in this practice');
    return this.db.select().from(membershipPermissionOverrides)
      .where(and(eq(membershipPermissionOverrides.practiceId, practiceId), eq(membershipPermissionOverrides.membershipId, target.id)));
  }

  async replaceStaffPermissionOverrides(actorId: string, practiceId: string, targetUserId: string, input: MembershipPermissionOverridesInput) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [target] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, targetUserId))).limit(1);
    if (!target) throw new NotFoundException('Staff member not found in this practice');
    const targetRoles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .where(eq(practiceMembershipRoles.membershipId, target.id));
    if (targetRoles.some((row) => row.role === 'owner')) throw new ForbiddenException('Owner permissions cannot be overridden through staff management');
    const actorIsOwner = await this.isOwner(actorId, practiceId);
    if (!actorIsOwner) throw new ForbiddenException('Only a practice owner can change custom permission overrides');
    const codes = [...new Set(input.overrides.map((item) => item.permissionCode))];
    const permissions = codes.length ? await this.db.select({ code: permissionCatalog.code, sensitive: permissionCatalog.sensitive })
      .from(permissionCatalog).where(sql`${permissionCatalog.code} IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`) : [];
    if (permissions.length !== codes.length) throw new BadRequestException('Unknown permission code');
    if (permissions.some((item) => item.sensitive) && !actorIsOwner) throw new ForbiddenException('Only a practice owner can change sensitive permission overrides');
    for (const override of input.overrides) if (override.locationId) await this.assertLocation(practiceId, override.locationId);
    await this.db.transaction(async (tx) => {
      await tx.delete(membershipPermissionOverrides).where(eq(membershipPermissionOverrides.membershipId, target.id));
      if (input.overrides.length) {
        await tx.insert(membershipPermissionOverrides).values(input.overrides.map((override) => ({
          practiceId, membershipId: target.id, permissionCode: override.permissionCode,
          locationId: override.locationId, effect: override.effect,
        })));
      }
    });
    return { membershipId: target.id, overrides: input.overrides };
  }

  async addProfessionalProfile(userId: string, practiceId: string, professionalUserId: string, input: ProfessionalProfileInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'staff.manage' });
    await this.assertProfession(practiceId, input.practiceProfessionId);
    const [membership] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .innerJoin(practiceMembershipRoles, eq(practiceMembershipRoles.membershipId, practiceMemberships.id))
      .innerJoin(users, and(eq(users.id, practiceMemberships.userId), isNull(users.disabledAt)))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, professionalUserId), eq(practiceMemberships.status, 'active'), eq(practiceMembershipRoles.role, 'professional')))
      .limit(1);
    if (!membership) throw new BadRequestException('The user must be an active professional member of this practice');
    const locationsValid = await this.assertLocations(practiceId, input.locationIds);
    if (locationsValid.length) {
      const enabledLocations = await this.db.select({ id: locationProfessions.locationId }).from(locationProfessions)
        .where(and(eq(locationProfessions.practiceId, practiceId), eq(locationProfessions.practiceProfessionId, input.practiceProfessionId), eq(locationProfessions.enabled, true), sql`${locationProfessions.locationId} IN (${sql.join(locationsValid.map((id) => sql`${id}::uuid`), sql`, `)})`));
      if (enabledLocations.length !== locationsValid.length) throw new BadRequestException('Enable the profession at each selected branch before assigning this professional');
    }
    const [profile] = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(professionalProfiles).values({
        practiceProfessionId: input.practiceProfessionId, practiceId, userId: professionalUserId,
        headline: input.headline, bio: input.bio, profileAttributes: input.profileAttributes, publicProfile: input.publicProfile,
      }).onConflictDoUpdate({
        target: [professionalProfiles.practiceProfessionId, professionalProfiles.userId],
        set: { headline: input.headline, bio: input.bio, profileAttributes: input.profileAttributes, publicProfile: input.publicProfile, updatedAt: new Date() },
      }).returning();
      if (locationsValid.length) {
        await tx.insert(professionalLocations).values(locationsValid.map((locationId, index) => ({
          practiceProfessionId: input.practiceProfessionId, practiceId, userId: professionalUserId, locationId, isPrimary: index === 0,
        }))).onConflictDoNothing();
      }
      return [created];
    });
    return profile;
  }

  async createService(userId: string, practiceId: string, input: ServiceInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'services.manage' });
    await this.assertProfession(practiceId, input.practiceProfessionId);
    await this.assertServiceAssignments(practiceId, input.practiceProfessionId, input.professionalUserIds, input.locationIds);
    return this.db.transaction(async (tx) => {
      const [service] = await tx.insert(services).values({
        practiceId, practiceProfessionId: input.practiceProfessionId, name: input.name,
        description: input.description, durationMinutes: input.durationMinutes,
        bufferBeforeMinutes: input.bufferBeforeMinutes, bufferAfterMinutes: input.bufferAfterMinutes,
        priceMinor: input.priceMinor, currency: input.currency.toUpperCase(), onlineBookable: input.onlineBookable, active: input.active,
      }).returning();
      await tx.insert(serviceProfessionals).values(input.professionalUserIds.map((professionalUserId) => ({
        serviceId: service.id, practiceId, practiceProfessionId: input.practiceProfessionId, professionalUserId,
      })));
      await tx.insert(serviceLocations).values(input.locationIds.map((locationId) => ({
        serviceId: service.id, practiceId, practiceProfessionId: input.practiceProfessionId, locationId,
      })));
      return service;
    });
  }

  async updateService(userId: string, practiceId: string, serviceId: string, input: ServiceInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'services.manage' });
    const [existing] = await this.db.select({ id: services.id, practiceProfessionId: services.practiceProfessionId }).from(services)
      .where(and(eq(services.id, serviceId), eq(services.practiceId, practiceId))).limit(1);
    if (!existing) throw new NotFoundException('Service not found in this practice');
    if (existing.practiceProfessionId !== input.practiceProfessionId) throw new BadRequestException('A service cannot change profession after creation; create a separate service');
    await this.assertProfession(practiceId, input.practiceProfessionId);
    await this.assertServiceAssignments(practiceId, input.practiceProfessionId, input.professionalUserIds, input.locationIds);
    return this.db.transaction(async (tx) => {
      const [service] = await tx.update(services).set({
        practiceProfessionId: input.practiceProfessionId, name: input.name, description: input.description,
        durationMinutes: input.durationMinutes, bufferBeforeMinutes: input.bufferBeforeMinutes,
        bufferAfterMinutes: input.bufferAfterMinutes, priceMinor: input.priceMinor,
        currency: input.currency.toUpperCase(), onlineBookable: input.onlineBookable, active: input.active, updatedAt: new Date(),
      }).where(and(eq(services.id, serviceId), eq(services.practiceId, practiceId))).returning();
      await tx.update(serviceProfessionals).set({ active: false }).where(eq(serviceProfessionals.serviceId, serviceId));
      await tx.update(serviceLocations).set({ active: false }).where(eq(serviceLocations.serviceId, serviceId));
      for (const professionalUserId of input.professionalUserIds) {
        await tx.insert(serviceProfessionals).values({ serviceId, practiceId, practiceProfessionId: input.practiceProfessionId, professionalUserId, active: true })
          .onConflictDoUpdate({ target: [serviceProfessionals.serviceId, serviceProfessionals.professionalUserId], set: { practiceProfessionId: input.practiceProfessionId, practiceId, active: true } });
      }
      for (const locationId of input.locationIds) {
        await tx.insert(serviceLocations).values({ serviceId, practiceId, practiceProfessionId: input.practiceProfessionId, locationId, active: true })
          .onConflictDoUpdate({ target: [serviceLocations.serviceId, serviceLocations.locationId], set: { practiceProfessionId: input.practiceProfessionId, practiceId, active: true } });
      }
      return service;
    });
  }

  async listServices(userId: string, practiceId: string, locationId?: string) {
    return listPracticeServices(this.db, this.authorization, userId, practiceId, locationId);
  }

  private async assertLocation(practiceId: string, locationId: string): Promise<void> {
    const [row] = await this.db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.practiceId, practiceId))).limit(1);
    if (!row) throw new NotFoundException('Branch not found in this practice');
  }

  private async assertProfession(practiceId: string, professionId: string): Promise<void> {
    const [row] = await this.db.select({ id: practiceProfessions.id }).from(practiceProfessions)
      .where(and(eq(practiceProfessions.id, professionId), eq(practiceProfessions.practiceId, practiceId), eq(practiceProfessions.enabled, true))).limit(1);
    if (!row) throw new NotFoundException('Profession is not enabled for this practice');
  }

  private async assertLocations(practiceId: string, ids: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) throw new BadRequestException('Duplicate branch assignment');
    if (!uniqueIds.length) return [];
    const rows = await this.db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.practiceId, practiceId), sql`${locations.id} IN (${sql.join(uniqueIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
    if (rows.length !== uniqueIds.length) throw new BadRequestException('One or more branches are outside this practice');
    return uniqueIds;
  }

  private async assertServiceAssignments(practiceId: string, professionId: string, professionals: string[], locationIds: string[]): Promise<void> {
    if (!professionals.length || !locationIds.length) throw new BadRequestException('A service needs at least one eligible professional and branch');
    const locationsValid = await this.assertLocations(practiceId, locationIds);
    if (new Set(professionals).size !== professionals.length) throw new BadRequestException('Duplicate professional assignment');
    const profiles = await this.db.select({ userId: professionalProfiles.userId }).from(professionalProfiles)
      .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, professionalProfiles.practiceId), eq(practiceMemberships.userId, professionalProfiles.userId), eq(practiceMemberships.status, 'active')))
      .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
      .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
      .where(and(eq(professionalProfiles.practiceProfessionId, professionId), eq(professionalProfiles.practiceId, practiceId), sql`${professionalProfiles.userId} IN (${sql.join(professionals.map((id) => sql`${id}::uuid`), sql`, `)})`));
    if (profiles.length !== professionals.length) throw new BadRequestException('A selected professional lacks an active profile for this practice profession');
    const enabled = await this.db.select({ locationId: locationProfessions.locationId }).from(locationProfessions)
      .where(and(eq(locationProfessions.practiceProfessionId, professionId), eq(locationProfessions.practiceId, practiceId), eq(locationProfessions.enabled, true), sql`${locationProfessions.locationId} IN (${sql.join(locationsValid.map((id) => sql`${id}::uuid`), sql`, `)})`));
    if (enabled.length !== locationsValid.length) throw new BadRequestException('The profession must be enabled at every selected branch');
  }

  private async isOwner(userId: string, practiceId: string): Promise<boolean> {
    const rows = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .innerJoin(practiceMemberships, eq(practiceMemberships.id, practiceMembershipRoles.membershipId))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active')));
    return rows.some((row) => row.role === 'owner');
  }

}
