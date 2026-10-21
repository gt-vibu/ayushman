import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import {
  locations, practiceMembershipLocations, practiceMembershipRoles, practiceMemberships,
  staffInvitationLocations, staffInvitationRoles, staffInvitations, users,
} from '@ayushman-v2/db/schema';
import type { AcceptExistingStaffInvitationInput, AcceptStaffInvitationInput, StaffInvitationInput } from '@ayushman-v2/contracts';
import * as argon2 from 'argon2';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { readEnvironment } from '../config.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class StaffInvitationsService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService) {}

  async create(actorId: string, practiceId: string, input: StaffInvitationInput) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    if (input.roles.includes('admin') && !await this.isOwner(actorId, practiceId)) {
      throw new ForbiddenException('Only a practice owner can invite an administrator');
    }
    if (input.roles.includes('scheduler') && input.locationIds.length === 0) {
      throw new BadRequestException('Scheduler invitations must include at least one branch');
    }
    const locationIds = await this.validateLocations(practiceId, input.locationIds);
    const email = normalizeEmail(input.email);
    const [account] = await this.db.select({ id: users.id, disabledAt: users.disabledAt }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (account) {
      if (account.disabledAt) throw new ConflictException('This email belongs to a disabled account and cannot accept an invitation');
      const [membership] = await this.db.select({ id: practiceMemberships.id }).from(practiceMemberships)
        .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, account.id))).limit(1);
      if (membership) throw new ConflictException('This person is already a member; update their existing staff access');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const invitation = await this.db.transaction(async (tx) => {
      await tx.update(staffInvitations).set({ revokedAt: new Date() }).where(and(
        eq(staffInvitations.practiceId, practiceId), sql`lower(${staffInvitations.email}) = ${email}`,
        isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt),
      ));
      const [created] = await tx.insert(staffInvitations).values({
        practiceId, email, tokenHash: hashToken(token), invitedByUserId: actorId, expiresAt,
      }).returning({ id: staffInvitations.id, email: staffInvitations.email, expiresAt: staffInvitations.expiresAt });
      await tx.insert(staffInvitationRoles).values(input.roles.map((role) => ({ invitationId: created.id, role })));
      if (locationIds.length) await tx.insert(staffInvitationLocations).values(locationIds.map((locationId) => ({ practiceId, invitationId: created.id, locationId })));
      return created;
    });
    return {
      ...invitation,
      acceptanceUrl: `${readEnvironment().WEB_ORIGIN.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(token)}`,
    };
  }

  async acceptNew(input: AcceptStaffInvitationInput) {
    const invitation = await this.loadActiveInvitation(input.token);
    const [existingUser] = await this.db.select({ id: users.id }).from(users)
      .where(sql`lower(${users.email}) = ${invitation.email}`).limit(1);
    if (existingUser) throw new ConflictException('An account already exists for this email. Sign in and accept the invitation with that account.');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    return this.db.transaction(async (tx) => {
      const accepted = await this.claimInvitation(tx, invitation.id);
      const [user] = await tx.insert(users).values({ email: invitation.email, fullName: input.fullName, passwordHash })
        .returning({ id: users.id, email: users.email, fullName: users.fullName });
      const membershipId = await this.attachMembership(tx, accepted.id, invitation.practiceId, user.id);
      return { user, practiceId: invitation.practiceId, membershipId };
    });
  }

  async acceptExisting(userId: string, email: string, input: AcceptExistingStaffInvitationInput) {
    const invitation = await this.loadActiveInvitation(input.token);
    if (normalizeEmail(email) !== invitation.email) throw new ForbiddenException('Invitation email does not match the signed-in account');
    return this.db.transaction(async (tx) => {
      const accepted = await this.claimInvitation(tx, invitation.id);
      const membershipId = await this.attachMembership(tx, accepted.id, invitation.practiceId, userId);
      return { practiceId: invitation.practiceId, membershipId };
    });
  }

  async revoke(actorId: string, practiceId: string, invitationId: string) {
    await this.authorization.assertPermission({ userId: actorId, practiceId, permissionCode: 'staff.manage' });
    const [invitation] = await this.db.update(staffInvitations).set({ revokedAt: new Date() }).where(and(
      eq(staffInvitations.id, invitationId), eq(staffInvitations.practiceId, practiceId),
      isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt),
    )).returning({ id: staffInvitations.id });
    if (!invitation) throw new NotFoundException('Pending invitation not found');
    return { revoked: true };
  }

  private async loadActiveInvitation(token: string) {
    const [invitation] = await this.db.select({
      id: staffInvitations.id, practiceId: staffInvitations.practiceId, email: staffInvitations.email,
    }).from(staffInvitations).where(and(
      eq(staffInvitations.tokenHash, hashToken(token)), gt(staffInvitations.expiresAt, new Date()),
      isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt),
    )).limit(1);
    if (!invitation) throw new NotFoundException('Invitation is invalid, expired, or already used');
    return invitation;
  }

  private async claimInvitation(tx: Database, invitationId: string) {
    const [claimed] = await tx.update(staffInvitations).set({ acceptedAt: new Date() }).where(and(
      eq(staffInvitations.id, invitationId), gt(staffInvitations.expiresAt, new Date()),
      isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt),
    )).returning({ id: staffInvitations.id });
    if (!claimed) throw new ConflictException('Invitation was already accepted or revoked');
    return claimed;
  }

  private async attachMembership(tx: Database, invitationId: string, practiceId: string, userId: string): Promise<string> {
    const [existing] = await tx.select({ id: practiceMemberships.id }).from(practiceMemberships)
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId))).limit(1);
    if (existing) throw new ConflictException('This account already belongs to the practice');
    const [membership] = await tx.insert(practiceMemberships).values({ practiceId, userId }).returning({ id: practiceMemberships.id });
    const roles = await tx.select({ role: staffInvitationRoles.role }).from(staffInvitationRoles)
      .where(eq(staffInvitationRoles.invitationId, invitationId));
    await tx.insert(practiceMembershipRoles).values(roles.map((role) => ({ membershipId: membership.id, role: role.role })));
    const assignments = await tx.select({ locationId: staffInvitationLocations.locationId }).from(staffInvitationLocations)
      .where(eq(staffInvitationLocations.invitationId, invitationId));
    if (assignments.length) await tx.insert(practiceMembershipLocations).values(assignments.map(({ locationId }) => ({ practiceId, membershipId: membership.id, locationId })));
    return membership.id;
  }

  private async validateLocations(practiceId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('Branch assignment contains duplicates');
    if (!unique.length) return [];
    const rows = await this.db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.practiceId, practiceId), sql`${locations.id} IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})`));
    if (rows.length !== unique.length) throw new BadRequestException('A selected branch is outside this practice');
    return unique;
  }

  private async isOwner(userId: string, practiceId: string): Promise<boolean> {
    const roles = await this.db.select({ role: practiceMembershipRoles.role }).from(practiceMembershipRoles)
      .innerJoin(practiceMemberships, eq(practiceMemberships.id, practiceMembershipRoles.membershipId))
      .where(and(eq(practiceMemberships.practiceId, practiceId), eq(practiceMemberships.userId, userId), eq(practiceMemberships.status, 'active')));
    return roles.some((row) => row.role === 'owner');
  }
}
