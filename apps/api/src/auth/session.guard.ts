import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; fullName: string };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.ayushman_session as string | undefined;
    if (!token) throw new UnauthorizedException('Sign in to continue');
    request.user = await this.auth.authenticate(token);
    return true;
  }
}

export interface CustomerAuthenticatedRequest extends Request {
  user: { id: string; email: string; fullName: string };
}

@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerAuthenticatedRequest>();
    const token = request.cookies?.ayushman_customer_session as string | undefined;
    if (!token) throw new UnauthorizedException('Sign in to your customer account');
    request.user = await this.auth.authenticate(token);
    await this.auth.customerProfile(request.user.id);
    return true;
  }
}

export interface PlatformAuthenticatedRequest extends Request {
  user: { id: string; email: string; fullName: string; roles: string[] };
}

@Injectable()
export class PlatformSessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformAuthenticatedRequest>();
    const token = request.cookies?.ayushman_platform_session as string | undefined;
    if (!token) throw new UnauthorizedException('Sign in to the platform admin app');
    request.user = await this.auth.authenticatePlatform(token);
    return true;
  }
}
