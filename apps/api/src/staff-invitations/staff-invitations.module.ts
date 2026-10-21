import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StaffInvitationsController } from './staff-invitations.controller.js';
import { StaffInvitationsService } from './staff-invitations.service.js';

@Module({ imports: [AuthModule], controllers: [StaffInvitationsController], providers: [StaffInvitationsService] })
export class StaffInvitationsModule {}
