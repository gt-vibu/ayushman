import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, auditEvents, billingProfiles, clients, invoiceItems, invoicePayments, invoiceSequences, invoices, locations, practices } from '@ayushman-v2/db/schema';
import type { BillingAppointmentQuery, BillingProfileInput, InvoiceCreateInput, InvoicePaymentInput, InvoiceVoidInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';

const MAX_AMOUNT_MINOR = 2_147_483_647;

@Injectable()
export class BillingService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService) {}

  async profile(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.read' });
    const [profile] = await this.db.select().from(billingProfiles).where(eq(billingProfiles.practiceId, practiceId)).limit(1);
    return profile ?? null;
  }

  async updateProfile(userId: string, practiceId: string, input: BillingProfileInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.manage' });
    const [profile] = await this.db.insert(billingProfiles).values({ practiceId, ...input, updatedByUserId: userId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: billingProfiles.practiceId, set: { ...input, updatedByUserId: userId, updatedAt: new Date() } }).returning();
    return profile;
  }

  async list(userId: string, practiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.read' });
    return this.db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, status: invoices.status,
      currency: invoices.currency, issueDate: invoices.issueDate, dueDate: invoices.dueDate,
      subtotalMinor: invoices.subtotalMinor, taxMinor: invoices.taxMinor, totalMinor: invoices.totalMinor,
      amountPaidMinor: invoices.amountPaidMinor, clientId: invoices.clientId, clientName: clients.fullName,
    }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(eq(invoices.practiceId, practiceId)).orderBy(desc(invoices.issueDate), desc(invoices.createdAt)).limit(250);
  }

  async appointmentOptions(userId: string, practiceId: string, query: BillingAppointmentQuery) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.read' });
    if (query.clientId) {
      const [client] = await this.db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.id, query.clientId), eq(clients.practiceId, practiceId))).limit(1);
      if (!client) throw new NotFoundException('Customer record not found');
    }
    const filters = [eq(appointments.practiceId, practiceId), isNull(appointments.holdExpiresAt), sql`${appointments.status} not in ('cancelled', 'no_show', 'held')`,
      sql`not exists (select 1 from invoices where invoices.practice_id = ${appointments.practiceId} and invoices.appointment_id = ${appointments.id})`];
    if (query.date) filters.push(sql`to_char(timezone(${appointments.timezone}, ${appointments.startsAt}), 'YYYY-MM-DD') = ${query.date}`);
    if (query.clientId) filters.push(eq(appointments.clientId, query.clientId));
    return this.db.select({
      id: appointments.id, clientId: appointments.clientId, clientName: clients.fullName, clientEmail: clients.email,
      startsAt: appointments.startsAt, timezone: appointments.timezone, status: appointments.status,
      locationId: appointments.locationId, locationName: locations.name,
      serviceName: appointments.serviceNameSnapshot, priceMinor: appointments.priceMinorSnapshot,
      currency: appointments.currencySnapshot,
    }).from(appointments).innerJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.practiceId, practiceId)))
      .innerJoin(locations, and(eq(locations.id, appointments.locationId), eq(locations.practiceId, practiceId)))
      .innerJoin(practices, eq(practices.id, practiceId))
      .where(and(...filters)).orderBy(sql`case when ${appointments.status} = 'completed' then 0 else 1 end`, desc(appointments.startsAt)).limit(query.limit);
  }

  async get(userId: string, practiceId: string, invoiceId: string) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.read' });
    const [invoice] = await this.db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.practiceId, practiceId))).limit(1);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const [[client], [location], lines, payments] = await Promise.all([
      this.db.select({ fullName: clients.fullName, email: clients.email, phone: clients.phone }).from(clients).where(eq(clients.id, invoice.clientId)).limit(1),
      invoice.locationId ? this.db.select({ name: locations.name }).from(locations).where(eq(locations.id, invoice.locationId)).limit(1) : Promise.resolve([undefined]),
      this.db.select().from(invoiceItems).where(and(eq(invoiceItems.invoiceId, invoiceId), eq(invoiceItems.practiceId, practiceId))).orderBy(asc(invoiceItems.lineOrder)),
      this.db.select().from(invoicePayments).where(and(eq(invoicePayments.invoiceId, invoiceId), eq(invoicePayments.practiceId, practiceId))).orderBy(asc(invoicePayments.receivedAt)),
    ]);
    return { ...invoice, clientName: client?.fullName, clientEmail: client?.email, clientPhone: client?.phone, locationName: location?.name, lines, payments };
  }

  async create(userId: string, practiceId: string, input: InvoiceCreateInput) {
    let linkedAppointment: { locationId: string; status: string } | undefined;
    if (input.appointmentId) {
      const [appointment] = await this.db.select({ id: appointments.id, locationId: appointments.locationId, status: appointments.status }).from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.clientId, input.clientId))).limit(1);
      if (!appointment) throw new BadRequestException('Choose an appointment belonging to this customer and practice');
      if (appointment.status === 'cancelled' || appointment.status === 'no_show') throw new BadRequestException('Cancelled and no-show appointments cannot be invoiced from a session');
      if (input.locationId && input.locationId !== appointment.locationId) throw new BadRequestException('The invoice branch must match the selected appointment branch');
      linkedAppointment = appointment;
    }
    const invoiceLocationId = linkedAppointment?.locationId ?? input.locationId;
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.manage', locationId: invoiceLocationId });
    const [[practice], [client], [profile], [location]] = await Promise.all([
      this.db.select({ name: practices.name, currency: practices.currency }).from(practices).where(eq(practices.id, practiceId)).limit(1),
      this.db.select({ id: clients.id, fullName: clients.fullName, email: clients.email, phone: clients.phone }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.practiceId, practiceId))).limit(1),
      this.db.select().from(billingProfiles).where(eq(billingProfiles.practiceId, practiceId)).limit(1),
      invoiceLocationId ? this.db.select({ id: locations.id, name: locations.name, address: locations.address }).from(locations).where(and(eq(locations.id, invoiceLocationId), eq(locations.practiceId, practiceId))).limit(1) : Promise.resolve([undefined]),
    ]);
    if (!practice || !client) throw new NotFoundException('Practice or customer record not found');
    if (invoiceLocationId && !location) throw new NotFoundException('Invoice location not found in this practice');
    // The practice name is already available as the suggested legal issuer in the UI.
    // Use it for the immutable invoice snapshot unless the owner saved a legal name.
    const legalName = profile?.legalName?.trim() || practice.name;
    const sharedAddress = profile?.address;
    const supplierAddress = sharedAddress?.line1 && sharedAddress.city && sharedAddress.countryCode
      ? sharedAddress
      : location?.address;
    if (!supplierAddress?.line1 || !supplierAddress.city || !supplierAddress.countryCode) {
      throw new BadRequestException('Add a complete supplier address to billing settings before issuing an invoice');
    }
    if (input.taxMode !== 'none' && supplierAddress.countryCode.toUpperCase() === 'IN' && !profile?.gstin) {
      throw new BadRequestException('A GSTIN is required before charging GST on an Indian invoice');
    }
    const rawLines = input.lines.map((line) => {
      const lineTotalMinor = Math.round(line.quantityMilli * line.unitPriceMinor / 1000);
      return { ...line, lineTotalMinor };
    });
    const subtotalMinor = rawLines.reduce((total, line) => total + line.lineTotalMinor, 0);
    if (input.discountMinor > subtotalMinor) throw new BadRequestException('Discount cannot exceed the invoice subtotal');
    const taxableMinor = subtotalMinor - input.discountMinor;
    let discountRemaining = input.discountMinor;
    const lineRows = rawLines.map((line, lineOrder) => {
      const allocatedDiscount = lineOrder === rawLines.length - 1
        ? discountRemaining
        : subtotalMinor ? Math.floor(input.discountMinor * line.lineTotalMinor / subtotalMinor) : 0;
      discountRemaining -= allocatedDiscount;
      return { ...line, lineOrder, taxRateBps: input.taxRateBps, taxMinor: Math.round((line.lineTotalMinor - allocatedDiscount) * input.taxRateBps / 10000) };
    });
    const taxMinor = lineRows.reduce((total, line) => total + line.taxMinor, 0);
    const centralTaxMinor = input.taxMode === 'cgst_sgst' ? Math.floor(taxMinor / 2) : 0;
    const stateTaxMinor = input.taxMode === 'cgst_sgst' ? taxMinor - centralTaxMinor : 0;
    const integratedTaxMinor = input.taxMode === 'igst' ? taxMinor : 0;
    const totalMinor = taxableMinor + taxMinor;
    if ([subtotalMinor, taxMinor, totalMinor].some((amount) => amount > MAX_AMOUNT_MINOR)) throw new BadRequestException('Invoice total is too large');

    const supplierSnapshot = {
      name: legalName, gstin: profile?.gstin ?? null, email: profile?.email ?? null, phone: profile?.phone ?? null,
      address: JSON.stringify(supplierAddress), location: location?.name ?? null,
    };
    const recipientSnapshot = {
      name: client.fullName, email: client.email, phone: client.phone, gstin: input.recipientGstin ?? null,
      address: input.recipientAddress ? JSON.stringify(input.recipientAddress) : null,
    };
    return this.db.transaction(async (tx) => {
      if (input.appointmentId) {
        // Serialize invoice creation for this session so concurrent requests cannot
        // both pass the "not invoiced" check and issue duplicate documents.
        await tx.execute(sql`select id from appointments where id = ${input.appointmentId}::uuid and practice_id = ${practiceId}::uuid for update`);
        const [existingInvoice] = await tx.select({ id: invoices.id }).from(invoices)
          .where(and(eq(invoices.practiceId, practiceId), eq(invoices.appointmentId, input.appointmentId))).limit(1);
        if (existingInvoice) throw new BadRequestException('This session already has an invoice. Choose another session or create a manual document.');
      }
      const startYear = Number(input.issueDate.slice(0, 4)) - (Number(input.issueDate.slice(5, 7)) < 4 ? 1 : 0);
      const financialYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
      const [sequence] = await tx.insert(invoiceSequences).values({ practiceId, financialYear, lastNumber: 1 })
        .onConflictDoUpdate({
          target: [invoiceSequences.practiceId, invoiceSequences.financialYear],
          set: { lastNumber: sql`${invoiceSequences.lastNumber} + 1` },
        }).returning({ lastNumber: invoiceSequences.lastNumber });
      const invoiceNumber = `${profile?.invoicePrefix || 'INV'}/${financialYear}/${String(sequence.lastNumber).padStart(4, '0')}`;
      const [invoice] = await tx.insert(invoices).values({
        practiceId, clientId: input.clientId, appointmentId: input.appointmentId ?? null, locationId: invoiceLocationId ?? null,
        invoiceNumber, kind: input.kind, currency: practice.currency, issueDate: input.issueDate,
        dueDate: input.dueDate ?? null, supplierSnapshot, recipientSnapshot, placeOfSupply: input.placeOfSupply ?? null,
        sacCode: input.sacCode ?? null, taxMode: input.taxMode, subtotalMinor, discountMinor: input.discountMinor,
        taxMinor, centralTaxMinor, stateTaxMinor, integratedTaxMinor, totalMinor, notes: input.notes ?? null, issuedByUserId: userId,
      }).returning();
      await tx.insert(invoiceItems).values(lineRows.map((line) => ({
        practiceId, invoiceId: invoice.id, description: line.description, sacCode: line.sacCode ?? input.sacCode ?? null,
        quantityMilli: line.quantityMilli, unitPriceMinor: line.unitPriceMinor, lineTotalMinor: line.lineTotalMinor,
        taxRateBps: line.taxRateBps, taxMinor: line.taxMinor, lineOrder: line.lineOrder,
      })));
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'invoice.issued', entityType: 'invoice', entityId: invoice.id, metadata: { invoiceNumber, totalMinor } });
      return { ...invoice, lines: lineRows };
    });
  }

  async recordPayment(userId: string, practiceId: string, invoiceId: string, input: InvoicePaymentInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.manage' });
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from invoices where id = ${invoiceId}::uuid and practice_id = ${practiceId}::uuid for update`);
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.practiceId, practiceId))).limit(1);
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'void') throw new BadRequestException('A void invoice cannot receive payment');
      if (input.amountMinor > invoice.totalMinor - invoice.amountPaidMinor) throw new BadRequestException('Payment exceeds the outstanding balance');
      await tx.insert(invoicePayments).values({ practiceId, invoiceId, amountMinor: input.amountMinor, method: input.method, reference: input.reference ?? null, recordedByUserId: userId });
      const amountPaidMinor = invoice.amountPaidMinor + input.amountMinor;
      const status = amountPaidMinor === invoice.totalMinor ? 'paid' : 'partially_paid';
      const [updated] = await tx.update(invoices).set({ amountPaidMinor, status, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.practiceId, practiceId))).returning();
      await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'invoice.payment_recorded', entityType: 'invoice', entityId: invoiceId, metadata: { amountMinor: input.amountMinor, method: input.method } });
      return updated;
    });
  }

  async void(userId: string, practiceId: string, invoiceId: string, input: InvoiceVoidInput) {
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'billing.manage' });
    const [invoice] = await this.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.practiceId, practiceId))).limit(1);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.amountPaidMinor > 0) throw new ForbiddenException('An invoice with recorded payments must be adjusted using a credit note workflow');
    if (invoice.status === 'void') throw new BadRequestException('Invoice is already void');
    const [updated] = await this.db.update(invoices).set({ status: 'void', voidedAt: new Date(), voidReason: input.reason, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.practiceId, practiceId))).returning();
    await this.db.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'invoice.voided', entityType: 'invoice', entityId: invoiceId, metadata: { invoiceNumber: invoice.invoiceNumber, reason: input.reason } });
    return updated;
  }
}
