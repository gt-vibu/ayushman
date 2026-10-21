import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, appointmentNotifications, bookingPolicies, clientDocuments, clients, customerProfiles, invoiceItems, invoicePayments, invoices, locations, practiceProfessions, practices, users } from '@ayushman-v2/db/schema';
import type { CustomerProfileUpdateInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';

@Injectable()
export class CustomerAccountService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async profile(userId: string) {
    const [profile] = await this.db.select({ fullName: users.fullName, email: users.email, phone: customerProfiles.phone })
      .from(customerProfiles).innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(and(eq(customerProfiles.userId, userId), isNull(users.disabledAt))).limit(1);
    if (!profile) throw new NotFoundException('Customer account not found');
    return profile;
  }

  async updateProfile(userId: string, input: CustomerProfileUpdateInput) {
    await this.db.transaction(async (tx) => {
      if (input.fullName !== undefined) {
        await tx.update(users).set({ fullName: input.fullName, updatedAt: new Date() }).where(eq(users.id, userId));
        await tx.update(clients).set({ fullName: input.fullName, updatedAt: new Date() }).where(eq(clients.userId, userId));
      }
      if (input.phone !== undefined) {
        await tx.update(customerProfiles).set({ phone: input.phone, updatedAt: new Date() }).where(eq(customerProfiles.userId, userId));
        await tx.update(clients).set({ phone: input.phone, updatedAt: new Date() }).where(eq(clients.userId, userId));
      }
    });
    return this.profile(userId);
  }

  async records(userId: string) {
    const practicesLinked = await this.db.select({
      clientId: clients.id, practiceId: practices.id, practiceName: practices.name,
      fullName: clients.fullName, email: clients.email, phone: clients.phone,
      linkedAt: clients.createdAt,
    }).from(clients).innerJoin(practices, eq(practices.id, clients.practiceId))
      .where(eq(clients.userId, userId)).orderBy(asc(practices.name));
    const appointmentRows = await this.db.select({
      id: appointments.id, practiceId: practices.id, practiceName: practices.name,
      clientId: clients.id, serviceId: appointments.serviceId, locationId: appointments.locationId, professionalUserId: appointments.professionalUserId,
      professionalName: users.fullName, locationName: locations.name,
      professionName: practiceProfessions.name, termOverrides: practiceProfessions.termOverrides,
      serviceName: appointments.serviceNameSnapshot, startsAt: appointments.startsAt,
      endsAt: appointments.endsAt, timezone: appointments.timezone, status: appointments.status,
      followUpToAppointmentId: appointments.followUpToAppointmentId,
      priceMinor: appointments.priceMinorSnapshot, currency: appointments.currencySnapshot,
    }).from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId))
      .innerJoin(practices, eq(practices.id, appointments.practiceId))
      .innerJoin(practiceProfessions, and(eq(practiceProfessions.id, appointments.practiceProfessionId), eq(practiceProfessions.practiceId, appointments.practiceId)))
      .innerJoin(users, eq(users.id, appointments.professionalUserId))
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .where(and(eq(clients.userId, userId), ne(appointments.status, 'held'), isNull(appointments.holdExpiresAt))).orderBy(asc(appointments.startsAt));
    const policyRows = practicesLinked.length ? await this.db.select().from(bookingPolicies).where(inArray(bookingPolicies.practiceId, practicesLinked.map((item) => item.practiceId))) : [];
    const policies = new Map(policyRows.map((policy) => [policy.practiceId, policy]));
    const now = Date.now();
    const appointmentsLinked = appointmentRows.map((appointment) => {
      const policy = policies.get(appointment.practiceId);
      const minutesUntil = (new Date(appointment.startsAt).getTime() - now) / 60_000;
      const active = ['pending', 'confirmed'].includes(appointment.status) && minutesUntil > 0;
      return { ...appointment,
        canCustomerCancel: Boolean(active && policy?.patientCancellationEnabled && minutesUntil > (policy?.cancellationCutoffMinutes ?? 0)),
        canCustomerReschedule: Boolean(active && policy?.patientReschedulingEnabled && minutesUntil > (policy?.reschedulingCutoffMinutes ?? 0)),
      };
    });
    const documents = await this.db.select({
      id: clientDocuments.id, practiceId: clientDocuments.practiceId, practiceName: practices.name,
      clientId: clientDocuments.clientId, originalName: clientDocuments.originalName,
      mediaType: clientDocuments.mediaType, sizeBytes: clientDocuments.sizeBytes, category: clientDocuments.category,
      description: clientDocuments.description, createdAt: clientDocuments.createdAt,
    }).from(clientDocuments).innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .innerJoin(practices, eq(practices.id, clientDocuments.practiceId))
      .where(and(eq(clients.userId, userId), eq(clientDocuments.customerVisible, true), isNull(clientDocuments.deletedAt)))
      .orderBy(desc(clientDocuments.createdAt));

    const invoiceRows = await this.db.select({
      id: invoices.id, practiceId: invoices.practiceId, practiceName: practices.name,
      invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, status: invoices.status,
      currency: invoices.currency, issueDate: invoices.issueDate, dueDate: invoices.dueDate,
      subtotalMinor: invoices.subtotalMinor, discountMinor: invoices.discountMinor, taxMinor: invoices.taxMinor,
      centralTaxMinor: invoices.centralTaxMinor, stateTaxMinor: invoices.stateTaxMinor,
      integratedTaxMinor: invoices.integratedTaxMinor, totalMinor: invoices.totalMinor,
      amountPaidMinor: invoices.amountPaidMinor, appointmentId: invoices.appointmentId,
      locationName: locations.name, supplierSnapshot: invoices.supplierSnapshot,
      recipientSnapshot: invoices.recipientSnapshot, placeOfSupply: invoices.placeOfSupply,
      notes: invoices.notes,
    }).from(invoices)
      .innerJoin(clients, and(eq(clients.id, invoices.clientId), eq(clients.practiceId, invoices.practiceId)))
      .innerJoin(practices, eq(practices.id, invoices.practiceId))
      .leftJoin(locations, eq(locations.id, invoices.locationId))
      .where(eq(clients.userId, userId))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const lineRows = invoiceIds.length
      ? await this.db.select({ id: invoiceItems.id, invoiceId: invoiceItems.invoiceId, description: invoiceItems.description, quantityMilli: invoiceItems.quantityMilli, unitPriceMinor: invoiceItems.unitPriceMinor, lineTotalMinor: invoiceItems.lineTotalMinor, taxRateBps: invoiceItems.taxRateBps, taxMinor: invoiceItems.taxMinor }).from(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds)).orderBy(asc(invoiceItems.lineOrder))
      : [];
    const paymentRows = invoiceIds.length
      ? await this.db.select({ id: invoicePayments.id, invoiceId: invoicePayments.invoiceId, amountMinor: invoicePayments.amountMinor, method: invoicePayments.method, reference: invoicePayments.reference, receivedAt: invoicePayments.receivedAt }).from(invoicePayments).where(inArray(invoicePayments.invoiceId, invoiceIds)).orderBy(asc(invoicePayments.receivedAt))
      : [];
    const invoicesWithDetails = invoiceRows.map((invoice) => ({
      ...invoice,
      lines: lineRows.filter((line) => line.invoiceId === invoice.id),
      payments: paymentRows.filter((payment) => payment.invoiceId === invoice.id),
    }));
    const notifications = await this.db.select({ id: appointmentNotifications.id, appointmentId: appointmentNotifications.appointmentId, kind: appointmentNotifications.kind, createdAt: appointmentNotifications.createdAt, serviceName: appointments.serviceNameSnapshot, startsAt: appointments.startsAt, timezone: appointments.timezone, practiceName: practices.name })
      .from(appointmentNotifications).innerJoin(appointments, eq(appointments.id, appointmentNotifications.appointmentId)).innerJoin(practices, eq(practices.id, appointmentNotifications.practiceId))
      .where(and(eq(appointmentNotifications.recipientUserId, userId), isNull(appointmentNotifications.readAt), inArray(appointmentNotifications.kind, ['practitioner_rescheduled', 'practitioner_cancelled'])))
      .orderBy(desc(appointmentNotifications.createdAt)).limit(20);
    return { practices: practicesLinked, appointments: appointmentsLinked, documents, invoices: invoicesWithDetails, notifications };
  }

  async markAppointmentNoticeRead(userId: string, notificationId: string) {
    const [updated] = await this.db.update(appointmentNotifications).set({ readAt: new Date() }).where(and(eq(appointmentNotifications.id, notificationId), eq(appointmentNotifications.recipientUserId, userId), isNull(appointmentNotifications.readAt))).returning({ id: appointmentNotifications.id });
    return { read: Boolean(updated) };
  }
}
