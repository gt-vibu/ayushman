import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { CustomerProfileUpdateInput as CustomerProfileUpdatePayload } from '@ayushman-v2/contracts';
import { CustomerProfileUpdateInput } from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { CustomerSessionGuard, type CustomerAuthenticatedRequest } from '../auth/session.guard.js';
import { CustomerAccountService } from './customer-account.service.js';

@Controller('customer')
@UseGuards(CustomerSessionGuard)
export class CustomerAccountController {
  constructor(private readonly accounts: CustomerAccountService) {}

  @Get('me')
  profile(@Req() request: CustomerAuthenticatedRequest) {
    return this.accounts.profile(request.user.id);
  }

  @Patch('me')
  updateProfile(@Req() request: CustomerAuthenticatedRequest, @Body(new ZodValidationPipe(CustomerProfileUpdateInput)) body: CustomerProfileUpdatePayload) {
    return this.accounts.updateProfile(request.user.id, body);
  }

  @Get('me/records')
  records(@Req() request: CustomerAuthenticatedRequest) {
    return this.accounts.records(request.user.id);
  }

  @Post('me/notifications/:notificationId/read')
  markNoticeRead(@Req() request: CustomerAuthenticatedRequest, @Param('notificationId') notificationId: string) {
    return this.accounts.markAppointmentNoticeRead(request.user.id, notificationId);
  }
}
