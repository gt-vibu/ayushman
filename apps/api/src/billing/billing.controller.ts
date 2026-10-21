import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingAppointmentQuery, BillingProfileInput, InvoiceCreateInput, InvoicePaymentInput, InvoiceVoidInput } from '@ayushman-v2/contracts';
import type { BillingAppointmentQuery as BillingAppointmentPayload, BillingProfileInput as BillingProfilePayload, InvoiceCreateInput as InvoiceCreatePayload, InvoicePaymentInput as InvoicePaymentPayload, InvoiceVoidInput as InvoiceVoidPayload } from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

@Controller('practices/:practiceId/billing')
@UseGuards(SessionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('profile')
  profile(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string) {
    return this.billing.profile(req.user.id, practiceId);
  }

  @Patch('profile')
  updateProfile(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Body(new ZodValidationPipe(BillingProfileInput)) body: BillingProfilePayload) {
    return this.billing.updateProfile(req.user.id, practiceId, body);
  }

  @Get('invoices')
  list(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string) {
    return this.billing.list(req.user.id, practiceId);
  }

  @Get('appointments')
  appointmentOptions(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Query(new ZodValidationPipe(BillingAppointmentQuery)) query: BillingAppointmentPayload) {
    return this.billing.appointmentOptions(req.user.id, practiceId, query);
  }

  @Post('invoices')
  create(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Body(new ZodValidationPipe(InvoiceCreateInput)) body: InvoiceCreatePayload) {
    return this.billing.create(req.user.id, practiceId, body);
  }

  @Get('invoices/:invoiceId')
  get(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('invoiceId') invoiceId: string) {
    return this.billing.get(req.user.id, practiceId, invoiceId);
  }

  @Post('invoices/:invoiceId/payments')
  recordPayment(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Param('invoiceId') invoiceId: string, @Body(new ZodValidationPipe(InvoicePaymentInput)) body: InvoicePaymentPayload) {
    return this.billing.recordPayment(req.user.id, practiceId, invoiceId, body);
  }

  @Post('invoices/:invoiceId/void')
  void(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Param('invoiceId') invoiceId: string, @Body(new ZodValidationPipe(InvoiceVoidInput)) body: InvoiceVoidPayload) {
    return this.billing.void(req.user.id, practiceId, invoiceId, body);
  }
}
