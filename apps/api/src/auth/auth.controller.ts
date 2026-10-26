import { Body, Controller, Get, Ip, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChangePasswordInput, CustomerRegistrationInput, LoginInput, RegistrationInput, type ChangePasswordInput as ChangePasswordPayload, type CustomerRegistrationInput as CustomerRegistrationPayload, type LoginInput as LoginPayload, type RegistrationInput as RegistrationPayload } from '@ayushman-v2/contracts';
import { readEnvironment } from '../config.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { PlatformSessionGuard, SessionGuard, type AuthenticatedRequest, type PlatformAuthenticatedRequest } from './session.guard.js';

const COOKIE = 'ayushman_session';
const CUSTOMER_COOKIE = 'ayushman_customer_session';
const PLATFORM_COOKIE = 'ayushman_platform_session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegistrationInput)) input: RegistrationPayload,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    await this.auth.limitAuthentication(ip);
    const result = await this.auth.register(input);
    this.setCookie(response, result.token, result.expiresAt);
    return { user: result.user, practiceId: result.practiceId };
  }

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginInput)) input: LoginPayload,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    await this.auth.limitAuthentication(ip);
    const result = await this.auth.login(input);
    this.setCookie(response, result.token, result.expiresAt);
    return { user: result.user };
  }

  @Post('customer/register')
  async registerCustomer(
    @Body(new ZodValidationPipe(CustomerRegistrationInput)) input: CustomerRegistrationPayload,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    await this.auth.limitAuthentication(ip);
    const result = await this.auth.registerCustomer(input);
    this.setCustomerCookie(response, result.token, result.expiresAt);
    return { user: result.user };
  }

  @Post('customer/login')
  async loginCustomer(
    @Body(new ZodValidationPipe(LoginInput)) input: LoginPayload,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    await this.auth.limitAuthentication(ip);
    const result = await this.auth.loginCustomer(input);
    this.setCustomerCookie(response, result.token, result.expiresAt);
    return { user: result.user };
  }

  @Post('customer/logout')
  async logoutCustomer(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[CUSTOMER_COOKIE] as string | undefined);
    response.clearCookie(CUSTOMER_COOKIE, { httpOnly: true, sameSite: 'lax', secure: readEnvironment().NODE_ENV === 'production', path: '/' });
    return { ok: true };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[COOKIE] as string | undefined);
    response.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: readEnvironment().NODE_ENV === 'production', path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return { user: request.user, practices: await this.auth.memberships(request.user.id) };
  }

  @Post('change-password')
  @UseGuards(SessionGuard)
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(ChangePasswordInput)) input: ChangePasswordPayload,
  ) {
    await this.auth.changePassword(request.user.id, request.cookies?.[COOKIE] as string | undefined, input);
    return { ok: true };
  }

  @Get('identity')
  async identity(@Req() request: Request) {
    const customerToken = request.cookies?.[CUSTOMER_COOKIE] as string | undefined;
    if (customerToken) {
      try {
        const user = await this.auth.authenticate(customerToken);
        const customer = await this.auth.customerProfile(user.id);
        return { kind: 'customer' as const, customer: { fullName: customer.fullName, email: customer.email, phone: customer.phone } };
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    const practiceToken = request.cookies?.[COOKIE] as string | undefined;
    if (practiceToken) {
      try {
        await this.auth.authenticate(practiceToken);
        return { kind: 'practice' as const };
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    return { kind: 'signed_out' as const };
  }

  @Post('platform-login')
  async platformLogin(
    @Body(new ZodValidationPipe(LoginInput)) input: LoginPayload,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    await this.auth.limitAuthentication(ip);
    const result = await this.auth.platformLogin(input);
    this.setPlatformCookie(response, result.token, result.expiresAt);
    return { user: { ...result.user, roles: result.roles } };
  }

  @Post('platform-logout')
  async platformLogout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[PLATFORM_COOKIE] as string | undefined);
    response.clearCookie(PLATFORM_COOKIE, { httpOnly: true, sameSite: 'lax', secure: readEnvironment().NODE_ENV === 'production', path: '/' });
    return { ok: true };
  }

  @Get('platform-me')
  @UseGuards(PlatformSessionGuard)
  async platformMe(@Req() request: PlatformAuthenticatedRequest) {
    return { user: request.user };
  }

  private setCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(COOKIE, token, {
      httpOnly: true,
      secure: readEnvironment().NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
  }

  private setPlatformCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(PLATFORM_COOKIE, token, {
      httpOnly: true,
      secure: readEnvironment().NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
  }

  private setCustomerCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(CUSTOMER_COOKIE, token, {
      httpOnly: true,
      secure: readEnvironment().NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
  }
}
