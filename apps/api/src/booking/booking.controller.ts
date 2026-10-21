import { Body, Controller, Delete, Get, Headers, Ip, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest, CustomerAuthenticatedRequest } from '../auth/session.guard.js';
import { CustomerSessionGuard, SessionGuard } from '../auth/session.guard.js';
import {
  AvailabilityBatchInput, AvailabilityExceptionInput, AvailabilityExceptionQuery, BookingPolicyInput, LocationScopeQuery,
  AppointmentListQuery, AppointmentStatusInput, AppointmentRescheduleInput, BulkRescheduleOptionsInput, BulkAppointmentRescheduleInput, CustomerAppointmentCancelInput, ClientListQuery, CreateFollowUpInput, ProfessionalScheduleInput, PublicAvailabilityQuery, PublicBookingHoldInput, PublicBookingInput, PublicDirectoryQuery,
  type AvailabilityBatchInput as AvailabilityBatchPayload, type AvailabilityExceptionInput as AvailabilityExceptionPayload,
  type AvailabilityExceptionQuery as AvailabilityExceptionQueryPayload,
  type AppointmentListQuery as AppointmentListPayload, type AppointmentStatusInput as AppointmentStatusPayload,
  type AppointmentRescheduleInput as AppointmentReschedulePayload, type CustomerAppointmentCancelInput as CustomerAppointmentCancelPayload,
  type BulkRescheduleOptionsInput as BulkRescheduleOptionsPayload, type BulkAppointmentRescheduleInput as BulkAppointmentReschedulePayload,
  type CreateFollowUpInput as CreateFollowUpPayload,
  type ClientListQuery as ClientListPayload,
  type BookingPolicyInput as BookingPolicyPayload, type LocationScopeQuery as LocationScopePayload,
  type PublicAvailabilityQuery as PublicAvailabilityPayload, type PublicBookingHoldInput as PublicBookingHoldPayload, type PublicBookingInput as PublicBookingPayload,
  type PublicDirectoryQuery as PublicDirectoryPayload,
  type ProfessionalScheduleInput as ProfessionalSchedulePayload,
} from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { AvailabilitySetupService } from './availability-setup.service.js';
import { BookingService } from './booking.service.js';
import { AppointmentManagementService } from './appointment-management.service.js';

