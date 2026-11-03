import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, inArray, lte, or } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { auditEvents, bookingWaitlist, locations, practices, services } from '@ayushman-v2/db/schema';
import type { BookingWaitlistInput, BookingWaitlistOfferInput, BookingWaitlistStatusInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BookingService } from './booking.service.js';
import { addLocalDays, localNowDate } from './time.js';

@Injectable()
export class WaitlistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authorization: AuthorizationService,
    private readonly booking: BookingService,
  ) {}

  async join(practiceId: string, input: BookingWaitlistInput) {
    const directory = await this.booking.publicPractice(practiceId);
    const today = localNowDate(directory.practice.timezone);
    if (input.requestedDate <= today || input.requestedDate > addLocalDays(today, 30)) {
      throw new BadRequestException('Choose a date within the next 30 days');
    }
    const service = directory.services.find((item) => item.id === input.serviceId);
    if (!service) throw new NotFoundException('This service is not currently open for online bookings');
    if (!service.locations.some((location) => location.id === input.locationId)) {
      throw new BadRequestException('This service is not available at the selected location');
    }
    if (input.preferredProfessionalUserId && !service.locations.find((location) => location.id === input.locationId)?.professionals?.some((person) => person.id === input.preferredProfessionalUserId)) {
      throw new BadRequestException('Choose a professional who can provide this service at the selected location');
    }
    const email = input.email?.trim().toLowerCase() || null;
    const phone = input.phone?.trim() || null;
    const manageToken = randomBytes(32).toString('base64url');
    const manageTokenHash = this.hashToken(manageToken);
    const [existing] = await this.db.select({ id: bookingWaitlist.id }).from(bookingWaitlist).where(and(
      eq(bookingWaitlist.practiceId, practiceId), eq(bookingWaitlist.serviceId, input.serviceId),
      eq(bookingWaitlist.locationId, input.locationId), eq(bookingWaitlist.requestedDate, input.requestedDate),
      inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered', 'accepting']),
      or(email ? eq(bookingWaitlist.email, email) : undefined, phone ? eq(bookingWaitlist.phone, phone) : undefined)!,
    )).limit(1);
    if (existing) return { id: existing.id, alreadyWaiting: true };
    const [entry] = await this.db.insert(bookingWaitlist).values({
      practiceId, serviceId: input.serviceId, locationId: input.locationId,
      preferredProfessionalUserId: input.preferredProfessionalUserId ?? null,
      fullName: input.fullName, email, phone, requestedDate: input.requestedDate, manageTokenHash,
    }).onConflictDoNothing().returning({ id: bookingWaitlist.id });
    if (entry) return { id: entry.id, alreadyWaiting: false, manageToken };

    // The partial unique indexes are the final guard when two browser requests
    // race past the lookup above. Return the original request instead of
    // creating duplicates; if another constraint caused the conflict, fail
    // clearly rather than claiming a request was saved.
    const [racedDuplicate] = await this.db.select({ id: bookingWaitlist.id }).from(bookingWaitlist).where(and(
      eq(bookingWaitlist.practiceId, practiceId), eq(bookingWaitlist.serviceId, input.serviceId),
      eq(bookingWaitlist.locationId, input.locationId), eq(bookingWaitlist.requestedDate, input.requestedDate),
      inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered', 'accepting']),
      or(email ? eq(bookingWaitlist.email, email) : undefined, phone ? eq(bookingWaitlist.phone, phone) : undefined)!,
    )).limit(1);
    if (!racedDuplicate) throw new ConflictException('This waitlist request could not be saved. Please try again.');
    return { id: racedDuplicate.id, alreadyWaiting: true };
  }

  async list(userId: string, practiceId: string, locationId?: string) {
    // Waitlist entries contain customer contact details. Require the broad read
    // grant; an own-records grant cannot authorize an unscoped queue query.
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId });
    await this.expireOffers(practiceId);
    const query = this.db.select({
      id: bookingWaitlist.id, serviceId: bookingWaitlist.serviceId, serviceName: services.name,
      locationId: bookingWaitlist.locationId, locationName: locations.name,
      preferredProfessionalUserId: bookingWaitlist.preferredProfessionalUserId,
      fullName: bookingWaitlist.fullName, email: bookingWaitlist.email, phone: bookingWaitlist.phone,
      requestedDate: bookingWaitlist.requestedDate, status: bookingWaitlist.status,
      offeredProfessionalUserId: bookingWaitlist.offeredProfessionalUserId,
      offeredStartsAt: bookingWaitlist.offeredStartsAt, offerExpiresAt: bookingWaitlist.offerExpiresAt,
      createdAt: bookingWaitlist.createdAt,
    }).from(bookingWaitlist).innerJoin(services, eq(services.id, bookingWaitlist.serviceId))
      .innerJoin(locations, eq(locations.id, bookingWaitlist.locationId))
      .where(and(eq(bookingWaitlist.practiceId, practiceId), ...(locationId ? [eq(bookingWaitlist.locationId, locationId)] : [])))
      .orderBy(asc(bookingWaitlist.requestedDate), asc(bookingWaitlist.createdAt));
    return query;
  }

  async updateStatus(userId: string, practiceId: string, entryId: string, input: BookingWaitlistStatusInput) {
    const [entry] = await this.db.select({ locationId: bookingWaitlist.locationId }).from(bookingWaitlist)
      .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId))).limit(1);
    if (!entry) throw new NotFoundException('Waitlist request not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: entry.locationId });
    const [updated] = await this.db.update(bookingWaitlist).set({ status: input.status, offeredStartsAt: null, offerExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId), inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered'])))
      .returning({ id: bookingWaitlist.id, status: bookingWaitlist.status });
    if (!updated) {
      const [current] = await this.db.select({ id: bookingWaitlist.id, status: bookingWaitlist.status }).from(bookingWaitlist)
        .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId))).limit(1);
      if (!current) throw new NotFoundException('Waitlist request not found');
      return current;
    }
    return updated;
  }

  async createManageLink(userId: string, practiceId: string, entryId: string) {
    const [entry] = await this.db.select({ locationId: bookingWaitlist.locationId, status: bookingWaitlist.status }).from(bookingWaitlist)
      .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId))).limit(1);
    if (!entry) throw new NotFoundException('Waitlist request not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: entry.locationId });
    if (!['waiting', 'contacted', 'offered'].includes(entry.status)) throw new ConflictException('This waitlist request is no longer active');
    const token = randomBytes(32).toString('base64url');
    await this.db.transaction(async (tx) => {
      const [rotated] = await tx.update(bookingWaitlist).set({ manageTokenHash: this.hashToken(token), updatedAt: new Date() })
        .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId), inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered'])))
        .returning({ id: bookingWaitlist.id });
      if (!rotated) throw new ConflictException('The waitlist request changed. Reload the queue and try again.');
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'waitlist.manage_link_rotated', entityType: 'booking_waitlist', entityId: entryId, metadata: { previousStatus: entry.status } });
      return rotated;
    });
    return { token };
  }

  async offer(userId: string, practiceId: string, entryId: string, input: BookingWaitlistOfferInput) {
    const [entry] = await this.db.select().from(bookingWaitlist)
      .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId))).limit(1);
    if (!entry) throw new NotFoundException('Waitlist request not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: entry.locationId });
    await this.expireOffers(practiceId);
    if (!['waiting', 'contacted', 'offered'].includes(entry.status)) throw new ConflictException('This waitlist request is no longer active');
    const [practice] = await this.db.select({ timezone: practices.timezone }).from(practices).where(eq(practices.id, practiceId)).limit(1);
    if (!practice) throw new NotFoundException('Practice not found');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: practice.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(input.startsAt));
    if (date !== entry.requestedDate) throw new BadRequestException('Choose an opening on the date the customer requested');
    if (entry.preferredProfessionalUserId && entry.preferredProfessionalUserId !== input.professionalUserId) throw new BadRequestException('This customer requested a specific professional');
    const availability = await this.booking.availableSlots(practiceId, { serviceId: entry.serviceId, locationId: entry.locationId, professionalUserId: input.professionalUserId, from: date, to: date }, true);
    const proposedAt = new Date(input.startsAt);
    if (!availability.slots.some((slot) => slot.professional.id === input.professionalUserId && slot.startsAt === proposedAt.toISOString())) throw new ConflictException('That opening is no longer available. Refresh the schedule and choose another time.');
    const now = new Date();
    const [updated] = await this.db.update(bookingWaitlist).set({ status: 'offered', offeredProfessionalUserId: input.professionalUserId, offeredStartsAt: proposedAt, offerExpiresAt: new Date(now.getTime() + input.expiresInHours * 60 * 60_000), updatedAt: now })
      .where(and(eq(bookingWaitlist.id, entryId), eq(bookingWaitlist.practiceId, practiceId), inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered'])))
      .returning({ id: bookingWaitlist.id, status: bookingWaitlist.status, offeredStartsAt: bookingWaitlist.offeredStartsAt, offerExpiresAt: bookingWaitlist.offerExpiresAt });
    if (!updated) throw new ConflictException('The waitlist request changed. Reload the queue.');
    return updated;
  }

  async publicDetails(token: string) {
    const [entry] = await this.db.select({ id: bookingWaitlist.id, practiceId: bookingWaitlist.practiceId, serviceName: services.name, locationName: locations.name, requestedDate: bookingWaitlist.requestedDate, status: bookingWaitlist.status, offeredStartsAt: bookingWaitlist.offeredStartsAt, offerExpiresAt: bookingWaitlist.offerExpiresAt })
      .from(bookingWaitlist).innerJoin(services, eq(services.id, bookingWaitlist.serviceId)).innerJoin(locations, eq(locations.id, bookingWaitlist.locationId))
      .where(eq(bookingWaitlist.manageTokenHash, this.hashToken(token))).limit(1);
    if (!entry) throw new NotFoundException('This waitlist link is invalid or has expired');
    await this.expireOffers(entry.practiceId);
    const [fresh] = await this.db.select({ status: bookingWaitlist.status, offeredStartsAt: bookingWaitlist.offeredStartsAt, offerExpiresAt: bookingWaitlist.offerExpiresAt }).from(bookingWaitlist).where(eq(bookingWaitlist.id, entry.id)).limit(1);
    return { serviceName: entry.serviceName, locationName: entry.locationName, requestedDate: entry.requestedDate, status: fresh.status, offeredStartsAt: fresh.offeredStartsAt, offerExpiresAt: fresh.offerExpiresAt };
  }

  async withdraw(token: string) {
    const [entry] = await this.db.update(bookingWaitlist).set({ status: 'withdrawn', offeredStartsAt: null, offerExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(bookingWaitlist.manageTokenHash, this.hashToken(token)), inArray(bookingWaitlist.status, ['waiting', 'contacted', 'offered'])))
      .returning({ id: bookingWaitlist.id });
    if (!entry) {
      const [existing] = await this.db.select({ status: bookingWaitlist.status }).from(bookingWaitlist).where(eq(bookingWaitlist.manageTokenHash, this.hashToken(token))).limit(1);
      if (!existing) throw new NotFoundException('This waitlist link is invalid or has expired');
      return { withdrawn: existing.status === 'withdrawn' };
    }
    return { withdrawn: true };
  }

  async acceptOffer(token: string) {
    const [entry] = await this.db.select().from(bookingWaitlist).where(eq(bookingWaitlist.manageTokenHash, this.hashToken(token))).limit(1);
    if (!entry) throw new NotFoundException('This waitlist link is invalid or has expired');
    await this.expireOffers(entry.practiceId);
    if (!entry.offeredStartsAt || !entry.offerExpiresAt || !entry.offeredProfessionalUserId) throw new ConflictException('There is no active time offer for this request');
    const now = new Date();
    const [claimed] = await this.db.update(bookingWaitlist).set({ status: 'accepting', updatedAt: now })
      .where(and(eq(bookingWaitlist.id, entry.id), eq(bookingWaitlist.status, 'offered'), gt(bookingWaitlist.offerExpiresAt, now)))
      .returning({ id: bookingWaitlist.id });
    if (!claimed) throw new ConflictException('This offer is no longer active. Refresh the page for its current status.');
    const key = `waitlist-${entry.id}`;
    try {
      const result = await this.booking.createGuestPublicBooking(entry.practiceId, key, {
        serviceId: entry.serviceId, locationId: entry.locationId, professionalUserId: entry.offeredProfessionalUserId,
        startsAt: entry.offeredStartsAt.toISOString(), fullName: entry.fullName,
        ...(entry.email ? { email: entry.email } : {}), ...(entry.phone ? { phone: entry.phone } : {}),
      });
      await this.db.update(bookingWaitlist).set({ status: 'booked', offeredStartsAt: null, offerExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(bookingWaitlist.id, entry.id), eq(bookingWaitlist.status, 'accepting')));
      return result;
    } catch (error) {
      const retryAt = new Date();
      await this.db.update(bookingWaitlist).set({ status: 'offered', updatedAt: retryAt })
        .where(and(eq(bookingWaitlist.id, entry.id), eq(bookingWaitlist.status, 'accepting'), gt(bookingWaitlist.offerExpiresAt, retryAt)));
      await this.expireOffers(entry.practiceId);
      throw error;
    }
  }

  private async expireOffers(practiceId: string) {
    await this.db.update(bookingWaitlist).set({ status: 'expired', offeredStartsAt: null, offerExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(bookingWaitlist.practiceId, practiceId), inArray(bookingWaitlist.status, ['offered', 'accepting']), lte(bookingWaitlist.offerExpiresAt, new Date())));
  }

  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
