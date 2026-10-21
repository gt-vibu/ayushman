import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, availabilityExceptions, availabilityRules, bookingPolicies, clients, locations, practiceMembershipRoles, practiceMemberships, practiceProfessions, professionalLocations, professionalProfiles, practices, users } from '@ayushman-v2/db/schema';
import type { AvailabilityBatchInput, AvailabilityExceptionInput, AvailabilityExceptionQuery, BookingPolicyInput, ProfessionalScheduleInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { addLocalDays, localDateTime, localNowDate } from './time.js';

@Injectable()
export class AvailabilitySetupService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService) {}

  async listRules(userId: string, practiceId: string, locationId?: string) {
    const check = { userId, practiceId, permissionCode: 'availability.read', locationId, ownRecordsAreQueryScoped: true } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    const filters = [eq(availabilityRules.practiceId, practiceId), locationId
      ? or(eq(availabilityRules.locationId, locationId), and(sql`${availabilityRules.locationId} IS NULL`, or(eq(availabilityRules.scope, 'practice'), eq(availabilityRules.scope, 'professional'))))
      : sql`true`];
    if (ownScope) filters.push(eq(availabilityRules.professionalUserId, userId));
    return this.db.select().from(availabilityRules).where(and(...filters));
  }

  async addRules(userId: string, practiceId: string, input: AvailabilityBatchInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'availability.manage' });
    await this.validateScopes(practiceId, input.rules);
    if (!input.rules.length) throw new BadRequestException('At least one schedule interval is required');
    return this.db.insert(availabilityRules).values(input.rules.map((rule) => ({
      practiceId, scope: rule.scope, practiceProfessionId: rule.practiceProfessionId,
      locationId: rule.locationId, professionalUserId: rule.professionalUserId,
      weekday: rule.weekday, startMinute: rule.startMinute, endMinute: rule.endMinute,
      slotIntervalMinutes: rule.slotIntervalMinutes,
    }))).returning();
  }

  async replaceProfessionalSchedule(userId: string, practiceId: string, input: ProfessionalScheduleInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'availability.manage', locationId: input.locationId });
    await this.requireLocation(practiceId, input.locationId);
    const [assignment] = await this.db.select({ userId: professionalLocations.userId }).from(professionalLocations)
      .innerJoin(professionalProfiles, and(eq(professionalProfiles.practiceProfessionId, professionalLocations.practiceProfessionId), eq(professionalProfiles.userId, professionalLocations.userId)))
      .where(and(eq(professionalLocations.practiceId, practiceId), eq(professionalLocations.practiceProfessionId, input.practiceProfessionId), eq(professionalLocations.userId, userId), eq(professionalLocations.locationId, input.locationId))).limit(1);
    if (!assignment) throw new NotFoundException('You are not assigned to this profession and location');
    const values = input.rules.map((rule) => ({
      practiceId, scope: 'professional_location' as const, practiceProfessionId: input.practiceProfessionId,
      locationId: input.locationId, professionalUserId: userId, ...rule,
    }));
    return this.db.transaction(async (tx) => {
      await tx.delete(availabilityRules).where(and(
        eq(availabilityRules.practiceId, practiceId), eq(availabilityRules.scope, 'professional_location'),
        eq(availabilityRules.practiceProfessionId, input.practiceProfessionId), eq(availabilityRules.locationId, input.locationId),
        eq(availabilityRules.professionalUserId, userId),
      ));
      return values.length ? tx.insert(availabilityRules).values(values).returning() : [];
    });
  }

  async deleteRule(userId: string, practiceId: string, ruleId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'availability.manage' });
    const [row] = await this.db.delete(availabilityRules).where(and(eq(availabilityRules.id, ruleId), eq(availabilityRules.practiceId, practiceId))).returning({ id: availabilityRules.id });
    if (!row) throw new NotFoundException('Schedule interval not found');
    return { deleted: true };
  }

  async addException(userId: string, practiceId: string, input: AvailabilityExceptionInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'availability.manage', locationId: input.locationId ?? undefined, resourceOwnerUserId: input.professionalUserId ?? undefined });
    if (input.locationId) await this.requireLocation(practiceId, input.locationId);
    const [practice] = await this.db.select({ timezone: practices.timezone }).from(practices).where(eq(practices.id, practiceId)).limit(1);
    if (practice && input.date < localNowDate(practice.timezone)) throw new BadRequestException('Schedule changes must be today or a future date');
    if (input.practiceProfessionId) {
      const [profession] = await this.db.select({ id: practiceProfessions.id }).from(practiceProfessions)
        .where(and(eq(practiceProfessions.id, input.practiceProfessionId), eq(practiceProfessions.practiceId, practiceId))).limit(1);
      if (!profession) throw new NotFoundException('Profession not found in this practice');
    }
    if (input.professionalUserId) {
      if (!input.practiceProfessionId) throw new BadRequestException('A professional exception must identify the profession');
      const [profile] = await this.db.select({ userId: professionalProfiles.userId }).from(professionalProfiles)
        .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, professionalProfiles.userId), eq(practiceMemberships.status, 'active')))
        .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
        .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
        .where(and(eq(professionalProfiles.practiceId, practiceId), eq(professionalProfiles.practiceProfessionId, input.practiceProfessionId), eq(professionalProfiles.userId, input.professionalUserId))).limit(1);
      if (!profile) throw new NotFoundException('Professional profile not found in this practice');
      if (input.locationId) {
        const [assignment] = await this.db.select({ userId: professionalLocations.userId }).from(professionalLocations)
          .where(and(eq(professionalLocations.practiceProfessionId, input.practiceProfessionId), eq(professionalLocations.userId, input.professionalUserId), eq(professionalLocations.locationId, input.locationId))).limit(1);
        if (!assignment) throw new BadRequestException('Professional is not assigned to this branch');
      }
    }
    const [exception] = await this.db.insert(availabilityExceptions).values({
      practiceId, locationId: input.locationId, professionalUserId: input.professionalUserId,
      practiceProfessionId: input.practiceProfessionId, date: input.date, kind: input.kind,
      startMinute: input.startMinute, endMinute: input.endMinute, reason: input.reason,
    }).returning();
    let conflicts: Array<{ id: string; clientName: string; serviceName: string; startsAt: Date; endsAt: Date }> = [];
    if (input.kind === 'closed' && practice) {
      const start = localDateTime(input.date, input.startMinute ?? 0, practice.timezone);
      const end = localDateTime(input.date, input.endMinute ?? 1440, practice.timezone);
      if (start && end) {
        const filters = [eq(appointments.practiceId, practiceId), inArray(appointments.status, ['pending', 'confirmed']), gt(appointments.startsAt, new Date()), lt(appointments.reservedStartsAt, end), gt(appointments.reservedEndsAt, start)];
        if (input.locationId) filters.push(eq(appointments.locationId, input.locationId));
        if (input.professionalUserId) filters.push(eq(appointments.professionalUserId, input.professionalUserId));
        conflicts = await this.db.select({ id: appointments.id, clientName: clients.fullName, serviceName: appointments.serviceNameSnapshot, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
          .from(appointments).innerJoin(clients, eq(clients.id, appointments.clientId)).where(and(...filters)).orderBy(appointments.startsAt).limit(50);
      }
    }
    return { exception, conflicts };
  }

  async listExceptions(userId: string, practiceId: string, query: AvailabilityExceptionQuery) {
    const check = { userId, practiceId, permissionCode: 'availability.read', locationId: query.locationId, ownRecordsAreQueryScoped: true } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    const filters = [eq(availabilityExceptions.practiceId, practiceId)];
    if (query.locationId) filters.push(ownScope
      ? or(eq(availabilityExceptions.locationId, query.locationId), and(isNull(availabilityExceptions.locationId), eq(availabilityExceptions.professionalUserId, userId)))!
      : eq(availabilityExceptions.locationId, query.locationId));
    if (query.from) filters.push(gte(availabilityExceptions.date, query.from));
    if (query.to) filters.push(lte(availabilityExceptions.date, query.to));
    if (ownScope) filters.push(eq(availabilityExceptions.professionalUserId, userId));
    return this.db.select().from(availabilityExceptions).where(and(...filters));
  }

  async deleteException(userId: string, practiceId: string, exceptionId: string) {
    const [exception] = await this.db.select({ id: availabilityExceptions.id, locationId: availabilityExceptions.locationId, professionalUserId: availabilityExceptions.professionalUserId })
      .from(availabilityExceptions).where(and(eq(availabilityExceptions.id, exceptionId), eq(availabilityExceptions.practiceId, practiceId))).limit(1);
    if (!exception) throw new NotFoundException('Availability exception not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'availability.manage', locationId: exception.locationId ?? undefined, resourceOwnerUserId: exception.professionalUserId ?? undefined });
    await this.db.delete(availabilityExceptions).where(eq(availabilityExceptions.id, exceptionId));
    return { deleted: true };
  }

  async getPolicy(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'booking_policy.read' });
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, practiceId)).limit(1);
    if (!policy) throw new NotFoundException('Booking policy not found');
    return policy;
  }

  async updatePolicy(userId: string, practiceId: string, input: BookingPolicyInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'booking_policy.manage' });
    const [policy] = await this.db.insert(bookingPolicies).values({ practiceId, ...input })
      .onConflictDoUpdate({ target: bookingPolicies.practiceId, set: { ...input, updatedAt: new Date() } }).returning();
    return policy;
  }

  private async validateScopes(practiceId: string, rules: AvailabilityBatchInput['rules']): Promise<void> {
    for (const rule of rules) {
      if (rule.locationId) await this.requireLocation(practiceId, rule.locationId);
      if (rule.practiceProfessionId) {
        const [profession] = await this.db.select({ id: practiceProfessions.id }).from(practiceProfessions)
          .where(and(eq(practiceProfessions.id, rule.practiceProfessionId), eq(practiceProfessions.practiceId, practiceId))).limit(1);
        if (!profession) throw new NotFoundException('Profession not found in this practice');
      }
      if (rule.professionalUserId) {
        if (!rule.practiceProfessionId) throw new BadRequestException('Professional schedules must identify the profession');
        const [profile] = await this.db.select({ userId: professionalProfiles.userId }).from(professionalProfiles)
          .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, professionalProfiles.userId), eq(practiceMemberships.status, 'active')))
          .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
          .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
          .where(and(eq(professionalProfiles.practiceId, practiceId), eq(professionalProfiles.practiceProfessionId, rule.practiceProfessionId), eq(professionalProfiles.userId, rule.professionalUserId))).limit(1);
        if (!profile) throw new NotFoundException('Professional profile not found in this practice');
        if (rule.locationId) {
          const [assignment] = await this.db.select({ userId: professionalLocations.userId }).from(professionalLocations)
            .where(and(eq(professionalLocations.practiceProfessionId, rule.practiceProfessionId), eq(professionalLocations.userId, rule.professionalUserId), eq(professionalLocations.locationId, rule.locationId))).limit(1);
          if (!assignment) throw new BadRequestException('Professional is not assigned to this branch');
        }
      }
    }
  }

  private async requireLocation(practiceId: string, locationId: string): Promise<void> {
    const [location] = await this.db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.practiceId, practiceId), eq(locations.id, locationId))).limit(1);
    if (!location) throw new NotFoundException('Branch not found in this practice');
  }
}
