import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from '@ayushman-v2/db';
import { platformMembershipRoles, platformMemberships, practiceMemberships, users } from '@ayushman-v2/db/schema';
import { sql } from '@ayushman-v2/db/drizzle';
import argon2 from 'argon2';

const envFile = resolve(process.cwd(), '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPERADMIN_PASSWORD;
const fullName = process.env.SUPERADMIN_FULL_NAME?.trim() || 'Platform Administrator';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!email || !password || password.length < 12 || password.length > 128) {
  throw new Error('Set SUPERADMIN_EMAIL and a 12–128 character SUPERADMIN_PASSWORD before running this script.');
}

const connection = createDatabase(process.env.DATABASE_URL);
try {
  const result = await connection.db.transaction(async (tx) => {
    let [user] = await tx.select({ id: users.id, disabledAt: users.disabledAt }).from(users)
      .where(sql`lower(${users.email}) = ${email}`).limit(1);
    let accountCreated = false;
    if (user?.disabledAt) throw new Error('The account exists but is disabled; enable it through the account recovery process.');
    if (user) {
      const [practiceMembership] = await tx.select({ id: practiceMemberships.id }).from(practiceMemberships)
        .where(sql`${practiceMemberships.userId} = ${user.id} AND ${practiceMemberships.status} = 'active'`).limit(1);
      if (practiceMembership) throw new Error('Platform accounts must not have active practice memberships. Use a separate account for organization access.');
    }
    if (!user) {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const [created] = await tx.insert(users).values({ email, fullName, passwordHash }).returning({ id: users.id });
      user = { id: created.id, disabledAt: null };
      accountCreated = true;
    }
    const [membership] = await tx.insert(platformMemberships).values({ userId: user.id, status: 'active' })
      .onConflictDoUpdate({ target: platformMemberships.userId, set: { status: 'active', updatedAt: new Date() } })
      .returning({ id: platformMemberships.id });
    await tx.insert(platformMembershipRoles).values({ membershipId: membership.id, role: 'superadmin' }).onConflictDoNothing();
    return { accountCreated, email };
  });
  console.log(JSON.stringify({ ...result, role: 'superadmin' }));
} finally {
  await connection.close();
}
