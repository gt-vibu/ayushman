import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  AcceptExistingStaffInvitationInput, AcceptStaffInvitationInput, StaffInvitationInput,
  type AcceptExistingStaffInvitationInput as AcceptExistingPayload,
  type AcceptStaffInvitationInput as AcceptNewPayload,
  type StaffInvitationInput as CreateInvitationPayload,
} from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { StaffInvitationsService } from './staff-invitations.service.js';

@Controller()
export class StaffInvitationsController {
  constructor(private readonly invitations: StaffInvitationsService) {}

  @Post('practices/:practiceId/staff/invitations')
  @UseGuards(SessionGuard)
  create(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Body(new ZodValidationPipe(StaffInvitationInput)) body: CreateInvitationPayload) {
    return this.invitations.create(req.user.id, practiceId, body);
  }

  @Delete('practices/:practiceId/staff/invitations/:invitationId')
  @UseGuards(SessionGuard)
  revoke(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('invitationId') invitationId: string) {
    return this.invitations.revoke(req.user.id, practiceId, invitationId);
  }

  @Post('invitations/accept')
  acceptNew(@Body(new ZodValidationPipe(AcceptStaffInvitationInput)) body: AcceptNewPayload) {
    return this.invitations.acceptNew(body);
  }

  @Post('invitations/accept-existing')
  @UseGuards(SessionGuard)
  acceptExisting(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(AcceptExistingStaffInvitationInput)) body: AcceptExistingPayload) {
    return this.invitations.acceptExisting(req.user.id, req.user.email, body);
  }
}
