import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, appointmentEvents, appointmentNotifications, auditEvents, bookingPolicies, clients, locations, practices, serviceLocations, serviceProfessionals, services } from '@ayushman-v2/db/schema';
import type { AppointmentListQuery, AppointmentStatusInput, BulkAppointmentRescheduleInput, BulkRescheduleOptionsInput, ClientListQuery, CreateFollowUpInput, PublicAvailabilityQuery } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BookingService } from './booking.service.js';

const permissionByStatus = {
  confirmed: 'appointments.update',
  checked_in: 'appointments.check_in',
  in_progress: 'appointments.complete',
  completed: 'appointments.complete',
  no_show: 'appointments.mark_no_show',
  cancelled: 'appointments.cancel',
  pending: 'appointments.update',
} as const;

@Injectable()
export class AppointmentManagementService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService, private readonly booking: BookingService) {}

  async listNotifications(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', ownRecordsAreQueryScoped: true });
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
        .where(and(eq(appointmentNotifications.practiceId, practiceId), eq(appointmentNotifications.recipientUserId, userId)))
        .orderBy(desc(appointmentNotifications.createdAt)).limit(20),
      this.db.select({ unreadCount: count() }).from(appointmentNotifications)
        .where(and(eq(appointmentNotifications.practiceId, practiceId), eq(appointmentNotifications.recipientUserId, userId), isNull(appointmentNotifications.readAt))),
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

  async createFollowUp(userId: string, practiceId: string, input: CreateFollowUpInput) {
    const check = { userId, practiceId, permissionCode: 'appointments.create', locationId: input.locationId, resourceOwnerUserId: input.professionalUserId } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    if (ownScope && input.professionalUserId !== userId) throw new ForbiddenException('You can only schedule follow-ups with your own clients');

    const [[client], [sourceAppointment], [service], [practice]] = await Promise.all([
      this.db.select({ id: clients.id, userId: clients.userId }).from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.practiceId, practiceId))).limit(1),
      this.db.select({ id: appointments.id, clientId: appointments.clientId, status: appointments.status, locationId: appointments.locationId, professionalUserId: appointments.professionalUserId }).from(appointments)
        .where(and(eq(appointments.id, input.sourceAppointmentId), eq(appointments.practiceId, practiceId))).limit(1),
      this.db.select({ id: services.id, practiceProfessionId: services.practiceProfessionId, name: services.name, durationMinutes: services.durationMinutes, bufferBeforeMinutes: services.bufferBeforeMinutes, bufferAfterMinutes: services.bufferAfterMinutes, priceMinor: services.priceMinor, currency: services.currency })
        .from(services).innerJoin(serviceProfessionals, and(eq(serviceProfessionals.serviceId, services.id), eq(serviceProfessionals.active, true)))
        .innerJoin(serviceLocations, and(eq(serviceLocations.serviceId, services.id), eq(serviceLocations.active, true)))
        .where(and(eq(services.id, input.serviceId), eq(services.practiceId, practiceId), eq(services.active, true), eq(serviceProfessionals.professionalUserId, input.professionalUserId), eq(serviceLocations.locationId, input.locationId))).limit(1),
      this.db.select({ timezone: practices.timezone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
    ]);
    if (!client) throw new NotFoundException('Customer record not found in this practice');
    if (!sourceAppointment || sourceAppointment.clientId !== client.id) throw new BadRequestException('A follow-up must be linked to an appointment for the same customer');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId: sourceAppointment.locationId, resourceOwnerUserId: sourceAppointment.professionalUserId });
    if (sourceAppointment.professionalUserId !== input.professionalUserId) throw new BadRequestException('Schedule the follow-up with the professional from the original appointment');
    if (!['checked_in', 'in_progress', 'completed'].includes(sourceAppointment.status)) throw new BadRequestException('A follow-up can be scheduled when the original appointment is checked in, in progress, or completed');
    if (!client.userId) throw new BadRequestException('This customer needs a linked Ayushman account before a follow-up can be scheduled for them');
    if (!service) throw new BadRequestException('Choose a service assigned to this professional and branch');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: practice?.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(input.startsAt));
    const available = await this.booking.availableSlots(practiceId, { serviceId: service.id, locationId: input.locationId, professionalUserId: input.professionalUserId, from: date, to: date }, true, true);
    const requestedStart = new Date(input.startsAt).toISOString();
    const slot = available.slots.find((candidate) => candidate.startsAt === requestedStart && candidate.professional.id === input.professionalUserId);
    if (!slot) throw new ConflictException('That follow-up time is no longer available. Choose another slot.');

    try {
      return await this.db.transaction(async (tx) => {
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
        await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'appointment.follow_up_booked', entityType: 'appointment', entityId: appointment.id, metadata: { clientId: client.id, serviceId: service.id, locationId: input.locationId } });
        return { appointment };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('That follow-up time was just booked. Choose another slot');
      throw error;
    }
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
      locationId: appointments.locationId, professionalUserId: appointments.professionalUserId,
      serviceName: appointments.serviceNameSnapshot, clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      clientName: clients.fullName, clientEmail: clients.email, clientPhone: clients.phone,
      clientNote: appointments.clientNote, timezone: appointments.timezone,
    }).from(appointments).innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(...filters)).orderBy(asc(appointments.startsAt)).limit(query.limit);
    return clientPermission.allowed ? rows : rows.map(({ clientEmail: _email, clientPhone: _phone, ...row }) => row);
  }

  async listClients(userId: string, practiceId: string, query: ClientListQuery) {
    const check = { userId, practiceId, permissionCode: 'clients.read', locationId: query.locationId, ownRecordsAreQueryScoped: true } as const;
    await this.authorization.assertPermission(check);
    const ownScope = await this.authorization.requiresOwnScope(check);
    const filters = [eq(clients.practiceId, practiceId)];
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(sql`${clients.fullName} ILIKE ${pattern}`, sql`COALESCE(${clients.email}, '') ILIKE ${pattern}`, sql`COALESCE(${clients.phone}, '') ILIKE ${pattern}`)!);
    }
    if (query.locationId) filters.push(sql`exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.location_id = ${query.locationId}::uuid)`);
    if (ownScope) filters.push(sql`exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.professional_user_id = ${userId}::uuid)`);
    filters.push(sql`exists (select 1 from appointments a where a.client_id = ${clients.id} and a.practice_id = ${practiceId}::uuid and a.hold_expires_at is null)`);
    return this.db.select({
      id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone,
      createdAt: clients.createdAt, updatedAt: clients.updatedAt,
    }).from(clients).where(and(...filters)).orderBy(asc(clients.fullName)).limit(query.limit);
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
    const updated = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.actor_user_id', ${userId}, true), set_config('app.transition_reason', ${input.reason ?? ''}, true)`);
      const [row] = await tx.update(appointments).set({
        status: input.status,
        cancellationReason: input.status === 'cancelled' ? input.reason ?? null : null,
        cancelledAt: input.status === 'cancelled' ? new Date() : null,
        cancelledByUserId: input.status === 'cancelled' ? userId : null,
        updatedAt: new Date(),
      }).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.status, appointment.status))).returning();
      if (!row) throw new ConflictException('Appointment status changed; refresh before trying again');
      await tx.insert(auditEvents).values({
        practiceId, actorUserId: userId, action: `appointment.${input.status}`,
        entityType: 'appointment', entityId: appointmentId,
        metadata: { from: appointment.status, to: input.status, reason: input.reason ?? null },
      });
      if (input.status === 'cancelled') {
        const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
        if (client?.userId) await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: client.userId, appointmentId, kind: 'practitioner_cancelled' }).onConflictDoNothing();
      }
      return row;
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
      await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
      if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be bulk moved');
    }
    const excluded = appointmentsInOrder.map((item) => item.id);
    const options = await Promise.all(appointmentsInOrder.map(async (appointment) => {
      const result = await this.booking.availableSlots(practiceId, { serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId: appointment.professionalUserId, from: input.date, to: input.date }, true, true, excluded);
      return { appointmentId: appointment.id, clientName: (await this.db.select({ name: clients.fullName }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1))[0]?.name ?? 'Customer', serviceName: appointment.serviceNameSnapshot, originalStartsAt: appointment.startsAt.toISOString(), timezone: appointment.timezone, slots: result.slots.filter((slot) => slot.professional.id === appointment.professionalUserId) };
    }));
    return { appointments: options };
  }

  async bulkReschedule(userId: string, practiceId: string, input: BulkAppointmentRescheduleInput) {
    const ids = input.moves.map((move) => move.appointmentId);
    const rows = await this.db.select().from(appointments).where(and(eq(appointments.practiceId, practiceId), inArray(appointments.id, ids)));
    if (rows.length !== ids.length) throw new NotFoundException('One or more appointments could not be found');
    const byId = new Map(rows.map((item) => [item.id, item]));
    const moves = input.moves.map((move) => ({ appointment: byId.get(move.appointmentId)!, startsAt: new Date(move.startsAt) }));
    for (const { appointment, startsAt } of moves) {
      await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
      if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be bulk moved');
      if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date() || startsAt.getTime() === appointment.startsAt.getTime()) throw new BadRequestException('Choose a different future time for every appointment');
    }
    const excluded = moves.map(({ appointment }) => appointment.id);
    const slotsById = new Map<string, { startsAt: string; endsAt: string }>();
    for (const { appointment, startsAt } of moves) {
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
      const available = await this.booking.availableSlots(practiceId, { serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId: appointment.professionalUserId, from: localDate, to: localDate }, true, true, excluded);
      const slot = available.slots.find((item) => item.startsAt === startsAt.toISOString() && item.professional.id === appointment.professionalUserId);
      if (!slot) throw new ConflictException(`A selected time for ${appointment.serviceNameSnapshot} is no longer available`);
      slotsById.set(appointment.id, slot);
    }
    for (let i = 0; i < moves.length; i++) for (let j = i + 1; j < moves.length; j++) {
      const left = moves[i]!, right = moves[j]!;
      if (left.appointment.professionalUserId !== right.appointment.professionalUserId) continue;
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
        for (const { appointment } of moves) {
          const slot = slotsById.get(appointment.id)!;
          const [row] = await tx.update(appointments).set({ startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), reservedStartsAt: new Date(new Date(slot.startsAt).getTime() - appointment.bufferBeforeMinutesSnapshot * 60_000), reservedEndsAt: new Date(new Date(slot.endsAt).getTime() + appointment.bufferAfterMinutesSnapshot * 60_000), updatedAt: new Date() })
            .where(and(eq(appointments.id, appointment.id), eq(appointments.status, appointment.status), eq(appointments.startsAt, appointment.startsAt))).returning();
          if (!row) throw new ConflictException('An appointment changed while you were confirming. Refresh and review the moves again.');
          const [client] = await tx.select({ userId: clients.userId }).from(clients).where(eq(clients.id, appointment.clientId)).limit(1);
          if (client?.userId) await tx.insert(appointmentNotifications).values({ practiceId, recipientUserId: client.userId, appointmentId: appointment.id, kind: 'practitioner_rescheduled' }).onConflictDoUpdate({ target: [appointmentNotifications.recipientUserId, appointmentNotifications.appointmentId, appointmentNotifications.kind], set: { readAt: null, createdAt: new Date() } });
          await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'practitioner_rescheduled', entityType: 'appointment', entityId: appointment.id, metadata: { from: appointment.startsAt.toISOString(), to: slot.startsAt, reason: 'bulk_schedule_change' } });
          updated.push(row);
        }
        return { moved: updated.length, appointments: updated };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23P01') throw new ConflictException('One of those times was just booked. Review available times and try again.');
      throw error;
    }
  }

  async practitionerAvailability(userId: string, practiceId: string, appointmentId: string, query: PublicAvailabilityQuery) {
    const [appointment] = await this.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.update', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId });
    if (!['pending', 'confirmed'].includes(appointment.status) || appointment.startsAt <= new Date()) throw new BadRequestException('Only future pending or confirmed appointments can be moved');
    if (query.serviceId !== appointment.serviceId || query.locationId !== appointment.locationId || (query.professionalUserId && query.professionalUserId !== appointment.professionalUserId) || query.from !== query.to) throw new BadRequestException('Choose a date for the same service, location, and professional');
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
