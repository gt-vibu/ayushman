import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, appointmentEvents, appointmentNotifications, auditEvents, bookingPolicies, clients, clientDocuments, customerProfiles, idempotencyKeys, invoices, locations, practices, practiceMembershipRoles, practiceMemberships, serviceLocations, serviceProfessionals, services, sessionRecordings, users } from '@ayushman-v2/db/schema';
import type { AppointmentListQuery, AppointmentPaymentInput, AppointmentStatusInput, AppointmentStatusCorrectionInput, AppointmentServiceChangeInput, AppointmentReassignmentInput, BulkAppointmentRescheduleInput, BulkRescheduleOptionsInput, ClientAccountLinkInput, ClientListQuery, ClientMergeInput, CreateClientInput, CreateFollowUpInput, ManualAppointmentInput, PublicAvailabilityQuery, UpdateClientInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BookingService } from './booking.service.js';

const permissionByStatus = {
  confirmed: 'appointments.update',
  checked_in: 'appointments.check_in',
  in_progress: 'appointments.complete',
  completed: 'appointments.complete',
  interrupted: 'appointments.complete',
  no_show: 'appointments.mark_no_show',
  cancelled: 'appointments.cancel',
  pending: 'appointments.update',
} as const;

@Injectable()
export class AppointmentManagementService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService, private readonly booking: BookingService) {}

  async listNotifications(userId: string, practiceId: string, locationId?: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId, ownRecordsAreQueryScoped: true });
    const scope = locationId ? eq(appointments.locationId, locationId) : undefined;
    const [items, [{ unreadCount }]] = await Promise.all([
      this.db.select({
        id: appointmentNotifications.id, appointmentId: appointments.id, kind: appointmentNotifications.kind,
        readAt: appointmentNotifications.readAt, createdAt: appointmentNotifications.createdAt,
        startsAt: appointments.startsAt, timezone: appointments.timezone, status: appointments.status,
        serviceName: appointments.serviceNameSnapshot, customerName: clients.fullName, locationName: locations.name,
      }).from(appointmentNotifications)
        .innerJoin(appointments, eq(appointments.id, appointmentNotifications.appointmentId))
        .innerJoin(clients, eq(clients.id, appointments.clientId))
        .innerJoin(locations, eq(locations.id, appointments.locationId))
        .where(and(eq(appointmentNotifications.practiceId, practiceId), eq(appointmentNotifications.recipientUserId, userId), scope))
        .orderBy(desc(appointmentNotifications.createdAt)).limit(20),
      this.db.select({ unreadCount: count() }).from(appointmentNotifications)
        .innerJoin(appointments, eq(appointments.id, appointmentNotifications.appointmentId))
        .where(and(eq(appointmentNotifications.practiceId, practiceId), eq(appointmentNotifications.recipientUserId, userId), isNull(appointmentNotifications.readAt), scope)),
    ]);
    return { items, unreadCount };
  }

  async markNotificationRead(userId: string, practiceId: string, notificationId: string) {
    const [notification] = await this.db.select({ id: appointmentNotifications.id, locationId: appointments.locationId, professionalUserId: appointments.professionalUserId })
      .from(appointmentNotifications).innerJoin(appointments, eq(appointments.id, appointmentNotifications.appointmentId))
      .where(and(eq(appointmentNotifications.id, notificationId), eq(appointmentNotifications.practiceId, practiceId), eq(appointmentNotifications.recipientUserId, userId))).limit(1);
    if (!notification) throw new NotFoundException('Notification not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId: notification.locationId, resourceOwnerUserId: notification.professionalUserId });
    const [updated] = await this.db.update(appointmentNotifications).set({ readAt: new Date() })
      .where(and(eq(appointmentNotifications.id, notificationId), eq(appointmentNotifications.recipientUserId, userId), isNull(appointmentNotifications.readAt))).returning({ id: appointmentNotifications.id });
    return { read: Boolean(updated) };
  }

  async createFollowUp(userId: string, practiceId: string, input: CreateFollowUpInput, idempotencyKey?: string) {
    const check = { userId, practiceId, permissionCode: 'appointments.create', locationId: input.locationId, resourceOwnerUserId: input.professionalUserId } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    if (ownScope && input.professionalUserId !== userId) throw new ForbiddenException('You can only schedule follow-ups with your own clients');
    const requestHash = createHash('sha256').update(`follow_up:${JSON.stringify(input)}`).digest('hex');
    const replay = await this.replayIdempotency<{ appointment: typeof appointments.$inferSelect }>(practiceId, idempotencyKey, requestHash);
    if (replay) return replay;

    const [[client], [sourceAppointment], [service], [practice]] = await Promise.all([
      this.db.select({ id: clients.id, userId: clients.userId }).from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.practiceId, practiceId))).limit(1),
      this.db.select({ id: appointments.id, clientId: appointments.clientId, status: appointments.status, locationId: appointments.locationId, professionalUserId: appointments.professionalUserId, practiceProfessionId: appointments.practiceProfessionId }).from(appointments)
        .where(and(eq(appointments.id, input.sourceAppointmentId), eq(appointments.practiceId, practiceId))).limit(1),
      this.db.select({ id: services.id, practiceProfessionId: services.practiceProfessionId, name: services.name, durationMinutes: services.durationMinutes, bufferBeforeMinutes: services.bufferBeforeMinutes, bufferAfterMinutes: services.bufferAfterMinutes, priceMinor: services.priceMinor, currency: services.currency })
        .from(services).innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.active, true)))
        .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.active, true)))
        .where(and(eq(services.id, input.serviceId), eq(services.practiceId, practiceId), eq(services.active, true), eq(serviceProfessionals.professionalUserId, input.professionalUserId), eq(serviceLocations.locationId, input.locationId))).limit(1),
      this.db.select({ timezone: practices.timezone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
    ]);
    if (!client) throw new NotFoundException('Customer record not found in this practice');
    if (!sourceAppointment || sourceAppointment.clientId !== client.id) throw new BadRequestException('A follow-up must be linked to an appointment for the same customer');
    if (!service) throw new BadRequestException('Choose a service assigned to this professional and branch');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId: sourceAppointment.locationId, resourceOwnerUserId: sourceAppointment.professionalUserId });
    if (sourceAppointment.professionalUserId !== input.professionalUserId) throw new BadRequestException('Schedule the follow-up with the professional from the original appointment');
    if (sourceAppointment.practiceProfessionId !== service.practiceProfessionId) throw new BadRequestException('Choose a service in the same profession as the original appointment');
    if (!['checked_in', 'in_progress', 'completed', 'interrupted'].includes(sourceAppointment.status)) throw new BadRequestException('A follow-up can be scheduled when the original visit has started or finished');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: practice?.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(input.startsAt));
    const available = await this.booking.availableSlots(practiceId, { serviceId: service.id, locationId: input.locationId, professionalUserId: input.professionalUserId, from: date, to: date }, true, true);
    const requestedStart = new Date(input.startsAt).toISOString();
    const slot = available.slots.find((candidate) => candidate.startsAt === requestedStart && candidate.professional.id === input.professionalUserId);
    if (!slot) throw new ConflictException('That follow-up time is no longer available. Choose another slot.');

    try {
      return await this.db.transaction(async (tx) => {
        const requestHash = createHash('sha256').update(`follow_up:${JSON.stringify(input)}`).digest('hex');
        const existing = await this.resolveIdempotency(tx, practiceId, idempotencyKey, requestHash);
        if (existing) return existing as { appointment: typeof appointments.$inferSelect };
        const [appointment] = await tx.insert(appointments).values({
          practiceId, practiceProfessionId: service.practiceProfessionId, locationId: input.locationId,
          serviceId: service.id, professionalUserId: input.professionalUserId, clientId: client.id, createdByUserId: userId,
          followUpToAppointmentId: sourceAppointment.id,
          startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt),
          reservedStartsAt: new Date(new Date(slot.startsAt).getTime() - service.bufferBeforeMinutes * 60_000),
          reservedEndsAt: new Date(new Date(slot.endsAt).getTime() + service.bufferAfterMinutes * 60_000),
          timezone: available.timezone, serviceNameSnapshot: service.name, durationMinutesSnapshot: service.durationMinutes,
          bufferBeforeMinutesSnapshot: service.bufferBeforeMinutes, bufferAfterMinutesSnapshot: service.bufferAfterMinutes,
          priceMinorSnapshot: service.priceMinor, currencySnapshot: service.currency, status: 'confirmed', clientNote: input.note,
        }).returning();
        await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'appointment.follow_up_booked', entityType: 'appointment', entityId: appointment.id, metadata: { clientId: client.id, serviceId: service.id, locationId: input.locationId, sourceAppointmentId: sourceAppointment.id } });
        const response = { appointment };
        await this.saveIdempotency(tx, practiceId, idempotencyKey, requestHash, response);
        return response;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('That follow-up time was just booked. Choose another slot');
      throw error;
    }
  }

  async linkExistingFollowUp(userId: string, practiceId: string, appointmentId: string, sourceAppointmentId: string) {
    const [followUp] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!followUp) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: followUp.locationId, resourceOwnerUserId: followUp.professionalUserId });
    if (!['pending', 'confirmed'].includes(followUp.status) || followUp.startsAt <= new Date()) {
      throw new BadRequestException('Only a future appointment can be linked as a follow-up');
    }
    if (followUp.followUpToAppointmentId) throw new ConflictException('This appointment is already linked to a previous visit');
    const [source] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, sourceAppointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!source) throw new NotFoundException('The previous visit was not found in this practice');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId: source.locationId, resourceOwnerUserId: source.professionalUserId });
    if (source.id === followUp.id || source.clientId !== followUp.clientId || source.professionalUserId !== followUp.professionalUserId || source.practiceProfessionId !== followUp.practiceProfessionId) {
      throw new BadRequestException('A follow-up must belong to the same customer, practitioner, and profession as the previous visit');
    }
    if (!['checked_in', 'in_progress', 'completed', 'interrupted'].includes(source.status) || source.startsAt >= followUp.startsAt) {
      throw new BadRequestException('Choose an earlier visit that has started or finished');
    }
    const [updated] = await this.db.transaction(async (tx) => {
      const result = await tx.update(appointments).set({ followUpToAppointmentId: source.id, updatedAt: new Date() })
        .where(and(eq(appointments.id, followUp.id), isNull(appointments.followUpToAppointmentId), eq(appointments.status, followUp.status), eq(appointments.startsAt, followUp.startsAt)))
        .returning();
      if (!result.length) throw new ConflictException('This appointment changed while you were linking it. Refresh and try again');
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'appointment.follow_up_linked', entityType: 'appointment', entityId: followUp.id, metadata: { sourceAppointmentId: source.id } });
      return result;
    });
    return updated;
  }

  async followUpSources(userId: string, practiceId: string, appointmentId: string) {
    const [followUp] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!followUp) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: followUp.locationId, resourceOwnerUserId: followUp.professionalUserId });
    if (!['pending', 'confirmed'].includes(followUp.status) || followUp.startsAt <= new Date() || followUp.followUpToAppointmentId) return [];
    return this.db.select({ id: appointments.id, serviceName: appointments.serviceNameSnapshot, startsAt: appointments.startsAt, timezone: appointments.timezone })
      .from(appointments).where(and(
        eq(appointments.practiceId, practiceId), eq(appointments.clientId, followUp.clientId),
        eq(appointments.professionalUserId, followUp.professionalUserId),
        eq(appointments.practiceProfessionId, followUp.practiceProfessionId),
        inArray(appointments.status, ['checked_in', 'in_progress', 'completed', 'interrupted']),
        lte(appointments.startsAt, new Date(followUp.startsAt.getTime() - 1)),
        isNull(appointments.holdExpiresAt),
      )).orderBy(desc(appointments.startsAt)).limit(50);
  }

  async followUpAvailability(userId: string, practiceId: string, query: PublicAvailabilityQuery) {
    if (!query.professionalUserId) throw new BadRequestException('Choose the professional for this follow-up');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.create', locationId: query.locationId, resourceOwnerUserId: query.professionalUserId });
    return this.booking.availableSlots(practiceId, query, true, true);
  }

  async list(userId: string, practiceId: string, query: AppointmentListQuery) {
    const locationId = query.locationId;
    if (locationId) {
      const [location] = await this.db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.practiceId, practiceId))).limit(1);
      if (!location) throw new NotFoundException('Branch not found in this practice');
    }
    const [appointmentPermission, clientPermission] = await Promise.all([
      this.authorization.resolvePermission({
        userId, practiceId, permissionCode: 'appointments.read', locationId,
        ownRecordsAreQueryScoped: true,
      }),
      this.authorization.resolvePermission({
        userId, practiceId, permissionCode: 'clients.read', locationId,
        ownRecordsAreQueryScoped: true,
      }),
    ]);
    if (!appointmentPermission.allowed) throw new ForbiddenException('Missing permission: appointments.read');
    const filters = [eq(appointments.practiceId, practiceId), ne(appointments.status, 'held'), isNull(appointments.holdExpiresAt)];
    if (locationId) filters.push(eq(appointments.locationId, locationId));
    if (query.from) filters.push(gte(appointments.startsAt, new Date(query.from)));
    if (query.to) filters.push(lte(appointments.startsAt, new Date(query.to)));
    if (query.status) filters.push(eq(appointments.status, query.status));
    if (query.clientId) {
      await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'clients.read', locationId, ownRecordsAreQueryScoped: true });
      filters.push(eq(appointments.clientId, query.clientId));
    }
    if (appointmentPermission.ownScoped || clientPermission.ownScoped) {
      filters.push(eq(appointments.professionalUserId, userId));
    }
    const rows = await this.db.select({
      id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status,
      actualArrivedAt: appointments.actualArrivedAt, actualStartedAt: appointments.actualStartedAt, actualEndedAt: appointments.actualEndedAt,
      locationId: appointments.locationId, professionalUserId: appointments.professionalUserId,
      serviceName: appointments.serviceNameSnapshot, clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      followUpToAppointmentId: appointments.followUpToAppointmentId,
      isFollowUp: sql<boolean>`(${appointments.followUpToAppointmentId} is not null or exists (select 1 from audit_events follow_up_event where follow_up_event.practice_id = ${practiceId} and follow_up_event.entity_type = 'appointment' and follow_up_event.entity_id = ${appointments.id} and follow_up_event.action in ('appointment.follow_up_booked', 'appointment.follow_up_linked')))`,
      followUpSource: sql<{ id: string; serviceName: string; startsAt: Date; timezone: string } | null>`(select json_build_object('id', follow_up_source.id, 'serviceName', follow_up_source.service_name_snapshot, 'startsAt', follow_up_source.starts_at, 'timezone', follow_up_source.timezone) from appointments follow_up_source where follow_up_source.id = ${appointments.followUpToAppointmentId} and follow_up_source.practice_id = ${practiceId})`,
      hasFollowUp: sql<boolean>`exists (select 1 from appointments as follow_up_child where follow_up_child.follow_up_to_appointment_id = ${appointments.id} and follow_up_child.practice_id = ${practiceId})`,
      nextFollowUpStartsAt: sql<Date | null>`(select min(follow_up_child.starts_at) from appointments as follow_up_child where follow_up_child.follow_up_to_appointment_id = ${appointments.id} and follow_up_child.practice_id = ${practiceId} and follow_up_child.status not in ('cancelled', 'no_show'))`,
      clientName: clients.fullName, clientEmail: clients.email, clientPhone: clients.phone,
      clientNote: appointments.clientNote, practitionerNote: appointments.practitionerNote, timezone: appointments.timezone,
      isWalkIn: appointments.isWalkIn, visitDescription: appointments.visitDescription,
      priceMinor: appointments.priceMinorSnapshot, currency: appointments.currencySnapshot,
      amountPaidMinor: appointments.amountPaidMinor, paymentMethod: appointments.paymentMethod,
    }).from(appointments).innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(...filters)).orderBy(asc(appointments.startsAt)).limit(query.limit);
    if (clientPermission.allowed) return rows;
    return rows.map((row) => ({
      id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, status: row.status,
      actualArrivedAt: row.actualArrivedAt, actualStartedAt: row.actualStartedAt, actualEndedAt: row.actualEndedAt,
      locationId: row.locationId, professionalUserId: row.professionalUserId,
      serviceName: row.serviceName, clientId: row.clientId, serviceId: row.serviceId,
      followUpToAppointmentId: row.followUpToAppointmentId, isFollowUp: row.isFollowUp,
      followUpSource: row.followUpSource, hasFollowUp: row.hasFollowUp, nextFollowUpStartsAt: row.nextFollowUpStartsAt,
      clientName: row.clientName, clientNote: row.clientNote, practitionerNote: row.practitionerNote,
      timezone: row.timezone, isWalkIn: row.isWalkIn, visitDescription: row.visitDescription,
      priceMinor: row.priceMinor, currency: row.currency, amountPaidMinor: row.amountPaidMinor, paymentMethod: row.paymentMethod,
    }));
  }

  async listClients(userId: string, practiceId: string, query: ClientListQuery) {
    const check = { userId, practiceId, permissionCode: 'clients.read', locationId: query.locationId, ownRecordsAreQueryScoped: true } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    const filters = [eq(clients.practiceId, practiceId), isNull(clients.mergedIntoClientId)];
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(sql`${clients.fullName} ILIKE ${pattern}`, sql`COALESCE(${clients.email}, '') ILIKE ${pattern}`, sql`COALESCE(${clients.phone}, '') ILIKE ${pattern}`)!);
    }
    if (query.locationId) filters.push(sql`(exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.location_id = ${query.locationId}::uuid) or (${clients.createdByUserId} = ${userId}::uuid and not exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid)))`);
    filters.push(ownScope
      ? sql`(exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.hold_expires_at is null and a.professional_user_id = ${userId}::uuid) or ${clients.createdByUserId} = ${userId}::uuid)`
      : sql`(exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.hold_expires_at is null) or ${clients.createdByUserId} IS NOT NULL)`);
    return this.db.select({
      id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone,
      hasPortalAccount: sql<boolean>`${clients.userId} IS NOT NULL`, createdAt: clients.createdAt, updatedAt: clients.updatedAt,
    }).from(clients).where(and(...filters)).orderBy(asc(clients.fullName)).limit(query.limit);
  }

  async createClient(userId: string, practiceId: string, input: CreateClientInput) {
    if (input.locationId) {
      const [location] = await this.db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.id, input.locationId), eq(locations.practiceId, practiceId), eq(locations.active, true))).limit(1);
      if (!location) throw new NotFoundException('Branch not found in this practice');
    }
    const check = { userId, practiceId, permissionCode: 'clients.create', locationId: input.locationId, ownRecordsAreQueryScoped: true } as const;
    await this.authorization.assertPermission(check);
    const email = input.email?.trim().toLocaleLowerCase('en-US') ?? null;
    const phone = input.phone ?? null;
    const matches = await this.db.select({ id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone })
      .from(clients).where(and(eq(clients.practiceId, practiceId), isNull(clients.mergedIntoClientId), or(
        email ? sql`lower(${clients.email}) = ${email} and lower(${clients.fullName}) = ${input.fullName.toLocaleLowerCase('en-US')}` : sql`false`,
        phone ? sql`${clients.phone} = ${phone} and lower(${clients.fullName}) = ${input.fullName.toLocaleLowerCase('en-US')}` : sql`false`,
      )!)).limit(5);
    if (matches.length) throw new ConflictException({ message: 'A client with the same name and contact details may already exist. Search the directory and select the existing record if this is the same person.', possibleMatches: matches });
    const [created] = await this.db.insert(clients).values({ practiceId, fullName: input.fullName, email, phone, createdByUserId: userId }).returning();
    return created;
  }

  async updateClient(userId: string, practiceId: string, clientId: string, input: UpdateClientInput) {
    if (input.locationId) {
      const [location] = await this.db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.id, input.locationId), eq(locations.practiceId, practiceId), eq(locations.active, true))).limit(1);
      if (!location) throw new NotFoundException('Branch not found in this practice');
    }
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'clients.update', locationId: input.locationId });
    const [existing] = await this.db.select({ id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone, userId: clients.userId, mergedIntoClientId: clients.mergedIntoClientId })
      .from(clients).where(and(eq(clients.id, clientId), eq(clients.practiceId, practiceId))).limit(1);
    if (!existing) throw new NotFoundException('Client not found in this practice');
    if (existing.mergedIntoClientId) throw new ConflictException('This record was merged. Open the surviving client record to make changes.');
    const email = input.email?.trim().toLocaleLowerCase('en-US') || null;
    const phone = input.phone || null;
    const possibleDuplicate = await this.db.select({ id: clients.id }).from(clients).where(and(
      eq(clients.practiceId, practiceId), ne(clients.id, clientId), isNull(clients.mergedIntoClientId),
      or(
        email ? sql`lower(${clients.email}) = ${email} and lower(${clients.fullName}) = ${input.fullName.toLocaleLowerCase('en-US')}` : sql`false`,
        phone ? sql`${clients.phone} = ${phone} and lower(${clients.fullName}) = ${input.fullName.toLocaleLowerCase('en-US')}` : sql`false`,
      )!,
    )).limit(1);
    if (possibleDuplicate.length) throw new ConflictException('Another client with the same name and contact details exists. Review the directory before saving.');
    const [updated] = await this.db.update(clients).set({ fullName: input.fullName, email, phone, updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.practiceId, practiceId))).returning();
    await this.db.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client.contact_updated', entityType: 'client', entityId: clientId, metadata: { linkedPortalAccountUnchanged: Boolean(existing.userId) } });
    return updated;
  }

  async mergeClient(userId: string, practiceId: string, sourceClientId: string, input: ClientMergeInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'clients.update' });
    const actorRoles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .innerJoin(practiceMemberships, eq(practiceMemberships.id, practiceMembershipRoles.membershipId))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active')));
    if (!actorRoles.some(({ role }) => role === 'owner')) throw new ForbiddenException('Only the practice owner can merge client histories');
    if (sourceClientId === input.targetClientId) throw new BadRequestException('Choose a different target client');
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(clients).where(and(eq(clients.practiceId, practiceId), inArray(clients.id, [sourceClientId, input.targetClientId]))).orderBy(asc(clients.id)).for('update');
      const source = rows.find((row) => row.id === sourceClientId);
      const target = rows.find((row) => row.id === input.targetClientId);
      if (!source || !target || rows.length !== 2) throw new NotFoundException('Both client records must belong to this practice');
      if (source.mergedIntoClientId) throw new ConflictException('This client record was already merged. Open the surviving client record instead.');
      if (target.mergedIntoClientId) throw new BadRequestException('Choose an active client record as the merge target');
      if (source.userId && target.userId && source.userId !== target.userId) throw new ConflictException('These records belong to different portal accounts and cannot be merged');
      const portalAccountMoved = Boolean(source.userId && !target.userId);
      if (source.userId && !target.userId) {
        await tx.update(clients).set({ userId: null }).where(eq(clients.id, source.id));
        await tx.update(clients).set({ userId: source.userId }).where(eq(clients.id, target.id));
      }
      await tx.update(appointments).set({ clientId: target.id }).where(and(eq(appointments.practiceId, practiceId), eq(appointments.clientId, source.id)));
      await tx.update(clientDocuments).set({ clientId: target.id }).where(and(eq(clientDocuments.practiceId, practiceId), eq(clientDocuments.clientId, source.id)));
      await tx.update(sessionRecordings).set({ clientId: target.id }).where(and(eq(sessionRecordings.practiceId, practiceId), eq(sessionRecordings.clientId, source.id)));
      await tx.update(invoices).set({ clientId: target.id }).where(and(eq(invoices.practiceId, practiceId), eq(invoices.clientId, source.id)));
      const [merged] = await tx.update(clients).set({ mergedIntoClientId: target.id, mergedAt: new Date(), mergedByUserId: userId, updatedAt: new Date() })
        .where(and(eq(clients.id, source.id), eq(clients.practiceId, practiceId), isNull(clients.mergedIntoClientId))).returning();
      if (!merged) throw new ConflictException('This client record changed while the merge was being confirmed. Reload and review it again.');
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client.histories_merged', entityType: 'client', entityId: source.id, metadata: { targetClientId: target.id, reason: input.reason, portalAccountMoved } });
      return { mergedClientId: source.id, targetClientId: target.id };
    });
  }

  async linkClientAccount(userId: string, practiceId: string, clientId: string, input: ClientAccountLinkInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'clients.update' });
    const actorRoles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .innerJoin(practiceMemberships, eq(practiceMemberships.id, practiceMembershipRoles.membershipId))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active')));
    if (!actorRoles.some(({ role }) => role === 'owner')) throw new ForbiddenException('Only the practice owner can link a client to a portal account');
    const email = input.accountEmail.trim().toLocaleLowerCase('en-US');
    const [account] = await this.db.select({ id: users.id }).from(users)
      .innerJoin(customerProfiles, eq(customerProfiles.userId, users.id))
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt))).limit(1);
    if (!account) throw new NotFoundException('No active customer account was found with that email');
    return this.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.practiceId, practiceId), isNull(clients.mergedIntoClientId))).for('update');
      if (!client) throw new NotFoundException('Active client record not found in this practice');
      if (client.userId === account.id) return { clientId, linked: true, alreadyLinked: true };
      if (client.userId) throw new ConflictException('This client is already linked to a different customer account');
      const [existingLink] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.practiceId, practiceId), eq(clients.userId, account.id), isNull(clients.mergedIntoClientId))).limit(1);
      if (existingLink) throw new ConflictException('This customer already has a client record in the practice. Review the two records and merge the duplicate first.');
      const [updated] = await tx.update(clients).set({ userId: account.id, updatedAt: new Date() })
        .where(and(eq(clients.id, clientId), isNull(clients.userId), isNull(clients.mergedIntoClientId))).returning({ id: clients.id });
      if (!updated) throw new ConflictException('This client record changed while you were confirming the link. Reload and review it again.');
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client.portal_account_linked', entityType: 'client', entityId: clientId, metadata: { customerUserId: account.id, accountEmail: email, reason: input.reason, identityAndConsentVerified: input.identityAndConsentVerified } });
      return { clientId, linked: true, alreadyLinked: false };
    });
  }

  async createManualAppointment(userId: string, practiceId: string, input: ManualAppointmentInput, idempotencyKey?: string) {
    const permission = { userId, practiceId, permissionCode: 'appointments.create', locationId: input.locationId, resourceOwnerUserId: input.professionalUserId } as const;
    await this.authorization.assertPermission(permission);
    const ownScope = await this.authorization.requiresOwnScope(permission);
    if (ownScope && input.professionalUserId !== userId) throw new ForbiddenException('You can only create visits assigned to yourself');
    const requestHash = createHash('sha256').update(`manual_appointment:${JSON.stringify(input)}`).digest('hex');
    const replay = await this.replayIdempotency<typeof appointments.$inferSelect>(practiceId, idempotencyKey, requestHash);
    if (replay) return replay;
    const [[service], [practice]] = await Promise.all([
      this.db.select({ id: services.id, practiceProfessionId: services.practiceProfessionId, name: services.name, durationMinutes: services.durationMinutes, bufferBeforeMinutes: services.bufferBeforeMinutes, bufferAfterMinutes: services.bufferAfterMinutes, priceMinor: services.priceMinor, currency: services.currency })
        .from(services)
        .innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.active, true), eq(serviceProfessionals.professionalUserId, input.professionalUserId)))
        .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.active, true), eq(serviceLocations.locationId, input.locationId)))
        .where(and(eq(services.id, input.serviceId), eq(services.practiceId, practiceId), eq(services.active, true))).limit(1),
      this.db.select({ timezone: practices.timezone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
    ]);
    if (input.clientId) {
      const [client] = await this.db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.practiceId, practiceId), isNull(clients.mergedIntoClientId))).limit(1);
      if (!client) throw new NotFoundException('Client not found in this practice');
    } else if (input.newClient) {
      await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'clients.create', locationId: input.locationId });
    } else {
      throw new BadRequestException('Choose an existing client or enter a new client');
    }
    if (!service) throw new BadRequestException('Choose an active service assigned to this practitioner and location');
    const [location] = await this.db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, input.locationId), eq(locations.practiceId, practiceId), eq(locations.active, true))).limit(1);
    if (!location) throw new NotFoundException('Location not found in this practice');

    const duration = input.durationMinutes ?? service.durationMinutes;
    const price = input.priceMinor === undefined ? service.priceMinor : input.priceMinor;
    if (price !== null && input.amountPaidMinor > price) throw new BadRequestException('Amount received cannot exceed the visit rate');
    const startsAt = new Date(input.startsAt);
    let timezone = practice?.timezone ?? 'UTC';
    if (!input.historicalEntry) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
      const availability = await this.booking.availableSlots(practiceId, {
        serviceId: service.id, locationId: input.locationId, professionalUserId: input.professionalUserId, from: date, to: date,
      }, true, true);
      timezone = availability.timezone;
      if (input.isWalkIn ? availability.slots.length === 0 : !availability.slots.some((slot) => slot.startsAt === startsAt.toISOString() && slot.professional.id === input.professionalUserId)) {
        throw new ConflictException(input.isWalkIn
          ? 'This practitioner is unavailable on that date. Choose an available date or record it as a historical visit.'
          : 'That time is outside this practitioner’s open slots. Choose an available time or mark the visit as a walk-in.');
      }
    }
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    const actualAt = input.historicalEntry ? startsAt : null;
    if (input.historicalEntry && endsAt >= new Date()) throw new BadRequestException('A historical visit must have ended in the past');
    try {
      return await this.db.transaction(async (tx) => {
        const requestHash = createHash('sha256').update(`manual_appointment:${JSON.stringify(input)}`).digest('hex');
        const existing = await this.resolveIdempotency(tx, practiceId, idempotencyKey, requestHash);
        if (existing) return existing as typeof appointments.$inferSelect;
        let resolvedClientId: string;
        if (input.newClient) {
          const email = input.newClient.email?.trim().toLocaleLowerCase('en-US') ?? null;
          const phone = input.newClient.phone ?? null;
          const duplicates = await tx.select({ id: clients.id }).from(clients).where(and(
            eq(clients.practiceId, practiceId),
            isNull(clients.mergedIntoClientId),
            sql`lower(${clients.fullName}) = ${input.newClient.fullName.toLocaleLowerCase('en-US')}`,
            or(email ? sql`lower(${clients.email}) = ${email}` : sql`false`, phone ? eq(clients.phone, phone) : sql`false`)!,
          )).limit(1);
          if (duplicates.length) throw new ConflictException('A client with the same name and contact details may already exist. Search the directory and select the existing record if this is the same person.');
          const [createdClient] = await tx.insert(clients).values({
            practiceId, fullName: input.newClient.fullName, email, phone, createdByUserId: userId,
          }).returning({ id: clients.id });
          resolvedClientId = createdClient!.id;
          await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client.created_for_visit', entityType: 'client', entityId: resolvedClientId, metadata: { source: 'manual_visit' } });
        } else {
          resolvedClientId = input.clientId!;
        }
        if (input.historicalEntry) await tx.execute(sql`select set_config('app.actor_user_id', ${userId}, true)`);
        const [appointment] = await tx.insert(appointments).values({
          practiceId, practiceProfessionId: service.practiceProfessionId, locationId: input.locationId,
          serviceId: service.id, professionalUserId: input.professionalUserId, clientId: resolvedClientId,
          createdByUserId: userId, startsAt, endsAt,
          actualArrivedAt: actualAt, actualStartedAt: actualAt, actualEndedAt: input.historicalEntry ? endsAt : null,
          reservedStartsAt: new Date(startsAt.getTime() - service.bufferBeforeMinutes * 60_000),
          reservedEndsAt: new Date(endsAt.getTime() + service.bufferAfterMinutes * 60_000),
          timezone, serviceNameSnapshot: service.name, durationMinutesSnapshot: duration,
          bufferBeforeMinutesSnapshot: service.bufferBeforeMinutes, bufferAfterMinutesSnapshot: service.bufferAfterMinutes,
          priceMinorSnapshot: price, currencySnapshot: service.currency, status: input.historicalEntry ? 'completed' : 'confirmed',
          isWalkIn: input.isWalkIn, visitDescription: input.visitDescription ?? null,
          amountPaidMinor: input.amountPaidMinor, paymentMethod: input.paymentMethod ?? null,
          practitionerNote: input.note ?? null,
        }).returning();
        await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: input.historicalEntry ? 'appointment.historical_visit_entered' : input.isWalkIn ? 'appointment.walk_in_created' : 'appointment.created_by_practitioner', entityType: 'appointment', entityId: appointment.id, metadata: { clientId: resolvedClientId, locationId: input.locationId, serviceId: service.id, amountPaidMinor: input.amountPaidMinor, historicalEntry: input.historicalEntry } });
        await this.saveIdempotency(tx, practiceId, idempotencyKey, requestHash, appointment);
        return appointment;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('This practitioner already has a visit at that time. Pick another time or practitioner.');
      throw error;
    }
  }

  private async resolveIdempotency(tx: Database, practiceId: string, key: string | undefined, requestHash: string) {
    if (!key) return null;
    if (key.length < 16 || key.length > 128) throw new BadRequestException('Invalid idempotency key');
    await tx.insert(idempotencyKeys).values({ practiceId, key, requestHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).onConflictDoNothing();
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
    if (!row || row.requestHash !== requestHash) throw new ConflictException('This request key was already used for different visit details. Start a new submission.');
    if (row.response) return row.response;
    return null;
  }

  private async replayIdempotency<T>(practiceId: string, key: string | undefined, requestHash: string): Promise<T | null> {
    if (!key) return null;
    if (key.length < 16 || key.length > 128) throw new BadRequestException('Invalid idempotency key');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key))).limit(1);
      if (!row) return null;
      if (row.expiresAt <= new Date()) {
        await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, row.id));
        return null;
      }
      if (row.requestHash !== requestHash) throw new ConflictException('This request key was already used for different visit details. Start a new submission.');
      return row.response ? row.response as T : null;
    });
  }

  private async saveIdempotency(tx: Database, practiceId: string, key: string | undefined, requestHash: string, response: unknown) {
    if (!key) return;
    await tx.update(idempotencyKeys).set({ response: response as Record<string, unknown> })
      .where(and(eq(idempotencyKeys.practiceId, practiceId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.requestHash, requestHash)));
  }

  async updateStatus(userId: string, practiceId: string, appointmentId: string, input: AppointmentStatusInput) {
    const [appointment] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status === 'held') throw new ConflictException('This time is being held by a customer and cannot be changed as an appointment yet.');
    await this.authorization.assertPermission({
      userId, practiceId, permissionCode: permissionByStatus[input.status], locationId: appointment.locationId,
      resourceOwnerUserId: appointment.professionalUserId,
    });
    if (appointment.status === input.status) throw new BadRequestException('Appointment already has that status');
    if (input.status === 'interrupted' && (appointment.status !== 'in_progress' || !appointment.actualStartedAt)) {
      throw new BadRequestException('Only a started visit can be marked interrupted');
    }
    const startedFromConfirmed = appointment.status === 'confirmed' && input.status === 'in_progress';
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.actor_user_id', ${userId}, true), set_config('app.transition_reason', ${input.reason ?? ''}, true)`);
      let currentStatus = appointment.status;
      if (startedFromConfirmed) {
        await tx.execute(sql`select set_config('app.transition_reason', 'Customer checked in as the visit started', true)`);
        const [checkedIn] = await tx.update(appointments).set({ status: 'checked_in', actualArrivedAt: appointment.actualArrivedAt ?? now, updatedAt: now })
          .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.status, 'confirmed'))).returning();
        if (!checkedIn) throw new ConflictException('Appointment status changed; refresh before trying again');
        currentStatus = checkedIn.status;
        await tx.execute(sql`select set_config('app.transition_reason', 'Visit started', true)`);
      }
      const [row] = await tx.update(appointments).set({
        status: input.status,
        actualArrivedAt: input.status === 'checked_in' || startedFromConfirmed ? appointment.actualArrivedAt ?? now : appointment.actualArrivedAt,
        actualStartedAt: input.status === 'in_progress' || input.status === 'completed' ? appointment.actualStartedAt ?? now : appointment.actualStartedAt,
        actualEndedAt: ['completed', 'interrupted'].includes(input.status) ? now : appointment.actualEndedAt,
        cancellationReason: input.status === 'cancelled' ? input.reason ?? null : null,
        cancelledAt: input.status === 'cancelled' ? new Date() : null,
        cancelledByUserId: input.status === 'cancelled' ? userId : null,
        updatedAt: new Date(),
      }).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.status, currentStatus))).returning();
      if (!row) throw new ConflictException('Appointment status changed; refresh before trying again');
      await tx.insert(auditEvents).values({
        practiceId, actorUserId: userId, action: `appointment.${input.status}`,
        entityType: 'appointment', entityId: appointmentId,
        metadata: { from: appointment.status, to: input.status, reason: input.reason ?? null },
      });
      if (input.status === 'interrupted') {
        await tx.update(sessionRecordings).set({ status: 'stop_requested', sharingStatus: 'restricted', stopRequestedAt: now, updatedAt: now })
          .where(and(eq(sessionRecordings.appointmentId, appointmentId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt), inArray(sessionRecordings.status, ['recording', 'uploading'])));
      }
      if (input.status === 'cancelled') {
        const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
        if (client?.userId) await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: client.userId, appointmentId, kind: 'practitioner_cancelled' }).onConflictDoNothing();
      }
      return row;
    });
    return updated;
  }

  async changeServiceAtVisit(userId: string, practiceId: string, appointmentId: string, input: AppointmentServiceChangeInput) {
    const [appointment] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment || appointment.status === 'held') throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({
      userId, practiceId, permissionCode: 'appointments.complete', locationId: appointment.locationId,
      resourceOwnerUserId: appointment.professionalUserId,
    });
    if (!['checked_in', 'in_progress'].includes(appointment.status)) {
      throw new BadRequestException('A service can only be changed after the customer arrives and before the visit is closed');
    }
    if (input.serviceId === appointment.serviceId) throw new BadRequestException('Choose a different service');

    const [service] = await this.db.select({
      id: services.id, practiceProfessionId: services.practiceProfessionId, name: services.name,
      durationMinutes: services.durationMinutes, bufferBeforeMinutes: services.bufferBeforeMinutes,
      bufferAfterMinutes: services.bufferAfterMinutes, priceMinor: services.priceMinor, currency: services.currency,
    }).from(services)
      .innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.professionalUserId, appointment.professionalUserId), eq(serviceProfessionals.practiceId, practiceId), eq(serviceProfessionals.active, true)))
      .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.locationId, appointment.locationId), eq(serviceLocations.active, true)))
      .where(and(eq(services.id, input.serviceId), eq(services.practiceId, practiceId), eq(services.active, true), eq(services.practiceProfessionId, appointment.practiceProfessionId))).limit(1);
    if (!service) throw new BadRequestException('Choose an active service available to this practitioner at this branch');
    if (appointment.amountPaidMinor > 0 && (service.priceMinor === null || appointment.amountPaidMinor > service.priceMinor)) {
      throw new ConflictException('The recorded amount exceeds the new service rate. Resolve the existing payment before changing this service');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [[issuedInvoice], [recording]] = await Promise.all([
          tx.select({ id: invoices.id, status: invoices.status }).from(invoices).where(and(eq(invoices.appointmentId, appointment.id), ne(invoices.status, 'void'))).limit(1),
          tx.select({ id: sessionRecordings.id }).from(sessionRecordings).where(and(eq(sessionRecordings.appointmentId, appointment.id), isNull(sessionRecordings.deletedAt))).limit(1),
        ]);
        if (issuedInvoice) throw new ConflictException('This visit already has an invoice. Resolve or void that invoice before changing the delivered service');
        if (recording) throw new ConflictException('A recording is linked to this visit. Keep the original service or review the recording before making a service change');
        await tx.execute(sql`select set_config('app.actor_user_id', ${userId}, true), set_config('app.transition_reason', ${input.reason}, true)`);
        const [updated] = await tx.update(appointments).set({
          serviceId: service.id, serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          bufferBeforeMinutesSnapshot: service.bufferBeforeMinutes,
          bufferAfterMinutesSnapshot: service.bufferAfterMinutes,
          priceMinorSnapshot: service.priceMinor, currencySnapshot: service.currency,
          endsAt: new Date(appointment.startsAt.getTime() + service.durationMinutes * 60_000),
          reservedStartsAt: new Date(appointment.startsAt.getTime() - service.bufferBeforeMinutes * 60_000),
          reservedEndsAt: new Date(appointment.startsAt.getTime() + (service.durationMinutes + service.bufferAfterMinutes) * 60_000),
          updatedAt: new Date(),
        }).where(and(eq(appointments.id, appointment.id), eq(appointments.practiceId, practiceId), eq(appointments.status, appointment.status), eq(appointments.serviceId, appointment.serviceId))).returning();
        if (!updated) throw new ConflictException('The appointment changed while updating the service. Refresh and try again');
        await tx.insert(auditEvents).values({
          practiceId, actorUserId: userId, action: 'appointment.service_changed_at_visit', entityType: 'appointment', entityId: appointment.id,
          metadata: {
            reason: input.reason,
            beforeServiceId: appointment.serviceId, beforeServiceName: appointment.serviceNameSnapshot,
            beforeDurationMinutes: appointment.durationMinutesSnapshot, beforePriceMinor: appointment.priceMinorSnapshot,
            beforeCurrency: appointment.currencySnapshot, beforeEndsAt: appointment.endsAt.toISOString(),
            afterServiceId: service.id, afterServiceName: service.name,
            afterDurationMinutes: service.durationMinutes, afterPriceMinor: service.priceMinor,
            afterCurrency: service.currency, afterEndsAt: updated.endsAt.toISOString(),
          },
        });
        return { ...updated, serviceName: updated.serviceNameSnapshot, priceMinor: updated.priceMinorSnapshot, currency: updated.currencySnapshot };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') {
        throw new ConflictException('The new service duration overlaps another appointment. Keep the original service or resolve the schedule conflict first');
      }
      throw error;
    }
  }

  async correctStatus(userId: string, practiceId: string, appointmentId: string, input: AppointmentStatusCorrectionInput) {
    const [appointment] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment || appointment.status === 'held') throw new NotFoundException('Appointment not found');
    const [owner] = await this.db.select({ userId: practiceMemberships.userId }).from(practiceMemberships)
      .innerJoin(practiceMembershipRoles, eq(practiceMembershipRoles.membershipId, practiceMemberships.id))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active'), eq(practiceMembershipRoles.role, 'owner'))).limit(1);
    if (!owner) throw new ForbiddenException('Only the practice owner can correct a recorded appointment outcome');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.correct_status', locationId: appointment.locationId });
    const valid = (appointment.status === 'no_show' && ['confirmed', 'checked_in'].includes(input.status)) ||
      (appointment.status === 'completed' && ['checked_in', 'in_progress'].includes(input.status)) ||
      (appointment.status === 'interrupted' && input.status === 'in_progress');
    if (!valid) throw new BadRequestException('This visit outcome cannot be corrected to the selected state');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.actor_user_id', ${userId}, true), set_config('app.transition_reason', ${input.reason}, true), set_config('app.status_correction', 'true', true)`);
      const [updated] = await tx.update(appointments).set({
        status: input.status,
        ...(appointment.status === 'no_show' ? { actualArrivedAt: null, actualStartedAt: null, actualEndedAt: null } : {}),
        ...(appointment.status === 'completed' && input.status === 'checked_in' ? { actualStartedAt: null, actualEndedAt: null } : {}),
        ...(appointment.status === 'completed' && input.status === 'in_progress' ? { actualEndedAt: null } : {}),
        ...(appointment.status === 'interrupted' && input.status === 'in_progress' ? { actualEndedAt: null } : {}),
        updatedAt: new Date(),
      })
        .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.status, appointment.status))).returning();
      if (!updated) throw new ConflictException('Appointment status changed; refresh before correcting it');
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'appointment.status_corrected', entityType: 'appointment', entityId: appointmentId, metadata: { from: appointment.status, to: input.status, reason: input.reason } });
      return updated;
    });
  }

  async updatePayment(userId: string, practiceId: string, appointmentId: string, input: AppointmentPaymentInput) {
    const [appointment] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({
      userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId,
      resourceOwnerUserId: appointment.professionalUserId,
    });
    if (appointment.priceMinorSnapshot !== null && input.amountPaidMinor > appointment.priceMinorSnapshot) {
      throw new BadRequestException('Payment received cannot exceed the recorded visit rate');
    }
    const [updated] = await this.db.update(appointments).set({
      amountPaidMinor: input.amountPaidMinor,
      paymentMethod: input.amountPaidMinor > 0 ? input.paymentMethod ?? appointment.paymentMethod : null,
      updatedAt: new Date(),
    }).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).returning();
    await this.db.insert(auditEvents).values({
      practiceId, actorUserId: userId, action: 'appointment.payment_recorded', entityType: 'appointment', entityId: appointmentId,
      metadata: { previousAmountPaidMinor: appointment.amountPaidMinor, amountPaidMinor: updated.amountPaidMinor, paymentMethod: updated.paymentMethod },
    });
    return updated;
  }

  async customerAvailability(userId: string, appointmentId: string, query: PublicAvailabilityQuery) {
    const [appointment] = await this.db.select().from(appointments).innerJoin(clients, eq(clients.id, appointments.clientId))
      .where(and(eq(appointments.id, appointmentId), eq(clients.userId, userId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found in your account');
    const current = appointment.appointments;
    if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'no_show' || current.startsAt <= new Date()) throw new BadRequestException('This appointment can no longer be rescheduled');
    if (query.serviceId !== current.serviceId || query.locationId !== current.locationId || (query.professionalUserId && query.professionalUserId !== current.professionalUserId)) throw new BadRequestException('Rescheduling must keep the same service, location, and professional');
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, current.practiceId)).limit(1);
    if (!policy?.patientReschedulingEnabled) throw new ForbiddenException('This practice does not allow customer rescheduling');
    if (current.startsAt.getTime() - Date.now() <= policy.reschedulingCutoffMinutes * 60_000) throw new ForbiddenException('The rescheduling window has closed');
    if (query.from !== query.to) throw new BadRequestException('Choose one date to view available times');
    return this.booking.availableSlots(current.practiceId, query, true, true, current.id);
  }

  async bulkRescheduleOptions(userId: string, practiceId: string, input: BulkRescheduleOptionsInput) {
    const rows = await this.db.select().from(appointments).where(and(eq(appointments.practiceId, practiceId), inArray(appointments.id, input.appointmentIds)));
    if (rows.length !== input.appointmentIds.length) throw new NotFoundException('One or more appointments could not be found');
    const byId = new Map(rows.map((item) => [item.id, item]));
    const appointmentsInOrder = input.appointmentIds.map((id) => byId.get(id)!);
    for (const appointment of appointmentsInOrder) {
      const scope = { userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId } as const;
      await this.authorization.assertPermission(scope);
      if (input.allowPractitionerChange && await this.authorization.requiresOwnScope(scope)) throw new ForbiddenException('Only a scheduler or practice manager can assign affected bookings to another practitioner');
      if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be bulk moved');
    }
    const excluded = appointmentsInOrder.map((item) => item.id);
    const options = await Promise.all(appointmentsInOrder.map(async (appointment) => {
      const result = await this.booking.availableSlots(practiceId, { serviceId: appointment.serviceId, locationId: appointment.locationId, ...(input.allowPractitionerChange ? {} : { professionalUserId: appointment.professionalUserId }), from: input.date, to: input.date }, true, true, excluded);
      return { appointmentId: appointment.id, currentProfessionalUserId: appointment.professionalUserId, clientName: (await this.db.select({ name: clients.fullName }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1))[0]?.name ?? 'Customer', serviceName: appointment.serviceNameSnapshot, originalStartsAt: appointment.startsAt.toISOString(), timezone: appointment.timezone, slots: input.allowPractitionerChange ? result.slots : result.slots.filter((slot) => slot.professional.id === appointment.professionalUserId) };
    }));
    return { appointments: options };
  }

  async bulkReschedule(userId: string, practiceId: string, input: BulkAppointmentRescheduleInput) {
    const ids = input.moves.map((move) => move.appointmentId);
    const rows = await this.db.select().from(appointments).where(and(eq(appointments.practiceId, practiceId), inArray(appointments.id, ids)));
    if (rows.length !== ids.length) throw new NotFoundException('One or more appointments could not be found');
    const byId = new Map(rows.map((item) => [item.id, item]));
    const moves = input.moves.map((move) => ({ appointment: byId.get(move.appointmentId)!, startsAt: new Date(move.startsAt), professionalUserId: move.professionalUserId ?? byId.get(move.appointmentId)!.professionalUserId }));
    for (const { appointment, startsAt, professionalUserId } of moves) {
      await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
      if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be bulk moved');
      if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date() || startsAt.getTime() === appointment.startsAt.getTime()) throw new BadRequestException('Choose a different future time for every appointment');
    }
    const excluded = moves.map(({ appointment }) => appointment.id);
    const slotsById = new Map<string, { startsAt: string; endsAt: string }>();
    for (const { appointment, startsAt, professionalUserId } of moves) {
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
      const available = await this.booking.availableSlots(practiceId, { serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId, from: localDate, to: localDate }, true, true, excluded);
      const slot = available.slots.find((item) => item.startsAt === startsAt.toISOString() && item.professional.id === professionalUserId);
      if (!slot) throw new ConflictException(`A selected time for ${appointment.serviceNameSnapshot} is no longer available`);
      slotsById.set(appointment.id, slot);
    }
    for (let i = 0; i < moves.length; i++) for (let j = i + 1; j < moves.length; j++) {
      const left = moves[i]!, right = moves[j]!;
      if (left.professionalUserId !== right.professionalUserId) continue;
      const a = slotsById.get(left.appointment.id)!; const b = slotsById.get(right.appointment.id)!;
      const aStart = new Date(a.startsAt).getTime() - left.appointment.bufferBeforeMinutesSnapshot * 60_000;
      const aEnd = new Date(a.endsAt).getTime() + left.appointment.bufferAfterMinutesSnapshot * 60_000;
      const bStart = new Date(b.startsAt).getTime() - right.appointment.bufferBeforeMinutesSnapshot * 60_000;
      const bEnd = new Date(b.endsAt).getTime() + right.appointment.bufferAfterMinutesSnapshot * 60_000;
      if (aStart < bEnd && bStart < aEnd) throw new ConflictException('Two selected appointments overlap. Choose different times before confirming.');
    }
    try {
      return await this.db.transaction(async (tx) => {
        const updated = [];
        for (const { appointment, professionalUserId } of moves) {
          const slot = slotsById.get(appointment.id)!;
          const [row] = await tx.update(appointments).set({ professionalUserId, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), reservedStartsAt: new Date(new Date(slot.startsAt).getTime() - appointment.bufferBeforeMinutesSnapshot * 60_000), reservedEndsAt: new Date(new Date(slot.endsAt).getTime() + appointment.bufferAfterMinutesSnapshot * 60_000), updatedAt: new Date() })
            .where(and(eq(appointments.id, appointment.id), eq(appointments.status, appointment.status), eq(appointments.startsAt, appointment.startsAt))).returning();
          if (!row) throw new ConflictException('An appointment changed while you were confirming. Refresh and review the moves again.');
          const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
          if (client?.userId) await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: client.userId, appointmentId: appointment.id, kind: 'practitioner_rescheduled' }).onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
          if (professionalUserId !== appointment.professionalUserId) {
            for (const [recipientUserId, kind] of [[appointment.professionalUserId, 'appointment_reassigned_away'], [professionalUserId, 'appointment_assigned']] as const) {
              await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId, appointmentId: appointment.id, kind }).onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
            }
          }
          await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'practitioner_rescheduled', entityType: 'appointment', entityId: appointment.id, metadata: { from: appointment.startsAt.toISOString(), to: slot.startsAt, fromProfessionalUserId: appointment.professionalUserId, toProfessionalUserId: professionalUserId, reason: input.reason } });
          updated.push(row);
        }
        return { moved: updated.length, appointments: updated };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('One of those times was just booked. Review available times and try again.');
      throw error;
    }
  }

  async reassignPractitioner(userId: string, practiceId: string, appointmentId: string, input: AppointmentReassignmentInput) {
    const [appointment] = await this.db.select().from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
    const scope = { userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId } as const;
    if (await this.authorization.requiresOwnScope(scope)) throw new ForbiddenException('Only a scheduler or practice manager can reassign a practitioner');
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) {
      throw new BadRequestException('Only a future, not-yet-started appointment can be reassigned');
    }
    if (input.professionalUserId === appointment.professionalUserId) throw new BadRequestException('Choose a different practitioner');
    const startsAt = new Date(input.startsAt);
    if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date()) throw new BadRequestException('Choose a future available time');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
    const available = await this.booking.availableSlots(practiceId, {
      serviceId: appointment.serviceId, locationId: appointment.locationId,
      professionalUserId: input.professionalUserId, from: date, to: date,
    }, true, true, appointment.id);
    const slot = available.slots.find((item) => item.startsAt === startsAt.toISOString() && item.professional.id === input.professionalUserId);
    if (!slot) throw new ConflictException('That practitioner is not available for the selected time. The original appointment is unchanged.');
    try {
      return await this.db.transaction(async (tx) => {
        const [updated] = await tx.update(appointments).set({
          professionalUserId: input.professionalUserId, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt),
          reservedStartsAt: new Date(new Date(slot.startsAt).getTime() - appointment.bufferBeforeMinutesSnapshot * 60_000),
          reservedEndsAt: new Date(new Date(slot.endsAt).getTime() + appointment.bufferAfterMinutesSnapshot * 60_000),
          updatedAt: new Date(),
        }).where(and(eq(appointments.id, appointment.id), eq(appointments.practiceId, practiceId), eq(appointments.status, appointment.status), eq(appointments.professionalUserId, appointment.professionalUserId), eq(appointments.startsAt, appointment.startsAt))).returning();
        if (!updated) throw new ConflictException('This appointment changed while you were reviewing it. Refresh and try again.');
        const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
        if (client?.userId) {
          await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: client.userId, appointmentId, kind: 'practitioner_rescheduled' })
            .onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
        }
        await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: appointment.professionalUserId, appointmentId, kind: 'appointment_reassigned_away' })
          .onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
        await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: input.professionalUserId, appointmentId, kind: 'appointment_assigned' })
          .onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
        await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'appointment.practitioner_reassigned', entityType: 'appointment', entityId: appointmentId, metadata: { fromProfessionalUserId: appointment.professionalUserId, toProfessionalUserId: input.professionalUserId, from: appointment.startsAt.toISOString(), to: slot.startsAt, reason: input.reason } });
        return updated;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('The selected time was just booked. The original appointment is unchanged. Choose another time.');
      throw error;
    }
  }

  async practitionerAvailability(userId: string, practiceId: string, appointmentId: string, query: PublicAvailabilityQuery) {
    const [appointment] = await this.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be moved');
    if (query.serviceId !== appointment.serviceId || query.locationId !== appointment.locationId || (query.professionalUserId && query.professionalUserId !== appointment.professionalUserId)) throw new BadRequestException('Choose the same service, location, and professional');
    return this.booking.availableSlots(practiceId, query, true, true, appointment.id);
  }

  async reassignmentAvailability(userId: string, practiceId: string, appointmentId: string, query: PublicAvailabilityQuery) {
    const [appointment] = await this.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    const scope = { userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId } as const;
    await this.authorization.assertPermission(scope);
    if (await this.authorization.requiresOwnScope(scope)) throw new ForbiddenException('Only a scheduler or practice manager can reassign a practitioner');
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only a future, not-yet-started appointment can be reassigned');
    if (!query.professionalUserId || query.professionalUserId === appointment.professionalUserId || query.serviceId !== appointment.serviceId || query.locationId !== appointment.locationId) {
      throw new BadRequestException('Choose a different practitioner for this appointment');
    }
    return this.booking.availableSlots(practiceId, query, true, true, appointment.id);
  }

  async customerCancel(userId: string, appointmentId: string, reason?: string) {
    const [row] = await this.db.select({ appointment: appointments, clientUserId: clients.userId }).from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId)).where(and(eq(appointments.id, appointmentId), eq(clients.userId, userId))).limit(1);
    if (!row) throw new NotFoundException('Appointment not found in your account');
    const appointment = row.appointment;
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, appointment.practiceId)).limit(1);
    if (!policy?.patientCancellationEnabled) throw new ForbiddenException('This practice does not allow customer cancellations');
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('This appointment can no longer be cancelled');
    if (appointment.startsAt.getTime() - Date.now() <= policy.cancellationCutoffMinutes * 60_000) throw new ForbiddenException('The cancellation window has closed');
    return this.cancelAppointment(appointment, userId, reason, 'customer_cancellation');
  }

  async customerReschedule(userId: string, appointmentId: string, startsAt: string) {
    const [row] = await this.db.select({ appointment: appointments, clientUserId: clients.userId }).from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId)).where(and(eq(appointments.id, appointmentId), eq(clients.userId, userId))).limit(1);
    if (!row) throw new NotFoundException('Appointment not found in your account');
    const appointment = row.appointment;
    const [policy] = await this.db.select().from(bookingPolicies).where(eq(bookingPolicies.practiceId, appointment.practiceId)).limit(1);
    if (!policy?.patientReschedulingEnabled) throw new ForbiddenException('This practice does not allow customer rescheduling');
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('This appointment can no longer be rescheduled');
    if (appointment.startsAt.getTime() - Date.now() <= policy.reschedulingCutoffMinutes * 60_000) throw new ForbiddenException('The rescheduling window has closed');
    return this.moveAppointment(appointment, userId, startsAt, 'customer_rescheduled');
  }

  async practitionerReschedule(userId: string, practiceId: string, appointmentId: string, startsAt: string) {
    const [appointment] = await this.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be moved');
    return this.moveAppointment(appointment, userId, startsAt, 'practitioner_rescheduled');
  }

  private async moveAppointment(appointment: typeof appointments.$inferSelect, actorId: string, startsAt: string, action: string) {
    const start = new Date(startsAt);
    if (!Number.isFinite(start.getTime()) || start <= new Date()) throw new BadRequestException('Choose a future appointment time');
    if (start.getTime() === appointment.startsAt.getTime()) throw new BadRequestException('Choose a different appointment time');
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
    const slots = await this.booking.availableSlots(appointment.practiceId, { serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId: appointment.professionalUserId, from: localDate, to: localDate }, true, true, appointment.id);
    const slot = slots.slots.find((item) => item.startsAt === start.toISOString() && item.professional.id === appointment.professionalUserId);
    if (!slot) throw new BadRequestException('That time is no longer available. Choose another slot.');
    try {
      return await this.db.transaction(async (tx) => {
        const [updated] = await tx.update(appointments).set({ startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), reservedStartsAt: new Date(new Date(slot.startsAt).getTime() - appointment.bufferBeforeMinutesSnapshot * 60_000), reservedEndsAt: new Date(new Date(slot.endsAt).getTime() + appointment.bufferAfterMinutesSnapshot * 60_000), updatedAt: new Date() })
          .where(and(eq(appointments.id, appointment.id), eq(appointments.status, appointment.status), eq(appointments.startsAt, appointment.startsAt))).returning();
        if (!updated) throw new ConflictException('Appointment changed. Refresh and try again.');
        const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
        if (action === 'customer_rescheduled') await tx.insert(appointmentNotifications).values({ practiceId: appointment.practiceId, recipientUserId: appointment.professionalUserId, appointmentId: appointment.id, kind: action }).onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
        if (client?.userId && action === 'practitioner_rescheduled') await tx.insert(appointmentNotifications).values({ practiceId: appointment.practiceId, recipientUserId: client.userId, appointmentId: appointment.id, kind: action }).onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
        await tx.insert(auditEvents).values({ practiceId: appointment.practiceId, actorUserId: actorId, action, entityType: 'appointment', entityId: appointment.id, metadata: { from: appointment.startsAt.toISOString(), to: slot.startsAt } });
        return updated;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('That time was just booked. Choose another slot.');
      throw error;
    }
  }

  private async cancelAppointment(appointment: typeof appointments.$inferSelect, actorId: string, reason: string | undefined, action: string) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx.update(appointments).set({ status: 'cancelled', cancellationReason: reason?.trim() || null, cancelledAt: new Date(), cancelledByUserId: actorId, updatedAt: new Date() })
        .where(and(eq(appointments.id, appointment.id), eq(appointments.status, appointment.status), eq(appointments.startsAt, appointment.startsAt))).returning();
      if (!updated) throw new ConflictException('Appointment changed. Refresh and try again.');
      await tx.insert(appointmentNotifications).values({ practiceId: appointment.practiceId, recipientUserId: appointment.professionalUserId, appointmentId: appointment.id, kind: action }).onConflictDoNothing();
      await tx.insert(auditEvents).values({ practiceId: appointment.practiceId, actorUserId: actorId, action, entityType: 'appointment', entityId: appointment.id, metadata: { reason: reason?.trim() || null } });
      return updated;
    });
  }

}
