import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { AvailabilitySetupService } from './availability-setup.service.js';
import { AppointmentManagementService } from './appointment-management.service.js';

@Module({ imports: [AuthModule], controllers: [BookingController], providers: [BookingService, AvailabilitySetupService, AppointmentManagementService] })
export class BookingModule {}
