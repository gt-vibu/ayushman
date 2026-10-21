import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import {
  appointments, appointmentNotifications, auditEvents, availabilityExceptions, availabilityRules, bookingPolicies, clients, customerProfiles,
  idempotencyKeys, locationProfessions, locations, practiceMembershipRoles, practiceMemberships, practiceProfessions,
  practices, professionalLocations, professionalProfiles, serviceLocations,
  serviceProfessionals, services, users,
} from '@ayushman-v2/db/schema';
import type { PublicAvailabilityQuery, PublicBookingHoldInput, PublicBookingInput, PublicDirectoryQuery } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { REDIS, type RedisStore } from '../redis.module.js';
import { readEnvironment } from '../config.js';
import { addLocalDays, localDateTime, localNowDate, weekdayForDate } from './time.js';

type Window = { startMinute: number; endMinute: number; slotIntervalMinutes: number };
type BusyIndex = { starts: number[]; maxEnds: number[] };

function buildBusyIndexes(rows: Array<{ id: string; professionalUserId: string; start: Date; end: Date }>, excludeAppointmentId?: string | string[]) {
  const excludedIds = new Set(Array.isArray(excludeAppointmentId) ? excludeAppointmentId : excludeAppointmentId ? [excludeAppointmentId] : []);
  const grouped = new Map<string, Array<{ start: number; end: number }>>();
  for (const row of rows) {
    if (excludedIds.has(row.id)) continue;
    const intervals = grouped.get(row.professionalUserId) ?? [];
    intervals.push({ start: row.start.getTime(), end: row.end.getTime() });
    grouped.set(row.professionalUserId, intervals);
  }
  const indexes = new Map<string, BusyIndex>();
  for (const [professionalId, intervals] of grouped) {
    intervals.sort((left, right) => left.start - right.start);
    let maxEnd = Number.NEGATIVE_INFINITY;
    const starts: number[] = [];
    const maxEnds: number[] = [];
    for (const interval of intervals) {
      starts.push(interval.start);
      maxEnd = Math.max(maxEnd, interval.end);
      maxEnds.push(maxEnd);
    }
    indexes.set(professionalId, { starts, maxEnds });
  }
  return indexes;
}

function hasBusyOverlap(index: BusyIndex | undefined, start: number, end: number) {
  if (!index) return false;
  let low = 0;
  let high = index.starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.starts[middle] < end) low = middle + 1;
    else high = middle;
  }
  return low > 0 && index.maxEnds[low - 1] > start;
}