@Controller()
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly setup: AvailabilitySetupService,
    private readonly appointments: AppointmentManagementService,
  ) {}

  @Get('practices/:practiceId/appointments')
  @UseGuards(SessionGuard)
  listAppointments(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(AppointmentListQuery)) query: AppointmentListPayload) {
    return this.appointments.list(req.user.id, practiceId, query);
  }

  @Get('practices/:practiceId/notifications')
  @UseGuards(SessionGuard)
  listNotifications(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string) {
    return this.appointments.listNotifications(req.user.id, practiceId);
  }

  @Post('practices/:practiceId/notifications/:notificationId/read')
  @UseGuards(SessionGuard)
  markNotificationRead(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('notificationId') notificationId: string) {
    return this.appointments.markNotificationRead(req.user.id, practiceId, notificationId);
  }

  @Post('practices/:practiceId/appointments/follow-up')
  @UseGuards(SessionGuard)
  createFollowUp(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(CreateFollowUpInput)) body: CreateFollowUpPayload) {
    return this.appointments.createFollowUp(req.user.id, practiceId, body);
  }

  @Get('practices/:practiceId/appointments/follow-up-availability')
  @UseGuards(SessionGuard)
  followUpAvailability(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(PublicAvailabilityQuery)) query: PublicAvailabilityPayload) {
    return this.appointments.followUpAvailability(req.user.id, practiceId, query);
  }

  @Post('practices/:practiceId/appointments/:appointmentId/status')
  @UseGuards(SessionGuard)
  updateAppointmentStatus(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('appointmentId') appointmentId: string, @Body(new ZodValidationPipe(AppointmentStatusInput)) body: AppointmentStatusPayload) {
    return this.appointments.updateStatus(req.user.id, practiceId, appointmentId, body);
  }

  @Post('practices/:practiceId/appointments/:appointmentId/reschedule')
  @UseGuards(SessionGuard)
  rescheduleAppointment(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('appointmentId') appointmentId: string, @Body(new ZodValidationPipe(AppointmentRescheduleInput)) body: AppointmentReschedulePayload) {
    return this.appointments.practitionerReschedule(req.user.id, practiceId, appointmentId, body.startsAt);
  }

  @Post('practices/:practiceId/appointments/bulk-reschedule-options')
  @UseGuards(SessionGuard)
  bulkRescheduleOptions(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(BulkRescheduleOptionsInput)) body: BulkRescheduleOptionsPayload) {
    return this.appointments.bulkRescheduleOptions(req.user.id, practiceId, body);
  }

  @Post('practices/:practiceId/appointments/bulk-reschedule')
  @UseGuards(SessionGuard)
  bulkReschedule(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(BulkAppointmentRescheduleInput)) body: BulkAppointmentReschedulePayload) {
    return this.appointments.bulkReschedule(req.user.id, practiceId, body);
  }

  @Get('practices/:practiceId/appointments/:appointmentId/reschedule-availability')
  @UseGuards(SessionGuard)
  rescheduleAvailability(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('appointmentId') appointmentId: string, @Query(new ZodValidationPipe(PublicAvailabilityQuery)) query: PublicAvailabilityPayload) {
    return this.appointments.practitionerAvailability(req.user.id, practiceId, appointmentId, query);
  }

  @Get('customer/me/appointments/:appointmentId/availability')
  @UseGuards(CustomerSessionGuard)
  customerRescheduleAvailability(@Req() req: CustomerAuthenticatedRequest, @Param('appointmentId') appointmentId: string, @Query(new ZodValidationPipe(PublicAvailabilityQuery)) query: PublicAvailabilityPayload) {
    return this.appointments.customerAvailability(req.user.id, appointmentId, query);
  }

  @Post('customer/me/appointments/:appointmentId/reschedule')
  @UseGuards(CustomerSessionGuard)
  customerReschedule(@Req() req: CustomerAuthenticatedRequest, @Param('appointmentId') appointmentId: string, @Body(new ZodValidationPipe(AppointmentRescheduleInput)) body: AppointmentReschedulePayload) {
    return this.appointments.customerReschedule(req.user.id, appointmentId, body.startsAt);
  }

  @Post('customer/me/appointments/:appointmentId/cancel')
  @UseGuards(CustomerSessionGuard)
  customerCancel(@Req() req: CustomerAuthenticatedRequest, @Param('appointmentId') appointmentId: string, @Body(new ZodValidationPipe(CustomerAppointmentCancelInput)) body: CustomerAppointmentCancelPayload) {
    return this.appointments.customerCancel(req.user.id, appointmentId, body.reason);
  }

  @Get('practices/:practiceId/clients')
  @UseGuards(SessionGuard)
  listClients(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(ClientListQuery)) query: ClientListPayload) {
    return this.appointments.listClients(req.user.id, practiceId, query);
  }

  @Get('practices/:practiceId/availability/rules')
  @UseGuards(SessionGuard)
  listRules(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(LocationScopeQuery)) query: LocationScopePayload) {
    return this.setup.listRules(req.user.id, practiceId, query.locationId);
  }

  @Post('practices/:practiceId/availability/rules')
  @UseGuards(SessionGuard)
  addRules(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(AvailabilityBatchInput)) body: AvailabilityBatchPayload) {
    return this.setup.addRules(req.user.id, practiceId, body);
  }

  @Put('practices/:practiceId/availability/professional-schedule')
  @UseGuards(SessionGuard)
  replaceProfessionalSchedule(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(ProfessionalScheduleInput)) body: ProfessionalSchedulePayload) {
    return this.setup.replaceProfessionalSchedule(req.user.id, practiceId, body);
  }

  @Delete('practices/:practiceId/availability/rules/:ruleId')
  @UseGuards(SessionGuard)
  deleteRule(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('ruleId') ruleId: string) {
    return this.setup.deleteRule(req.user.id, practiceId, ruleId);
  }

  @Post('practices/:practiceId/availability/exceptions')
  @UseGuards(SessionGuard)
  addException(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(AvailabilityExceptionInput)) body: AvailabilityExceptionPayload) {
    return this.setup.addException(req.user.id, practiceId, body);
  }

  @Get('practices/:practiceId/availability/exceptions')
  @UseGuards(SessionGuard)
  listExceptions(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(AvailabilityExceptionQuery)) query: AvailabilityExceptionQueryPayload) {
    return this.setup.listExceptions(req.user.id, practiceId, query);
  }

  @Delete('practices/:practiceId/availability/exceptions/:exceptionId')
  @UseGuards(SessionGuard)
  deleteException(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('exceptionId') exceptionId: string) {
    return this.setup.deleteException(req.user.id, practiceId, exceptionId);
  }

  @Get('practices/:practiceId/booking-policy')
  @UseGuards(SessionGuard)
  getPolicy(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string) {
    return this.setup.getPolicy(req.user.id, practiceId);
  }

  @Post('practices/:practiceId/booking-policy')
  @UseGuards(SessionGuard)
  updatePolicy(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(BookingPolicyInput)) body: BookingPolicyPayload) {
    return this.setup.updatePolicy(req.user.id, practiceId, body);
  }

  @Get('public/practices/:practiceId/availability')
  async slots(@Param('practiceId') practiceId: string, @Query(new ZodValidationPipe(PublicAvailabilityQuery)) query: PublicAvailabilityPayload, @Ip() ip: string) {
    await this.booking.limitPublicRequest(ip);
    return this.booking.availableSlots(practiceId, query);
  }

  @Get('public/directory')
  async directory(@Query(new ZodValidationPipe(PublicDirectoryQuery)) query: PublicDirectoryPayload, @Ip() ip: string) {
    await this.booking.limitPublicRequest(ip);
    return this.booking.searchDirectory(query);
  }

  @Get('public/practices/:practiceId')
  async publicPractice(@Param('practiceId') practiceId: string, @Ip() ip: string) {
    await this.booking.limitPublicRequest(ip);
    return this.booking.publicPractice(practiceId);
  }

  @Post('public/practices/:practiceId/bookings')
  @UseGuards(CustomerSessionGuard)
  async createBooking(
    @Req() req: CustomerAuthenticatedRequest,
    @Param('practiceId') practiceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(PublicBookingInput)) body: PublicBookingPayload,
    @Ip() ip: string,
  ) {
    await this.booking.limitPublicRequest(ip);
    return this.booking.createPublicBooking(practiceId, req.user.id, key, body);
  }

  @Post('public/practices/:practiceId/booking-holds')
  @UseGuards(CustomerSessionGuard)
  async createBookingHold(
    @Req() req: CustomerAuthenticatedRequest,
    @Param('practiceId') practiceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(PublicBookingHoldInput)) body: PublicBookingHoldPayload,
    @Ip() ip: string,
  ) {
    await this.booking.limitPublicRequest(ip);
    return this.booking.createBookingHold(practiceId, req.user.id, key, body);
  }

  @Delete('public/practices/:practiceId/booking-holds/:holdId')
  @UseGuards(CustomerSessionGuard)
  releaseBookingHold(@Req() req: CustomerAuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('holdId') holdId: string) {
    return this.booking.releaseBookingHold(practiceId, req.user.id, holdId);
  }
}
