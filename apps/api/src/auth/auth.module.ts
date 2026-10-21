import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CustomerSessionGuard, PlatformSessionGuard, SessionGuard } from './session.guard.js';
import { AuthorizationService } from './authorization.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, CustomerSessionGuard, PlatformSessionGuard, AuthorizationService],
  exports: [AuthService, SessionGuard, CustomerSessionGuard, PlatformSessionGuard, AuthorizationService],
})
export class AuthModule {}