@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private readonly publicPracticeInflight = new Map<string, Promise<unknown>>();
  private holdExpiryTimer: NodeJS.Timeout | undefined;

  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(REDIS) private readonly redis: RedisStore) {}

  onModuleInit() {
    this.holdExpiryTimer = setInterval(() => { void this.expireBookingHolds().catch(() => undefined); }, 5_000);
    this.holdExpiryTimer.unref();
  }

  onModuleDestroy() { if (this.holdExpiryTimer) clearInterval(this.holdExpiryTimer); }

  async limitPublicRequest(ip: string): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `ayushman:public-booking:${ip}:${minute}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 75);
    if (count > readEnvironment().PUBLIC_BOOKING_RATE_LIMIT_PER_MINUTE) {
      throw new HttpException('Please wait a minute before trying again', 429);
    }
  }

  async publicPractice(practiceId: string) {
    const cacheKey = `ayushman:v3:public-practice:${practiceId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof this.loadPublicPractice>>;
    } catch {
      // Redis is an optimization for public reads; the database remains the source of truth.
    }
    let pending = this.publicPracticeInflight.get(practiceId);
    if (!pending) {
      pending = this.loadPublicPractice(practiceId).then(async (result) => {
        try { await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 20); } catch { /* Redis failure must not block booking discovery. */ }
        return result;
      }).finally(() => this.publicPracticeInflight.delete(practiceId));
      this.publicPracticeInflight.set(practiceId, pending);
    }
    return await pending as Awaited<ReturnType<typeof this.loadPublicPractice>>;
  }

  private async loadPublicPractice(practiceId: string) {
    const [practiceRows, branches, enabledProfessions, offeringRows] = await Promise.all([
      this.db.select({
      id: practices.id, name: practices.name, slug: practices.slug, description: practices.description,
      phone: practices.phone, website: practices.website, timezone: practices.timezone,
        publicBookingEnabled: practices.publicBookingEnabled,
      }).from(practices).where(and(eq(practices.id, practiceId), eq(practices.active, true), or(eq(practices.publicListingEnabled, true), eq(practices.publicBookingEnabled, true)))).limit(1),
      this.db.select({ id: locations.id, name: locations.name, address: locations.address, timezone: locations.timezone })
        .from(locations).where(and(eq(locations.practiceId, practiceId), eq(locations.active, true))),
      this.db.select().from(practiceProfessions)
        .where(and(eq(practiceProfessions.practiceId, practiceId), eq(practiceProfessions.enabled, true))),
      this.db.select({
        serviceId: services.id, practiceProfessionId: services.practiceProfessionId, name: services.name,
        description: services.description, durationMinutes: services.durationMinutes, priceMinor: services.priceMinor,
        currency: services.currency, locationId: locations.id, locationName: locations.name,
        professionalUserId: users.id, professionalName: users.fullName,
      }).from(services)
        .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.active, true)))
        .innerJoin(locations, and(eq(locations.id, serviceLocations.locationId), eq(locations.active, true)))
        .innerJoin(locationProfessions, and(eq(locationProfessions.locationId, locations.id), eq(locationProfessions.practiceProfessionId, services.practiceProfessionId), eq(locationProfessions.enabled, true)))
        .innerJoin(practiceProfessions, and(eq(practiceProfessions.id, services.practiceProfessionId), eq(practiceProfessions.enabled, true)))
        .innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.active, true)))
        .innerJoin(professionalProfiles, and(eq(professionalProfiles.userId, serviceProfessionals.professionalUserId), eq(professionalProfiles.practiceProfessionId, services.practiceProfessionId)))
        .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
        .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, users.id), eq(practiceMemberships.status, 'active')))
        .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
        .where(and(eq(services.practiceId, practiceId), eq(services.active, true), eq(services.onlineBookable, true), eq(locations.practiceId, practiceId))),
    ]);
    const [practice] = practiceRows;
    if (!practice) throw new NotFoundException('Practice not found');
    const servicesById = new Map<string, {
      id: string; practiceProfessionId: string; name: string; description: string | null; durationMinutes: number;
      priceMinor: number | null; currency: string; locations: Map<string, { id: string; name: string }>;
      professionals: Map<string, { id: string; name: string }>;
    }>();
    for (const row of offeringRows) {
      let service = servicesById.get(row.serviceId);
      if (!service) {
        service = { id: row.serviceId, practiceProfessionId: row.practiceProfessionId, name: row.name, description: row.description,
          durationMinutes: row.durationMinutes, priceMinor: row.priceMinor, currency: row.currency,
          locations: new Map(), professionals: new Map() };
        servicesById.set(row.serviceId, service);
      }
      service.locations.set(row.locationId, { id: row.locationId, name: row.locationName });
      service.professionals.set(row.professionalUserId, {
        id: row.professionalUserId, name: row.professionalName,
      });
    }
    return {
      practice,
      professions: enabledProfessions,
      locations: [...new Map(branches.map((branch) => [branch.id, branch])).values()],
      services: [...servicesById.values()].map((service) => ({ ...service, locations: [...service.locations.values()], professionals: [...service.professionals.values()] })),
    };
  }

  async searchDirectory(query: PublicDirectoryQuery) {
    const term = query.q?.trim() ?? '';
    const search = `%${term}%`;
    const cacheKey = `ayushman:v4:directory:${createHash('sha1').update(term.toLocaleLowerCase('en-US')).digest('hex')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Array<{ id: string; name: string; slug: string; description: string | null; timezone: string; services: Array<{ id: string; name: string; durationMinutes: number; priceMinor: number | null; currency: string }> }>;
    const rows = await this.db.select({
      id: practices.id, name: practices.name, slug: practices.slug,
      description: practices.description, timezone: practices.timezone,
    }).from(practices).where(and(
      eq(practices.active, true), eq(practices.publicListingEnabled, true),
      term ? sql`(
        ${practices.name} ILIKE ${search} OR ${practices.slug} ILIKE ${search} OR
        EXISTS (SELECT 1 FROM practice_professions pp WHERE pp.practice_id = ${practices.id} AND pp.enabled AND pp.name ILIKE ${search}) OR
        EXISTS (SELECT 1 FROM services s WHERE s.practice_id = ${practices.id} AND s.active AND s.online_bookable AND s.name ILIKE ${search}) OR
        EXISTS (SELECT 1 FROM professional_profiles prof JOIN users u ON u.id = prof.user_id WHERE prof.practice_id = ${practices.id} AND u.disabled_at IS NULL AND u.full_name ILIKE ${search})
      )` : sql`true`,
    )).orderBy(asc(practices.name)).limit(30);
    if (!rows.length) {
      await this.redis.set(cacheKey, JSON.stringify([]), 'EX', 30);
      return [];
    }
    const practiceIds = rows.map((row) => row.id);
    const offerings = await this.db.select({
      practiceId: services.practiceId, id: services.id, name: services.name,
      durationMinutes: services.durationMinutes, priceMinor: services.priceMinor, currency: services.currency,
    }).from(services)
      .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.active, true)))
      .innerJoin(locations, and(eq(locations.id, serviceLocations.locationId), eq(locations.active, true)))
      .innerJoin(locationProfessions, and(eq(locationProfessions.locationId, locations.id), eq(locationProfessions.practiceProfessionId, services.practiceProfessionId), eq(locationProfessions.enabled, true)))
      .innerJoin(practiceProfessions, and(eq(practiceProfessions.id, services.practiceProfessionId), eq(practiceProfessions.enabled, true)))
      .innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.active, true)))
      .innerJoin(professionalProfiles, and(eq(professionalProfiles.userId, serviceProfessionals.professionalUserId), eq(professionalProfiles.practiceProfessionId, services.practiceProfessionId)))
      .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
      .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, services.practiceId), eq(practiceMemberships.userId, users.id), eq(practiceMemberships.status, 'active')))
      .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
      .where(and(inArray(services.practiceId, practiceIds), eq(services.active, true), eq(services.onlineBookable, true)))
      .orderBy(asc(services.name));
    const offeringsByPractice = new Map<string, Map<string, (typeof offerings)[number]>>();
    for (const offering of offerings) {
      const practiceOfferings = offeringsByPractice.get(offering.practiceId) ?? new Map();
      practiceOfferings.set(offering.id, offering);
      offeringsByPractice.set(offering.practiceId, practiceOfferings);
    }
    const results = rows.map((practice) => ({
      ...practice,
      services: [...(offeringsByPractice.get(practice.id)?.values() ?? [])].map(({ practiceId: _practiceId, ...service }) => service),
    }));
    await this.redis.set(cacheKey, JSON.stringify(results), 'EX', 30);
    return results;
  }

  async availableSlots(practiceId: string, query: PublicAvailabilityQuery, skipCache = false, internal = false, excludeAppointmentId?: string | string[]) {
    const cacheVersion = await this.availabilityCacheVersion(practiceId);
    const cacheKey = `ayushman:v2:availability:${cacheVersion}:${createHash('sha1').update(JSON.stringify({ practiceId, ...query })).digest('hex')}`;
    if (!skipCache) {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as { timezone: string; slots: Array<{ startsAt: string; endsAt: string; professional: { id: string; name: string } }> };
    }
    const { practice, service, policy } = internal
      ? await this.internalAvailabilityContext(practiceId, query.serviceId)
      : await this.publicContext(practiceId, query.serviceId);
    this.validateDateRange(query.from, query.to, practice.timezone, policy.maxAdvanceDays);
    const [location] = await this.db.select({ id: locations.id, active: locations.active })
      .from(locations).innerJoin(serviceLocations, eq(serviceLocations.locationId, locations.id))
      .where(and(eq(locations.id, query.locationId), eq(locations.practiceId, practiceId), eq(locations.active, true), eq(serviceLocations.serviceId, service.id), eq(serviceLocations.active, true))).limit(1);
    if (!location) throw new NotFoundException('This service is not available at that branch');
    const [professionAtLocation] = await this.db.select({ enabled: locationProfessions.enabled, professionEnabled: practiceProfessions.enabled })
      .from(locationProfessions).innerJoin(practiceProfessions, eq(practiceProfessions.id, locationProfessions.practiceProfessionId))
      .where(and(eq(locationProfessions.practiceProfessionId, service.practiceProfessionId), eq(locationProfessions.locationId, location.id))).limit(1);
    if (!professionAtLocation?.enabled || !professionAtLocation.professionEnabled) return { timezone: practice.timezone, slots: [] };

    const professionals = await this.db.select({ id: professionalProfiles.userId, fullName: users.fullName })
      .from(serviceProfessionals)
      .innerJoin(professionalProfiles, and(eq(professionalProfiles.userId, serviceProfessionals.professionalUserId), eq(professionalProfiles.practiceProfessionId, service.practiceProfessionId)))
      .innerJoin(practiceMemberships, and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, professionalProfiles.userId), eq(practiceMemberships.status, 'active')))
      .innerJoin(users, and(eq(users.id, professionalProfiles.userId), isNull(users.disabledAt)))
      .innerJoin(practiceMembershipRoles, and(eq(practiceMembershipRoles.membershipId, practiceMemberships.id), eq(practiceMembershipRoles.role, 'professional')))
      .innerJoin(professionalLocations, and(eq(professionalLocations.practiceProfessionId, service.practiceProfessionId), eq(professionalLocations.userId, professionalProfiles.userId), eq(professionalLocations.locationId, location.id)))
      .where(and(eq(serviceProfessionals.serviceId, service.id), eq(serviceProfessionals.practiceId, practiceId), eq(serviceProfessionals.active, true), query.professionalUserId ? eq(professionalProfiles.userId, query.professionalUserId) : sql`true`));
    if (query.professionalUserId && !professionals.length) throw new NotFoundException('This professional is not eligible for the selected service and branch');

    const rules = await this.db.select().from(availabilityRules).where(and(eq(availabilityRules.practiceId, practiceId), eq(availabilityRules.active, true)));
    const exceptions = await this.db.select().from(availabilityExceptions).where(and(
      eq(availabilityExceptions.practiceId, practiceId), gte(availabilityExceptions.date, query.from), lte(availabilityExceptions.date, query.to),
      or(eq(availabilityExceptions.locationId, location.id), ...professionals.map((person) => eq(availabilityExceptions.professionalUserId, person.id))),
    ));
    const appointmentsInRange = professionals.length ? await this.db.select({ id: appointments.id, professionalUserId: appointments.professionalUserId, start: appointments.reservedStartsAt, end: appointments.reservedEndsAt })
      .from(appointments).where(and(eq(appointments.practiceId, practiceId), inArray(appointments.professionalUserId, professionals.map((person) => person.id)), neCancelled(), lt(appointments.reservedStartsAt, localDateTime(addLocalDays(query.to, 1), 0, practice.timezone)!), gt(appointments.reservedEndsAt, localDateTime(query.from, 0, practice.timezone)!))) : [];
    const busyByProfessional = buildBusyIndexes(appointmentsInRange, excludeAppointmentId);

    const slots: Array<{ startsAt: string; endsAt: string; professional: { id: string; name: string } }> = [];
    for (let date = query.from; date <= query.to; date = addLocalDays(date, 1)) {
      const weekday = weekdayForDate(date);
      const dayExceptions = exceptions.filter((item) => item.date === date);
      for (const person of professionals) {
        const branchWindows = this.windowsFor(rules, 'location', location.id, weekday, practiceId);
        const practiceWindows = this.windowsFor(rules, 'practice', undefined, weekday, practiceId);
        const chosenBranch = branchWindows.length ? branchWindows : practiceWindows;
        const specificProfessional = this.windowsFor(rules, 'professional_location', person.id, weekday, practiceId, location.id, service.practiceProfessionId);
        const generalProfessional = this.windowsFor(rules, 'professional', person.id, weekday, practiceId, undefined, service.practiceProfessionId);
        const chosenProfessional = specificProfessional.length ? specificProfessional : generalProfessional;
        let branchHours = chosenBranch;
        let professionalHours = chosenProfessional;
        const branchClosures = dayExceptions.filter((item) => item.locationId === location.id && item.professionalUserId === null && item.kind === 'closed');
        const proClosures = dayExceptions.filter((item) => item.professionalUserId === person.id && item.practiceProfessionId === service.practiceProfessionId && (!item.locationId || item.locationId === location.id) && item.kind === 'closed');
        const branchExtras = dayExceptions.filter((item) => item.locationId === location.id && item.professionalUserId === null && item.kind === 'extra_hours' && item.startMinute !== null && item.endMinute !== null);
        const proExtras = dayExceptions.filter((item) => item.professionalUserId === person.id && item.practiceProfessionId === service.practiceProfessionId && (!item.locationId || item.locationId === location.id) && item.kind === 'extra_hours' && item.startMinute !== null && item.endMinute !== null);
        if (branchClosures.some((item) => item.startMinute === null)) branchHours = [];
        if (proClosures.some((item) => item.startMinute === null)) professionalHours = [];
        branchHours = [...branchHours, ...branchExtras.map((item) => ({ startMinute: item.startMinute!, endMinute: item.endMinute!, slotIntervalMinutes: 30 }))];
        professionalHours = [...professionalHours, ...proExtras.map((item) => ({ startMinute: item.startMinute!, endMinute: item.endMinute!, slotIntervalMinutes: 30 }))];
        for (const branchWindow of branchHours) for (const proWindow of professionalHours) {
          const windowStart = Math.max(branchWindow.startMinute, proWindow.startMinute);
          const windowEnd = Math.min(branchWindow.endMinute, proWindow.endMinute);
          const interval = proWindow.slotIntervalMinutes || service.durationMinutes;
          const earliestWithBuffer = Math.max(windowStart, proWindow.startMinute + service.bufferBeforeMinutes);
          const firstMinute = proWindow.startMinute + Math.ceil((earliestWithBuffer - proWindow.startMinute) / interval) * interval;
          for (let minute = firstMinute; minute + service.durationMinutes + service.bufferAfterMinutes <= windowEnd; minute += interval) {
            if (branchClosures.some((item) => this.overlapsMinutes(minute - service.bufferBeforeMinutes, minute + service.durationMinutes + service.bufferAfterMinutes, item))) continue;
            if (proClosures.some((item) => this.overlapsMinutes(minute - service.bufferBeforeMinutes, minute + service.durationMinutes + service.bufferAfterMinutes, item))) continue;
            const start = localDateTime(date, minute, practice.timezone);
            if (!start) continue;
            const end = new Date(start.getTime() + service.durationMinutes * 60_000);
            const reservedStart = new Date(start.getTime() - service.bufferBeforeMinutes * 60_000);
            const reservedEnd = new Date(end.getTime() + service.bufferAfterMinutes * 60_000);
            if (start.getTime() < Date.now() + policy.minNoticeMinutes * 60_000) continue;
            if (hasBusyOverlap(busyByProfessional.get(person.id), reservedStart.getTime(), reservedEnd.getTime())) continue;
            slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), professional: { id: person.id, name: person.fullName } });
          }
        }
      }
    }
    const uniqueSlots = new Map(slots.map((slot) => [`${slot.professional.id}:${slot.startsAt}`, slot]));
    const result = { timezone: practice.timezone, slots: [...uniqueSlots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.professional.name.localeCompare(b.professional.name)) };
    if (!skipCache) await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 8);
    return result;
  }

  async createBookingHold(practiceId: string, customerUserId: string, key: string | undefined, input: PublicBookingHoldInput) {
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('A valid Idempotency-Key header is required');
    const [customer] = await this.db.select({ userId: users.id, fullName: users.fullName, email: users.email, phone: customerProfiles.phone })
      .from(customerProfiles).innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(and(eq(customerProfiles.userId, customerUserId), isNull(users.disabledAt))).limit(1);
    if (!customer) throw new NotFoundException('Customer account not found');
    const bodyHash = createHash('sha256').update(JSON.stringify({ input, customerUserId, purpose: 'booking-hold' })).digest('hex');
    const [prior] = await this.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
    if (prior && prior.expiresAt > new Date()) {
      if (prior.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
      if (prior.response) {
        const response = prior.response as { hold?: { id: string; expiresAt: string } };
        if (response.hold && new Date(response.hold.expiresAt) > new Date()) return response;
        await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, prior.id));
      } else throw new ConflictException('This booking request is still processing; retry shortly with the same key');
    }
    const { practice, service, policy } = await this.publicContext(practiceId, input.serviceId);
    if (policy.requirePrepayment) throw new ConflictException('This practice requires online payment, but its payment provider is not configured');
    const start = new Date(input.startsAt);
    const reservedStart = new Date(start.getTime() - service.bufferBeforeMinutes * 60_000);
    const reservedEnd = new Date(start.getTime() + (service.durationMinutes + service.bufferAfterMinutes) * 60_000);
    const expiredForSlot = await this.db.update(appointments).set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Temporary booking hold expired', updatedAt: new Date() })
      .where(and(eq(appointments.status, 'held'), lte(appointments.holdExpiresAt, new Date()), eq(appointments.professionalUserId, input.professionalUserId), lt(appointments.reservedStartsAt, reservedEnd), gt(appointments.reservedEndsAt, reservedStart))).returning({ id: appointments.id });
    if (expiredForSlot.length) await this.bumpAvailabilityCache(practiceId);
    const date = localDateFromInstant(start, practice.timezone);
    const available = await this.availableSlots(practiceId, { serviceId: input.serviceId, locationId: input.locationId, professionalUserId: input.professionalUserId, from: date, to: date }, true);
    if (!available.slots.some((item) => item.startsAt === start.toISOString() && item.professional.id === input.professionalUserId)) throw new ConflictException('That time is no longer available. Choose another slot.');
    const expiresAt = new Date(Date.now() + readEnvironment().BOOKING_HOLD_TTL_SECONDS * 1000);
    try {
      const response = await this.db.transaction(async (tx) => {
        const cleanupNow = new Date();
        const reservedStart = new Date(start.getTime() - service.bufferBeforeMinutes * 60_000);
        const reservedEnd = new Date(start.getTime() + (service.durationMinutes + service.bufferAfterMinutes) * 60_000);
        await tx.update(appointments).set({ status: 'cancelled', cancelledAt: cleanupNow, cancellationReason: 'Temporary booking hold expired', updatedAt: cleanupNow })
          .where(and(eq(appointments.status, 'held'), lte(appointments.holdExpiresAt, cleanupNow), eq(appointments.professionalUserId, input.professionalUserId), lt(appointments.reservedStartsAt, reservedEnd), gt(appointments.reservedEndsAt, reservedStart)));
        await tx.insert(idempotencyKeys).values({ practiceId, key, requestHash: bodyHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).onConflictDoNothing();
        const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
        if (existing.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
        if (existing.response) return existing.response as { hold: { id: string; startsAt: string; expiresAt: string; serviceName: string } };
        const client = await this.findOrCreateAccountClient(tx, practiceId, customer);
        // Keep one checkout hold per customer and practice. This update rolls back if the new hold cannot be acquired.
        await tx.update(appointments).set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Replaced by a new booking hold', updatedAt: new Date() })
          .where(and(eq(appointments.practiceId, practiceId), eq(appointments.clientId, client.id), eq(appointments.status, 'held')));
        const end = new Date(start.getTime() + service.durationMinutes * 60_000);
        const [hold] = await tx.insert(appointments).values({
          practiceId, practiceProfessionId: service.practiceProfessionId, locationId: input.locationId,
          serviceId: service.id, professionalUserId: input.professionalUserId, clientId: client.id,
          createdByUserId: customerUserId, startsAt: start, endsAt: end,
          reservedStartsAt: new Date(start.getTime() - service.bufferBeforeMinutes * 60_000),
          reservedEndsAt: new Date(end.getTime() + service.bufferAfterMinutes * 60_000), timezone: practice.timezone,
          serviceNameSnapshot: service.name, durationMinutesSnapshot: service.durationMinutes,
          bufferBeforeMinutesSnapshot: service.bufferBeforeMinutes, bufferAfterMinutesSnapshot: service.bufferAfterMinutes,
          priceMinorSnapshot: service.priceMinor, currencySnapshot: service.currency, status: 'held', holdExpiresAt: expiresAt,
        }).returning({ id: appointments.id, startsAt: appointments.startsAt, holdExpiresAt: appointments.holdExpiresAt, serviceNameSnapshot: appointments.serviceNameSnapshot });
        const result = { hold: { id: hold.id, startsAt: hold.startsAt.toISOString(), expiresAt: hold.holdExpiresAt!.toISOString(), serviceName: hold.serviceNameSnapshot } };
        await tx.update(idempotencyKeys).set({ response: result }).where(eq(idempotencyKeys.id, existing.id));
        return result;
      });
      await this.bumpAvailabilityCache(practiceId);
      return response;
    } catch (error) {
      if (this.isUniqueViolation(error) || this.isExclusionViolation(error)) throw new ConflictException('Someone else just reserved that time. Please choose another slot.');
      throw error;
    }
  }

  async releaseBookingHold(practiceId: string, customerUserId: string, holdId: string) {
    const [row] = await this.db.select({ id: appointments.id, practiceId: appointments.practiceId }).from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId))
      .where(and(eq(appointments.id, holdId), eq(appointments.practiceId, practiceId), eq(clients.userId, customerUserId), eq(appointments.status, 'held'))).limit(1);
    if (!row) return { released: false };
    const [released] = await this.db.update(appointments).set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Customer released booking hold', updatedAt: new Date() })
      .where(and(eq(appointments.id, holdId), eq(appointments.status, 'held'))).returning({ id: appointments.id });
    if (released) await this.bumpAvailabilityCache(practiceId);
    return { released: Boolean(released) };
  }

  async confirmPublicBookingHold(practiceId: string, customerUserId: string, key: string | undefined, input: PublicBookingInput) {
    if (!input.holdId) throw new BadRequestException('A booking hold is required. Please choose a time again.');
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('A valid Idempotency-Key header is required');
    const [customer] = await this.db.select({ userId: users.id, fullName: users.fullName, email: users.email, phone: customerProfiles.phone })
      .from(customerProfiles).innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(and(eq(customerProfiles.userId, customerUserId), isNull(users.disabledAt))).limit(1);
    if (!customer) throw new NotFoundException('Customer account not found');
    const bodyHash = createHash('sha256').update(JSON.stringify({ input, customerUserId })).digest('hex');
    const [prior] = await this.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
    if (prior && prior.expiresAt > new Date()) {
      if (prior.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
      if (prior.response) return prior.response;
      throw new ConflictException('This booking request is still processing; retry shortly with the same key');
    }
    const { policy } = await this.publicContext(practiceId, input.serviceId);
    if (policy.requirePrepayment) throw new ConflictException('This practice requires online payment, but its payment provider is not configured');
    try {
      const response = await this.db.transaction(async (tx) => {
        await tx.insert(idempotencyKeys).values({ practiceId, key, requestHash: bodyHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).onConflictDoNothing();
        const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
        if (existing.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
        if (existing.response) return existing.response as { appointment: { id: string; status: string; startsAt: Date } };
        const [hold] = await tx.select({ id: appointments.id, status: appointments.status, startsAt: appointments.startsAt, endsAt: appointments.endsAt, clientId: appointments.clientId, professionalUserId: appointments.professionalUserId, serviceId: appointments.serviceId, locationId: appointments.locationId, holdExpiresAt: appointments.holdExpiresAt }).from(appointments)
          .innerJoin(clients, eq(clients.id, appointments.clientId))
          .where(and(eq(appointments.id, input.holdId!), eq(appointments.practiceId, practiceId), eq(clients.userId, customerUserId), eq(appointments.status, 'held'))).limit(1);
        if (!hold || !hold.holdExpiresAt || hold.holdExpiresAt <= new Date() || hold.serviceId !== input.serviceId || hold.locationId !== input.locationId || hold.professionalUserId !== input.professionalUserId || hold.startsAt.toISOString() !== new Date(input.startsAt).toISOString()) throw new ConflictException('Your booking hold has expired. Please choose another time.');
        const status = policy.confirmationMode === 'approval' ? 'pending' : 'confirmed';
        const [appointment] = await tx.update(appointments).set({ status, holdExpiresAt: null, clientNote: input.note, updatedAt: new Date() })
          .where(and(eq(appointments.id, hold.id), eq(appointments.status, 'held'), gt(appointments.holdExpiresAt, new Date()))).returning({ id: appointments.id, status: appointments.status, startsAt: appointments.startsAt, endsAt: appointments.endsAt, clientId: appointments.clientId });
        if (!appointment) throw new ConflictException('Your booking hold has expired. Please choose another time.');
        await tx.insert(auditEvents).values({ practiceId, actorUserId: customerUserId, action: 'appointment.booked', entityType: 'appointment', entityId: appointment.id, metadata: { serviceId: input.serviceId, locationId: input.locationId, professionalUserId: input.professionalUserId } });
        await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: input.professionalUserId, appointmentId: appointment.id, kind: 'new_booking' });
        const result = { appointment };
        await tx.update(idempotencyKeys).set({ response: result }).where(eq(idempotencyKeys.id, existing.id));
        return result;
      });
      await this.bumpAvailabilityCache(practiceId);
      return response;
    } catch (error) {
      if (this.isUniqueViolation(error) || this.isExclusionViolation(error)) throw new ConflictException('That time was just booked. Please choose another slot');
      throw error;
    }
  }

  private async expireBookingHolds() {
    const expired = await this.db.update(appointments).set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Temporary booking hold expired', updatedAt: new Date() })
      .where(and(eq(appointments.status, 'held'), lte(appointments.holdExpiresAt, new Date()))).returning({ practiceId: appointments.practiceId });
    for (const practiceId of new Set(expired.map((item) => item.practiceId))) await this.bumpAvailabilityCache(practiceId);
  }

  private async availabilityCacheVersion(practiceId: string) {
    try { return await this.redis.get(`ayushman:v2:availability-version:${practiceId}`) ?? '0'; } catch { return '0'; }
  }

  private async bumpAvailabilityCache(practiceId: string) {
    try { await this.redis.incr(`ayushman:v2:availability-version:${practiceId}`); } catch { /* The PostgreSQL exclusion constraint still protects every booking. */ }
  }

  async createPublicBooking(practiceId: string, customerUserId: string, key: string | undefined, input: PublicBookingInput) {
    if (input.holdId) return this.confirmPublicBookingHold(practiceId, customerUserId, key, input);
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('A valid Idempotency-Key header is required');
    const [customer] = await this.db.select({ userId: users.id, fullName: users.fullName, email: users.email, phone: customerProfiles.phone })
      .from(customerProfiles).innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(and(eq(customerProfiles.userId, customerUserId), isNull(users.disabledAt))).limit(1);
    if (!customer) throw new NotFoundException('Customer account not found');
    const bodyHash = createHash('sha256').update(JSON.stringify({ input, customerUserId })).digest('hex');
    const [prior] = await this.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
    if (prior && prior.expiresAt > new Date()) {
      if (prior.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
      if (prior.response) return prior.response;
      throw new ConflictException('This booking request is still processing; retry shortly with the same key');
    }
    if (prior) await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, prior.id));
    const { practice, service, policy } = await this.publicContext(practiceId, input.serviceId);
    if (policy.requirePrepayment) throw new ConflictException('This practice requires online payment, but its payment provider is not configured');
    const start = new Date(input.startsAt);
    const date = localDateFromInstant(start, practice.timezone);
    const available = await this.availableSlots(practiceId, {
      serviceId: input.serviceId, locationId: input.locationId, professionalUserId: input.professionalUserId, from: date, to: date,
    }, true);
    if (!available.slots.some((slot) => slot.startsAt === start.toISOString() && slot.professional.id === input.professionalUserId)) {
      throw new ConflictException('That time is no longer available');
    }
    try {
      const response = await this.db.transaction(async (tx) => {
        await tx.insert(idempotencyKeys).values({ practiceId, key, requestHash: bodyHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).onConflictDoNothing();
        const [existing] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
        if (existing.requestHash !== bodyHash) throw new ConflictException('Idempotency key was already used for a different request');
        if (existing.response) return existing.response;
        const client = await this.findOrCreateAccountClient(tx, practiceId, customer);
        const end = new Date(start.getTime() + service.durationMinutes * 60_000);
        const status = policy.confirmationMode === 'approval' ? 'pending' : 'confirmed';
        const [appointment] = await tx.insert(appointments).values({
          practiceId, practiceProfessionId: service.practiceProfessionId, locationId: input.locationId,
          serviceId: service.id, professionalUserId: input.professionalUserId, clientId: client.id,
          createdByUserId: customerUserId,
          startsAt: start, endsAt: end, reservedStartsAt: new Date(start.getTime() - service.bufferBeforeMinutes * 60_000),
          reservedEndsAt: new Date(end.getTime() + service.bufferAfterMinutes * 60_000), timezone: practice.timezone,
          serviceNameSnapshot: service.name, durationMinutesSnapshot: service.durationMinutes,
          bufferBeforeMinutesSnapshot: service.bufferBeforeMinutes, bufferAfterMinutesSnapshot: service.bufferAfterMinutes,
          priceMinorSnapshot: service.priceMinor, currencySnapshot: service.currency, status, clientNote: input.note,
        }).returning({ id: appointments.id, status: appointments.status, startsAt: appointments.startsAt, endsAt: appointments.endsAt, clientId: appointments.clientId });
        await tx.insert(auditEvents).values({
          practiceId, actorUserId: customerUserId, action: 'appointment.booked', entityType: 'appointment',
          entityId: appointment.id, metadata: { serviceId: service.id, locationId: input.locationId, professionalUserId: input.professionalUserId },
        });
        await tx.insert(appointmentNotifications).values({
          practiceId, recipientUserId: input.professionalUserId, appointmentId: appointment.id, kind: 'new_booking',
        });
        const response = { appointment };
        await tx.update(idempotencyKeys).set({ response }).where(eq(idempotencyKeys.id, existing.id));
        return response;
      });
      await this.bumpAvailabilityCache(practiceId);
      return response;
    } catch (error) {
      if (this.isUniqueViolation(error) || this.isExclusionViolation(error)) throw new ConflictException('That time was just booked. Please choose another slot');
      throw error;
    }
  }

  private async publicContext(practiceId: string, serviceId: string) {
    const [practice] = await this.db.select().from(practices).where(and(eq(practices.id, practiceId), eq(practices.active, true), eq(practices.publicBookingEnabled, true))).limit(1);
    if (!practice) throw new NotFoundException('Practice does not accept online bookings');
    const [service] = await this.db.select().from(services).where(and(eq(services.id, serviceId), eq(services.practiceId, practiceId), eq(services.active, true), eq(services.onlineBookable, true))).limit(1);
    if (!service) throw new NotFoundException('Service is not bookable');
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, practiceId)).limit(1);
    if (!policy) throw new NotFoundException('Booking policy is not configured');
    return { practice, service, policy };
  }

  private async internalAvailabilityContext(practiceId: string, serviceId: string) {
    const [practice] = await this.db.select().from(practices).where(and(eq(practices.id, practiceId), eq(practices.active, true))).limit(1);
    if (!practice) throw new NotFoundException('Practice not found');
    const [service] = await this.db.select().from(services).where(and(eq(services.id, serviceId), eq(services.practiceId, practiceId), eq(services.active, true))).limit(1);
    if (!service) throw new NotFoundException('Active service not found');
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, practiceId)).limit(1);
    if (!policy) throw new NotFoundException('Booking policy is not configured');
    return { practice, service, policy };
  }

  private validateDateRange(from: string, to: string, timezone: string, horizon: number): void {
    const today = localNowDate(timezone);
    if (from < today || to < from || to > addLocalDays(today, horizon) || to > addLocalDays(from, 30)) {
      throw new BadRequestException('Choose future dates within the booking horizon. A single availability request can cover up to 31 days.');
    }
  }

  private windowsFor(rules: Array<typeof availabilityRules.$inferSelect>, scope: string, owner: string | undefined, weekday: number, practiceId: string, locationId?: string, professionId?: string): Window[] {
    return rules.filter((rule) => rule.practiceId === practiceId && rule.scope === scope && rule.weekday === weekday && rule.active &&
      (scope === 'practice' ? true : scope === 'location' ? rule.locationId === owner : rule.professionalUserId === owner) &&
      (scope === 'professional_location' ? rule.locationId === locationId && rule.practiceProfessionId === professionId :
        scope === 'professional' ? rule.practiceProfessionId === professionId : true))
      .map((rule) => ({ startMinute: rule.startMinute, endMinute: rule.endMinute, slotIntervalMinutes: rule.slotIntervalMinutes }));
  }

  private overlapsMinutes(start: number, end: number, exception: typeof availabilityExceptions.$inferSelect): boolean {
    if (exception.startMinute === null || exception.endMinute === null) return true;
    return start < exception.endMinute && end > exception.startMinute;
  }

  private async findOrCreateAccountClient(tx: Database, practiceId: string, customer: { userId: string; fullName: string; email: string; phone: string | null }) {
    const [existing] = await tx.select().from(clients)
      .where(and(eq(clients.practiceId, practiceId), eq(clients.userId, customer.userId))).limit(1);
    if (existing) {
      const [updated] = await tx.update(clients).set({ fullName: customer.fullName, email: customer.email, phone: customer.phone, updatedAt: new Date() })
        .where(eq(clients.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tx.insert(clients).values({
      practiceId, userId: customer.userId, fullName: customer.fullName, email: customer.email, phone: customer.phone,
    }).returning();
    return created;
  }

  private isUniqueViolation(error: unknown): boolean { return this.errorCode(error) === '23505'; }
  private isExclusionViolation(error: unknown): boolean { return this.errorCode(error) === '23P01'; }
  private errorCode(error: unknown): string | undefined { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined; }
}

function neCancelled() { return sql`${appointments.status} <> 'cancelled'::appointment_status`; }

function localDateFromInstant(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
