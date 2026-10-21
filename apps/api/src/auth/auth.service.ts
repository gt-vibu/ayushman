import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from '@ayushman-v2/db/drizzle';
import * as argon2 from 'argon2';
import type { Database } from '@ayushman-v2/db';
import { bookingPolicies, customerProfiles, platformMembershipRoles, platformMemberships, practiceMembershipRoles, practiceMemberships, practices, sessions, users } from '@ayushman-v2/db/schema';
import type { ChangePasswordInput, CustomerRegistrationInput, LoginInput, RegistrationInput } from '@ayushman-v2/contracts';
import { DATABASE } from '../database.module.js';
import { readEnvironment } from '../config.js';
import { REDIS, type RedisStore } from '../redis.module.js';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email: string): string => email.trim().toLocaleLowerCase('en-US');

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(REDIS) private readonly redis: RedisStore) {}

  async limitAuthentication(ip: string): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const countKey = `ayushman:v2:auth:${ip}:${minute}`;
    const count = await this.redis.incr(countKey);
    if (count === 1) await this.redis.expire(countKey, 75);
    if (count > readEnvironment().AUTH_RATE_LIMIT_PER_MINUTE) {
      throw new HttpException('Too many authentication attempts; wait a minute and try again', 429);
    }
  }

  async register(input: RegistrationInput): Promise<{ user: { id: string; email: string; fullName: string }; token: string; expiresAt: Date; practiceId: string }> {
    const email = normalizeEmail(input.email);
    const existing = await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (existing.length) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60 * 1000);
    const slugBase = input.practice.name.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'practice';

    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email, fullName: input.fullName, passwordHash }).returning({ id: users.id, email: users.email, fullName: users.fullName });
      const [practice] = await tx.insert(practices).values({
        name: input.practice.name,
        slug: `${slugBase}-${randomBytes(4).toString('hex')}`,
        timezone: input.practice.timezone,
        currency: input.practice.currency.toUpperCase(),
      }).returning({ id: practices.id });
      const [membership] = await tx.insert(practiceMemberships).values({ practiceId: practice.id, userId: user.id }).returning({ id: practiceMemberships.id });
      await tx.insert(practiceMembershipRoles).values({ membershipId: membership.id, role: 'owner' });
      await tx.insert(bookingPolicies).values({ practiceId: practice.id });
      await tx.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
      return { user, practiceId: practice.id };
    });

    return { ...result, token, expiresAt };
  }

  async registerCustomer(input: CustomerRegistrationInput): Promise<{ user: { id: string; email: string; fullName: string }; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const [existing] = await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60 * 1000);
    try {
      const user = await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(users).values({ email, fullName: input.fullName, passwordHash })
          .returning({ id: users.id, email: users.email, fullName: users.fullName });
        await tx.insert(customerProfiles).values({ userId: created.id, phone: input.phone ?? null });
        await tx.insert(sessions).values({ userId: created.id, tokenHash: hashToken(token), expiresAt });
        return created;
      });
      return { user, token, expiresAt };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ConflictException('An account with this email already exists. Sign in instead.');
      }
      throw error;
    }
  }

  async loginCustomer(input: LoginInput): Promise<{ user: { id: string; email: string; fullName: string }; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const [user] = await this.db.select({
      id: users.id, email: users.email, fullName: users.fullName, passwordHash: users.passwordHash,
    }).from(users).innerJoin(customerProfiles, eq(customerProfiles.userId, users.id))
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt))).limit(1);
    const valid = user ? await argon2.verify(user.passwordHash, input.password).catch(() => false) : false;
    if (!user || !valid) throw new UnauthorizedException('Customer email or password is incorrect');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
    return { user: { id: user.id, email: user.email, fullName: user.fullName }, token, expiresAt };
  }

  async customerProfile(userId: string) {
    const [profile] = await this.db.select({ userId: users.id, fullName: users.fullName, email: users.email, phone: customerProfiles.phone })
      .from(customerProfiles).innerJoin(users, eq(users.id, customerProfiles.userId))
      .where(and(eq(customerProfiles.userId, userId), isNull(users.disabledAt))).limit(1);
    if (!profile) throw new UnauthorizedException('Customer account required');
    return profile;
  }

  async login(input: LoginInput): Promise<{ user: { id: string; email: string; fullName: string }; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const [user] = await this.db.select({
      id: users.id, email: users.email, fullName: users.fullName, passwordHash: users.passwordHash,
    }).from(users).where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt))).limit(1);
    const valid = user ? await argon2.verify(user.passwordHash, input.password).catch(() => false) : false;
    if (!user || !valid) throw new UnauthorizedException('Email or password is incorrect');

    const [[customerAccount], [platformAccount]] = await Promise.all([
      this.db.select({ userId: customerProfiles.userId }).from(customerProfiles)
        .where(eq(customerProfiles.userId, user.id)).limit(1),
      this.db.select({ id: platformMemberships.id }).from(platformMemberships)
        .where(and(eq(platformMemberships.userId, user.id), eq(platformMemberships.status, 'active'))).limit(1),
    ]);
    if (customerAccount) throw new UnauthorizedException('Use the customer sign-in page');
    if (platformAccount) throw new UnauthorizedException('Use the platform administrator sign-in');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
    return { user: { id: user.id, email: user.email, fullName: user.fullName }, token, expiresAt };
  }

  async platformLogin(input: LoginInput): Promise<{ user: { id: string; email: string; fullName: string }; roles: string[]; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const [user] = await this.db.select({
      id: users.id, email: users.email, fullName: users.fullName, passwordHash: users.passwordHash,
    }).from(users)
      .innerJoin(platformMemberships, and(eq(platformMemberships.userId, users.id), eq(platformMemberships.status, 'active')))
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt)))
      .limit(1);
    const valid = user ? await argon2.verify(user.passwordHash, input.password).catch(() => false) : false;
    if (!user || !valid) throw new UnauthorizedException('Email or password is incorrect');
    const [organizationMembership] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.userId, user.id), eq(practiceMemberships.status, 'active'))).limit(1);
    if (organizationMembership) throw new UnauthorizedException('Platform accounts cannot have active practice memberships');

    const roles = await this.platformRoles(user.id);
    if (roles.length === 0) throw new UnauthorizedException('Platform role is required');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + readEnvironment().SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
    return { user: { id: user.id, email: user.email, fullName: user.fullName }, roles, token, expiresAt };
  }

  async logout(token?: string): Promise<void> {
    if (!token) return;
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
  }

  async changePassword(userId: string, currentToken: string | undefined, input: ChangePasswordInput): Promise<void> {
    const [user] = await this.db.select({ passwordHash: users.passwordHash }).from(users)
      .where(and(eq(users.id, userId), isNull(users.disabledAt))).limit(1);
    const valid = user ? await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false) : false;
    if (!user || !valid) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const currentTokenHash = currentToken ? hashToken(currentToken) : '';
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
      const activeSessions = and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(currentTokenHash
        ? and(activeSessions, ne(sessions.tokenHash, currentTokenHash))
        : activeSessions);
    });
  }

  async authenticate(token: string): Promise<{ id: string; email: string; fullName: string }> {
    const [session] = await this.db.select({
      id: users.id, email: users.email, fullName: users.fullName,
    }).from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt), isNull(users.disabledAt),
        sql`NOT EXISTS (SELECT 1 FROM platform_memberships pm WHERE pm.user_id = ${users.id} AND pm.status = 'active')`))
      .limit(1);
    if (!session) throw new UnauthorizedException('Sign in to continue');
    return session;
  }

  async authenticatePlatform(token: string): Promise<{ id: string; email: string; fullName: string; roles: string[] }> {
    const [user] = await this.db.select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(platformMemberships, and(eq(platformMemberships.userId, users.id), eq(platformMemberships.status, 'active')))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt), isNull(users.disabledAt),
        sql`NOT EXISTS (SELECT 1 FROM practice_memberships pm WHERE pm.user_id = ${users.id} AND pm.status = 'active')`))
      .limit(1);
    if (!user) throw new UnauthorizedException('Sign in to the platform admin app');
    const roles = await this.platformRoles(user.id);
    if (!roles.length) throw new UnauthorizedException('Platform role is required');
    return { ...user, roles };
  }

  private async platformRoles(userId: string): Promise<string[]> {
    const rows = await this.db.select({ role: platformMembershipRoles.role })
      .from(platformMembershipRoles).innerJoin(platformMemberships, eq(platformMemberships.id, platformMembershipRoles.membershipId))
      .where(and(eq(platformMemberships.userId, userId), eq(platformMemberships.status, 'active')));
    return rows.map((row) => row.role);
  }

  async memberships(userId: string) {
    const rows = await this.db.select({
      practiceId: practices.id, practiceName: practices.name, practiceSlug: practices.slug,
      role: practiceMembershipRoles.role,
    }).from(practiceMemberships)
      .innerJoin(practices, eq(practiceMemberships.practiceId, practices.id))
      .innerJoin(practiceMembershipRoles, eq(practiceMembershipRoles.membershipId, practiceMemberships.id))
      .where(and(eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active'), eq(practices.active, true)));
    const membershipMap = new Map<string, { practiceId: string; practiceName: string; practiceSlug: string; roles: string[] }>();
    for (const row of rows) {
      const existing = membershipMap.get(row.practiceId) ?? {
        practiceId: row.practiceId,
        practiceName: row.practiceName,
        practiceSlug: row.practiceSlug,
        roles: [],
      };
      existing.roles.push(row.role);
      membershipMap.set(row.practiceId, existing);
    }
    return [...membershipMap.values()];
  }
}
