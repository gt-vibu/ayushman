import { and, eq, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { serviceLocations, serviceProfessionals, services } from '@ayushman-v2/db/schema';
import { AuthorizationService } from '../auth/authorization.service.js';

export async function listPracticeServices(db: Database, authorization: AuthorizationService, userId: string, practiceId: string, locationId?: string) {
  const check = { userId, practiceId, permissionCode: 'services.read', locationId, ownRecordsAreQueryScoped: true } as const;
  await authorization.assertPermission(check);
  const ownScope = await authorization.requiresOwnScope(check);
  const filters = [eq(services.practiceId, practiceId), locationId
    ? sql`exists (select 1 from service_locations sl where sl.service_id = ${services.id} and sl.location_id = ${locationId}::uuid)` : sql`true`];
  if (ownScope) filters.push(sql`exists (select 1 from service_professionals sp where sp.service_id = ${services.id} and sp.professional_user_id = ${userId}::uuid)`);
  const rows = await db.select().from(services).where(and(...filters));
  if (!rows.length) return [];
  const ids = rows.map((service) => service.id);
  const [professionalLinks, locationLinks] = await Promise.all([
    db.select({ serviceId: serviceProfessionals.serviceId, userId: serviceProfessionals.professionalUserId })
      .from(serviceProfessionals).where(and(sql`${serviceProfessionals.serviceId} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`, eq(serviceProfessionals.active, true))),
    db.select({ serviceId: serviceLocations.serviceId, locationId: serviceLocations.locationId })
      .from(serviceLocations).where(and(sql`${serviceLocations.serviceId} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`, eq(serviceLocations.active, true))),
  ]);
  return rows.map((service) => ({
    ...service,
    professionalUserIds: professionalLinks.filter((item) => item.serviceId === service.id).map((item) => item.userId),
    locationIds: locationLinks.filter((item) => item.serviceId === service.id).map((item) => item.locationId),
  }));
}
