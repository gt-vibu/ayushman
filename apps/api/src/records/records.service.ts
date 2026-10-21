import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, auditEvents, clientDocuments, clients, locations } from '@ayushman-v2/db/schema';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { PrivateObjectStorage } from './private-object-storage.service.js';

export const DOCUMENT_CATEGORIES = ['prescription', 'lab_result', 'report', 'referral', 'consent', 'insurance', 'other'] as const;
const MIME_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString() === '%PDF-',
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (bytes) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
};

@Injectable()
export class RecordsService {
  private readonly directory = resolve(process.env.PRIVATE_FILE_STORAGE_DIR || resolve(process.cwd(), '.private-files'));

  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService, private readonly storage: PrivateObjectStorage) {}

  async list(userId: string, practiceId: string, clientId?: string) {
    const permission = await this.authorization.resolvePermission({ userId, practiceId, permissionCode: 'records.read', ownRecordsAreQueryScoped: true });
    if (!permission.allowed) throw new ForbiddenException('Missing permission: records.read');
    const filters = [eq(clientDocuments.practiceId, practiceId), isNull(clientDocuments.deletedAt)];
    if (clientId) filters.push(eq(clientDocuments.clientId, clientId));
    if (permission.ownScoped) filters.push(sql`exists (
      select 1 from appointments a where a.practice_id = ${practiceId}::uuid
      and a.client_id = ${clientDocuments.clientId} and a.professional_user_id = ${userId}::uuid
    )`);
    return this.db.select({
      id: clientDocuments.id, clientId: clientDocuments.clientId, appointmentId: clientDocuments.appointmentId,
      locationId: clientDocuments.locationId, originalName: clientDocuments.originalName, mediaType: clientDocuments.mediaType,
      sizeBytes: clientDocuments.sizeBytes, category: clientDocuments.category, description: clientDocuments.description,
      customerVisible: clientDocuments.customerVisible, createdAt: clientDocuments.createdAt,
      clientName: clients.fullName, clientEmail: clients.email,
    }).from(clientDocuments).innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .where(and(...filters)).orderBy(desc(clientDocuments.createdAt)).limit(250);
  }

  async upload(userId: string, practiceId: string, input: {
    clientId: string; appointmentId?: string; locationId?: string; category: string;
    description?: string; customerVisible: boolean;
  }, file: Express.Multer.File) {
    this.assertFile(file);
    if (!DOCUMENT_CATEGORIES.includes(input.category as typeof DOCUMENT_CATEGORIES[number])) throw new BadRequestException('Choose a valid document category');
    const [client] = await this.db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.practiceId, practiceId))).limit(1);
    if (!client) throw new NotFoundException('Customer record not found in this practice');
    const permission = await this.authorization.resolvePermission({
      userId, practiceId, permissionCode: 'records.write', locationId: input.locationId,
      ownRecordsAreQueryScoped: true,
    });
    if (!permission.allowed) throw new ForbiddenException('Missing permission: records.write');
    if (permission.ownScoped && !await this.hasAssignedAppointment(userId, practiceId, input.clientId, input.locationId)) {
      throw new ForbiddenException('You can only add records for customers assigned to you');
    }
    if (input.locationId) {
      const [location] = await this.db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.id, input.locationId), eq(locations.practiceId, practiceId))).limit(1);
      if (!location) throw new NotFoundException('Location not found in this practice');
    }
    if (input.appointmentId) {
      const [appointment] = await this.db.select({ id: appointments.id }).from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.practiceId, practiceId), eq(appointments.clientId, input.clientId))).limit(1);
      if (!appointment) throw new BadRequestException('The appointment must belong to this customer and practice');
    }

    const id = randomUUID();
    const storageKey = randomUUID();
    const mediaType = file.mimetype.toLowerCase();
    const name = basename(file.originalname).replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 240) || 'document';
    const path = join(this.directory, storageKey);
    await this.storage.writeBuffer(storageKey, file.buffer, path, mediaType);
    try {
      return await this.db.transaction(async (tx) => {
        const [document] = await tx.insert(clientDocuments).values({
          id, storageKey, practiceId, clientId: input.clientId, appointmentId: input.appointmentId ?? null,
          locationId: input.locationId ?? null, uploadedByUserId: userId, originalName: name, mediaType,
          sizeBytes: file.size, category: input.category, description: input.description?.trim() || null,
          customerVisible: input.customerVisible,
        }).returning({
          id: clientDocuments.id, clientId: clientDocuments.clientId, originalName: clientDocuments.originalName,
          mediaType: clientDocuments.mediaType, sizeBytes: clientDocuments.sizeBytes, category: clientDocuments.category,
          description: clientDocuments.description, customerVisible: clientDocuments.customerVisible, createdAt: clientDocuments.createdAt,
        });
        await tx.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client_document.uploaded', entityType: 'client_document', entityId: id, metadata: { clientId: input.clientId, category: input.category, sizeBytes: file.size } });
        return document;
      });
    } catch (cause) {
      await this.storage.remove(storageKey, path).catch(() => undefined);
      throw cause;
    }
  }

  async remove(userId: string, practiceId: string, id: string) {
    const document = await this.staffDocument(userId, practiceId, id, 'records.write');
    await this.db.update(clientDocuments).set({ deletedAt: new Date(), customerVisible: false })
      .where(and(eq(clientDocuments.id, id), eq(clientDocuments.practiceId, practiceId), isNull(clientDocuments.deletedAt)));
    await this.storage.remove(document.storageKey, document.path).catch(() => undefined);
    await this.db.insert(auditEvents).values({ practiceId, actorUserId: userId, action: 'client_document.deleted', entityType: 'client_document', entityId: id, metadata: { clientId: document.clientId } });
    return { deleted: true };
  }

  async staffFile(userId: string, practiceId: string, id: string) {
    return this.staffDocument(userId, practiceId, id, 'records.read');
  }

  async customerFile(userId: string, id: string) {
    const [document] = await this.db.select({
      id: clientDocuments.id, storageKey: clientDocuments.storageKey, originalName: clientDocuments.originalName,
      mediaType: clientDocuments.mediaType, sizeBytes: clientDocuments.sizeBytes, category: clientDocuments.category,
      description: clientDocuments.description, createdAt: clientDocuments.createdAt,
    }).from(clientDocuments)
      .innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .where(and(eq(clientDocuments.id, id), eq(clients.userId, userId), eq(clientDocuments.customerVisible, true), isNull(clientDocuments.deletedAt))).limit(1);
    if (!document) throw new NotFoundException('Shared file not found');
    return { ...document, path: join(this.directory, document.storageKey) };
  }

  async read(file: { storageKey: string; path: string }) {
    try { return await this.storage.openReadStream(file.storageKey, file.path); }
    catch { throw new NotFoundException('File content is unavailable'); }
  }

  private async staffDocument(userId: string, practiceId: string, id: string, permissionCode: 'records.read' | 'records.write') {
    const [document] = await this.db.select().from(clientDocuments)
      .where(and(eq(clientDocuments.id, id), eq(clientDocuments.practiceId, practiceId), isNull(clientDocuments.deletedAt))).limit(1);
    if (!document) throw new NotFoundException('Customer file not found');
    const permission = await this.authorization.resolvePermission({
      userId, practiceId, permissionCode, locationId: document.locationId ?? undefined, ownRecordsAreQueryScoped: true,
    });
    if (!permission.allowed) throw new ForbiddenException(`Missing permission: ${permissionCode}`);
    if (permission.ownScoped && !await this.hasAssignedAppointment(userId, practiceId, document.clientId, document.locationId ?? undefined)) {
      throw new ForbiddenException('This customer record is outside your assigned caseload');
    }
    return { ...document, path: join(this.directory, document.storageKey) };
  }

  private async hasAssignedAppointment(userId: string, practiceId: string, clientId: string, locationId?: string) {
    const [appointment] = await this.db.select({ id: appointments.id }).from(appointments).where(and(
      eq(appointments.practiceId, practiceId), eq(appointments.clientId, clientId), eq(appointments.professionalUserId, userId),
      locationId ? eq(appointments.locationId, locationId) : sql`true`,
    )).limit(1);
    return Boolean(appointment);
  }

  private assertFile(file: Express.Multer.File) {
    if (!file?.buffer?.length || file.size > 20 * 1024 * 1024) throw new BadRequestException('Choose a file under 20 MB');
    const signature = MIME_SIGNATURES[file.mimetype.toLowerCase()];
    if (!signature || !signature(file.buffer)) throw new BadRequestException('Only valid PDF, JPEG, PNG, and WebP files are accepted');
  }
}
