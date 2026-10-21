import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNull, lte, sql } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { appointments, auditEvents, clients, practices, sessionRecordingChunks, sessionRecordingConsents, sessionRecordings } from '@ayushman-v2/db/schema';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { PrivateObjectStorage } from './private-object-storage.service.js';

const NOTICE_VERSION = 'session-recording-v1';
const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_RECORDING_BYTES = 512 * 1024 * 1024;
const MIME_TYPES = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']);

const WEBM_SEGMENT_ID = 0x18538067;
const WEBM_INFO_ID = 0x1549a966;
const WEBM_TIMECODE_SCALE_ID = 0x2ad7b1;
const WEBM_DURATION_ID = 0x4489;

function readEbmlVint(buffer: Buffer, offset: number, id = false) {
  const first = buffer[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while (!(first & marker) && length <= (id ? 4 : 8)) { marker >>= 1; length++; }
  if (length > (id ? 4 : 8) || offset + length > buffer.length) return null;
  let value = id ? first : first & (marker - 1);
  for (let index = 1; index < length; index++) value = value * 256 + buffer[offset + index];
  return { value, length, unknown: !id && value === 2 ** (7 * length) - 1 };
}

function encodeEbmlSize(value: number, minimumLength: number) {
  let length = minimumLength;
  while (length <= 8 && value >= 2 ** (7 * length) - 1) length++;
  if (length > 8) throw new Error('WebM metadata is too large');
  const encoded = BigInt(value) | (1n << BigInt(7 * length));
  const bytes = Buffer.alloc(length);
  for (let index = length - 1; index >= 0; index--) bytes[index] = Number((encoded >> BigInt(8 * (length - index - 1))) & 0xffn);
  return bytes;
}

/** Add a finite duration to MediaRecorder's streaming WebM, which otherwise has
 * an unknown duration and makes native audio controls stall then jump while
 * they discover the end of the concatenated chunks. */
export async function writeWebmDuration(path: string, durationSeconds: number) {
  const handle = await open(path, 'r');
  const prefix = Buffer.alloc(64 * 1024);
  let bytesRead: number;
  try { ({ bytesRead } = await handle.read(prefix, 0, prefix.length, 0)); }
  finally { await handle.close(); }
  const data = prefix.subarray(0, bytesRead!);
  const ebml = readEbmlVint(data, 0, true);
  if (!ebml || ebml.value !== 0x1a45dfa3) throw new Error('Recording has an invalid WebM header');
  const ebmlSize = readEbmlVint(data, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) throw new Error('Recording has an invalid WebM header');
  let segmentOffset = ebml.length + ebmlSize.length + ebmlSize.value;
  const segment = readEbmlVint(data, segmentOffset, true);
  if (!segment || segment.value !== WEBM_SEGMENT_ID) throw new Error('Recording has no WebM segment');
  const segmentSize = readEbmlVint(data, segmentOffset + segment.length);
  if (!segmentSize) throw new Error('Recording has an invalid WebM segment');
  let cursor = segmentOffset + segment.length + segmentSize.length;
  let infoStart = -1;
  let infoEnd = -1;
  let scale = 1_000_000;
  let durationElement: { start: number; end: number; valueOffset: number; valueLength: number } | undefined;
  while (cursor < data.length) {
    const element = readEbmlVint(data, cursor, true);
    if (!element) break;
    const size = readEbmlVint(data, cursor + element.length);
    if (!size || size.unknown) break;
    const contentStart = cursor + element.length + size.length;
    const end = contentStart + size.value;
    if (end > data.length) break;
    if (element.value === WEBM_INFO_ID) {
      infoStart = cursor;
      infoEnd = end;
      let child = contentStart;
      while (child < end) {
        const childId = readEbmlVint(data, child, true);
        if (!childId) break;
        const childSize = readEbmlVint(data, child + childId.length);
        if (!childSize || childSize.unknown) break;
        const valueOffset = child + childId.length + childSize.length;
        const childEnd = valueOffset + childSize.value;
        if (childEnd > end) break;
        if (childId.value === WEBM_TIMECODE_SCALE_ID && childSize.value > 0 && childSize.value <= 8) {
          scale = 0;
          for (let index = valueOffset; index < childEnd; index++) scale = scale * 256 + data[index];
        }
        if (childId.value === WEBM_DURATION_ID) durationElement = { start: child, end: childEnd, valueOffset, valueLength: childSize.value };
        child = childEnd;
      }
      break;
    }
    cursor = end;
  }
  if (infoStart < 0 || infoEnd < 0 || scale <= 0) throw new Error('Recording is missing WebM duration metadata');

  const ticks = durationSeconds * 1_000_000_000 / scale;
  let newInfo: Buffer;
  if (durationElement && (durationElement.valueLength === 4 || durationElement.valueLength === 8)) {
    const info = Buffer.from(data.subarray(infoStart, infoEnd));
    const relativeValueOffset = durationElement.valueOffset - infoStart;
    if (durationElement.valueLength === 4) info.writeFloatBE(ticks, relativeValueOffset);
    else info.writeDoubleBE(ticks, relativeValueOffset);
    newInfo = info;
  } else {
    const duration = Buffer.alloc(11);
    duration.writeUInt16BE(WEBM_DURATION_ID, 0);
    duration[2] = 0x88;
    duration.writeDoubleBE(ticks, 3);
    const oldInfo = data.subarray(infoStart, infoEnd);
    const infoId = readEbmlVint(oldInfo, 0, true)!;
    const oldInfoSize = readEbmlVint(oldInfo, infoId.length)!;
    const payload = oldInfo.subarray(infoId.length + oldInfoSize.length);
    const newPayload = Buffer.concat([payload, duration]);
    newInfo = Buffer.concat([oldInfo.subarray(0, infoId.length), encodeEbmlSize(newPayload.length, oldInfoSize.length), newPayload]);
  }

  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    async function* output() {
      yield data.subarray(0, infoStart);
      yield newInfo;
      for await (const part of createReadStream(path, { start: infoEnd })) yield part as Buffer;
    }
    await pipeline(Readable.from(output()), createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

@Injectable()
export class SessionRecordingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRecordingsService.name);
  private readonly directory = resolve(process.env.PRIVATE_RECORDING_STORAGE_DIR || resolve(process.cwd(), '.private-recordings'));
  private cleanupTimer?: NodeJS.Timeout;

  constructor(@Inject(DATABASE) private readonly db: Database, private readonly authorization: AuthorizationService, private readonly storage: PrivateObjectStorage) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.expireOldRecordings(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.expireOldRecordings();
  }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  async listForAppointment(userId: string, practiceId: string, appointmentId: string) {
    const appointment = await this.authorizedAppointment(userId, practiceId, appointmentId);
    return this.db.select({
      id: sessionRecordings.id, status: sessionRecordings.status, sharingStatus: sessionRecordings.sharingStatus,
      mimeType: sessionRecordings.mimeType, sizeBytes: sessionRecordings.sizeBytes,
      durationSeconds: sessionRecordings.durationSeconds, startedAt: sessionRecordings.startedAt,
      endedAt: sessionRecordings.endedAt, retentionExpiresAt: sessionRecordings.retentionExpiresAt,
      createdAt: sessionRecordings.createdAt, stopRequestedAt: sessionRecordings.stopRequestedAt,
    }).from(sessionRecordings).where(and(
      eq(sessionRecordings.practiceId, practiceId), eq(sessionRecordings.appointmentId, appointment.id), isNull(sessionRecordings.deletedAt),
    )).orderBy(asc(sessionRecordings.createdAt));
  }

  async requestConsent(userId: string, practiceId: string, appointmentId: string) {
    const appointment = await this.authorizedAppointment(userId, practiceId, appointmentId);
    const [policy] = await this.db.select({ enabled: practices.sessionRecordingEnabled, retentionDays: practices.sessionRecordingRetentionDays }).from(practices).where(eq(practices.id, practiceId)).limit(1);
    if (!policy?.enabled) throw new ForbiddenException('Session recording is disabled for this practice. An admin can enable it in Settings');
    if (!['confirmed', 'checked_in', 'in_progress'].includes(appointment.status)) throw new ConflictException('Recording is available for confirmed appointments before or during the session');
    if (!appointment.customerUserId) throw new BadRequestException('The customer needs an Ayushman account to provide recording consent');
    const [existing] = await this.db.select({ id: sessionRecordings.id }).from(sessionRecordings).where(and(
      eq(sessionRecordings.appointmentId, appointmentId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt),
      sql`${sessionRecordings.status} IN ('awaiting_customer_consent','ready_to_record','recording','uploading','ready_for_review','shared','stop_requested')`,
    )).limit(1);
    if (existing) throw new ConflictException('This appointment already has an active or saved recording');

    const recordingId = randomUUID();
    let recording;
    try {
      recording = await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(sessionRecordings).values({
          id: recordingId, practiceId, appointmentId, clientId: appointment.clientId,
          locationId: appointment.locationId, professionalUserId: appointment.professionalUserId,
          createdByUserId: userId, status: 'awaiting_customer_consent', consentNoticeVersion: NOTICE_VERSION, retentionDays: policy.retentionDays,
        }).returning({ id: sessionRecordings.id, status: sessionRecordings.status, createdAt: sessionRecordings.createdAt });
        await tx.insert(sessionRecordingConsents).values([
          { recordingId, participantUserId: userId, participantRole: 'practitioner', noticeVersion: NOTICE_VERSION, decision: 'accepted', decidedAt: new Date() },
          { recordingId, participantUserId: appointment.customerUserId!, participantRole: 'customer', noticeVersion: NOTICE_VERSION, decision: 'pending' },
        ]);
        return created;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505') throw new ConflictException('This appointment already has an active or saved recording');
      throw error;
    }
    await this.audit(practiceId, userId, 'session_recording.consent_requested', recordingId, { appointmentId });
    return recording;
  }

  async listForCustomer(userId: string) {
    return this.db.select({
      id: sessionRecordings.id, practiceId: sessionRecordings.practiceId, appointmentId: sessionRecordings.appointmentId,
      status: sessionRecordings.status, sharingStatus: sessionRecordings.sharingStatus,
      durationSeconds: sessionRecordings.durationSeconds, startedAt: sessionRecordings.startedAt,
      endedAt: sessionRecordings.endedAt, retentionExpiresAt: sessionRecordings.retentionExpiresAt,
      createdAt: sessionRecordings.createdAt, serviceName: appointments.serviceNameSnapshot,
      startsAt: appointments.startsAt, timezone: appointments.timezone,
      retentionDays: sessionRecordings.retentionDays,
      practiceName: sql<string>`(select p.name from practices p where p.id = ${sessionRecordings.practiceId})`,
      practitionerName: sql<string>`(select u.full_name from users u where u.id = ${sessionRecordings.professionalUserId})`,
      consentDecision: sessionRecordingConsents.decision,
    }).from(sessionRecordings)
      .innerJoin(clients, eq(clients.id, sessionRecordings.clientId))
      .innerJoin(appointments, eq(appointments.id, sessionRecordings.appointmentId))
      .leftJoin(sessionRecordingConsents, and(eq(sessionRecordingConsents.recordingId, sessionRecordings.id), eq(sessionRecordingConsents.participantRole, 'customer'), eq(sessionRecordingConsents.participantUserId, userId)))
      .where(and(eq(clients.userId, userId), isNull(sessionRecordings.deletedAt), sql`${sessionRecordings.status} <> 'expired'`, sql`(${sessionRecordings.retentionExpiresAt} IS NULL OR ${sessionRecordings.retentionExpiresAt} > now())`))
      .orderBy(asc(appointments.startsAt)).limit(100);
  }

  async customerConsent(userId: string, recordingId: string, accepted: boolean) {
    const [recording] = await this.db.select({ id: sessionRecordings.id, practiceId: sessionRecordings.practiceId, appointmentId: sessionRecordings.appointmentId, clientId: sessionRecordings.clientId, status: sessionRecordings.status, customerUserId: clients.userId })
      .from(sessionRecordings).innerJoin(clients, eq(clients.id, sessionRecordings.clientId))
      .where(and(eq(sessionRecordings.id, recordingId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording || recording.customerUserId !== userId) throw new NotFoundException('Recording consent request not found');
    if (recording.status !== 'awaiting_customer_consent') throw new ConflictException('This recording consent request is no longer active');
    const now = new Date();
    const decision = accepted ? 'accepted' : 'declined';
    await this.db.update(sessionRecordingConsents).set({ decision, decidedAt: now }).where(and(
      eq(sessionRecordingConsents.recordingId, recordingId), eq(sessionRecordingConsents.participantUserId, userId), eq(sessionRecordingConsents.participantRole, 'customer'), eq(sessionRecordingConsents.decision, 'pending'),
    ));
    await this.db.update(sessionRecordings).set({ status: accepted ? 'ready_to_record' : 'declined', updatedAt: now }).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.status, 'awaiting_customer_consent')));
    await this.audit(recording.practiceId, userId, `session_recording.consent_${decision}`, recordingId, { appointmentId: recording.appointmentId });
    return { status: accepted ? 'ready_to_record' : 'declined' };
  }

  async start(userId: string, practiceId: string, recordingId: string, mimeType: string) {
    if (!MIME_TYPES.has(mimeType.toLowerCase())) throw new BadRequestException('This browser recording format is not supported');
    const [recording] = await this.db.select().from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording) throw new NotFoundException('Recording session not found');
    if (recording.status !== 'ready_to_record') throw new ConflictException('Both the practitioner and customer must agree before recording starts');
    const appointment = await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    if (!['checked_in', 'in_progress'].includes(appointment.status)) throw new ConflictException('Start the appointment and check the customer in before recording');
    const [customerConsent] = await this.db.select({ id: sessionRecordingConsents.id }).from(sessionRecordingConsents).where(and(
      eq(sessionRecordingConsents.recordingId, recordingId), eq(sessionRecordingConsents.participantRole, 'customer'), eq(sessionRecordingConsents.decision, 'accepted'), isNull(sessionRecordingConsents.withdrawnAt),
    )).limit(1);
    if (!customerConsent) throw new ForbiddenException('Customer consent is required before recording');
    const now = new Date();
    const [started] = await this.db.update(sessionRecordings).set({ status: 'recording', mimeType, startedAt: now, updatedAt: now })
      .where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.status, 'ready_to_record'))).returning({ id: sessionRecordings.id });
    if (!started) throw new ConflictException('Recording state changed. Refresh and try again');
    await this.audit(practiceId, userId, 'session_recording.started', recordingId, {});
    return { status: 'recording', startedAt: now };
  }

  async getState(userId: string, practiceId: string, recordingId: string) {
    const [recording] = await this.db.select({ id: sessionRecordings.id, appointmentId: sessionRecordings.appointmentId, status: sessionRecordings.status, stopRequestedAt: sessionRecordings.stopRequestedAt })
      .from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording) throw new NotFoundException('Recording session not found');
    await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    return recording;
  }

  async uploadChunk(userId: string, practiceId: string, recordingId: string, index: number, file?: Express.Multer.File) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 20000) throw new BadRequestException('Invalid recording segment number');
    if (!file?.buffer?.length || file.size > MAX_CHUNK_BYTES) throw new BadRequestException('Recording segment must be between 1 byte and 5 MB');
    const [recording] = await this.db.select().from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording) throw new NotFoundException('Recording session not found');
    await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    if (!['recording', 'stop_requested'].includes(recording.status)) throw new ConflictException('The recording is no longer accepting segments');
    const storageKey = randomUUID();
    const path = join(this.directory, storageKey);
    try {
      await this.storage.writeBuffer(storageKey, file.buffer, path, file.mimetype || recording.mimeType || 'application/octet-stream');
      const result = await this.db.transaction(async (tx) => {
        // Serialize quota checks per recording so simultaneous uploads cannot
        // race past the overall size limit or create duplicate segment indexes.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${recordingId}))`);
        const [existing] = await tx.select({ id: sessionRecordingChunks.id }).from(sessionRecordingChunks).where(and(eq(sessionRecordingChunks.recordingId, recordingId), eq(sessionRecordingChunks.chunkIndex, index))).limit(1);
        if (existing) return { accepted: true, duplicate: true };
        const [total] = await tx.select({ bytes: sql<number>`coalesce(sum(${sessionRecordingChunks.sizeBytes}),0)::int` }).from(sessionRecordingChunks).where(eq(sessionRecordingChunks.recordingId, recordingId));
        if (Number(total.bytes) + file.size > MAX_RECORDING_BYTES) throw new BadRequestException('The recording exceeds the 512 MB limit');
        await tx.insert(sessionRecordingChunks).values({ recordingId, chunkIndex: index, storageKey, sizeBytes: file.size });
        await tx.update(sessionRecordings).set({ status: 'uploading', updatedAt: new Date() }).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.status, 'recording')));
        return { accepted: true, duplicate: false };
      });
      if (result.duplicate) await this.storage.remove(storageKey, path);
      return result;
    } catch (error) { await this.storage.remove(storageKey, path).catch(() => undefined); throw error; }
  }

  async complete(userId: string, practiceId: string, recordingId: string, durationSeconds: number) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 10800) throw new BadRequestException('Recording duration must be between 1 second and 3 hours');
    const [recording] = await this.db.select().from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording) throw new NotFoundException('Recording session not found');
    await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    if (['ready_for_review', 'shared'].includes(recording.status)) return { status: recording.status, sizeBytes: recording.sizeBytes };
    if (!['recording', 'uploading', 'stop_requested'].includes(recording.status)) throw new ConflictException('This recording cannot be finalized');
    const chunks = await this.db.select().from(sessionRecordingChunks).where(eq(sessionRecordingChunks.recordingId, recordingId)).orderBy(asc(sessionRecordingChunks.chunkIndex));
    if (!chunks.length || chunks.some((chunk, index) => chunk.chunkIndex !== index)) throw new ConflictException('Some recording segments did not upload. Retry the missing segments before saving');
    const storageKey = recording.storageKey;
    const destination = join(this.directory, storageKey);
    await mkdir(this.directory, { recursive: true });
    try {
      const storage = this.storage;
      const directory = this.directory;
      async function* data() {
        for (const chunk of chunks) {
          for await (const part of await storage.openReadStream(chunk.storageKey, join(directory, chunk.storageKey))) yield part as Buffer;
        }
      }
      await pipeline(Readable.from(data()), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    } catch (cause) {
      await unlink(destination).catch(() => undefined);
      throw new ConflictException(cause instanceof Error ? 'Could not assemble recording segments. Retry saving the session' : 'Could not assemble recording segments');
    }
    try {
      if (recording.mimeType?.toLowerCase().startsWith('audio/webm')) await writeWebmDuration(destination, durationSeconds);
    } catch (cause) {
      await unlink(destination).catch(() => undefined);
      this.logger.error('Could not finalize WebM recording metadata', cause);
      throw new ConflictException('Could not finalize the audio timing metadata. Retry saving the session');
    }
    const sizeBytes = (await stat(destination)).size;
    if (sizeBytes > MAX_RECORDING_BYTES) {
      await unlink(destination).catch(() => undefined);
      throw new BadRequestException('The finalized recording exceeds the 512 MB limit');
    }
    try {
      await this.storage.uploadFile(storageKey, destination, recording.mimeType ?? 'audio/webm');
    } catch (cause) {
      await unlink(destination).catch(() => undefined);
      this.logger.error('Could not store finalized session recording', cause);
      throw new ConflictException('Could not store the recording. Retry saving the session');
    }
    const now = new Date();
    const expiry = new Date(now.getTime() + recording.retentionDays * 24 * 60 * 60 * 1000);
    const [saved] = await this.db.update(sessionRecordings).set({ status: 'ready_for_review', sharingStatus: 'private', sizeBytes, durationSeconds, endedAt: now, retentionExpiresAt: expiry, updatedAt: now })
      .where(and(eq(sessionRecordings.id, recordingId), sql`${sessionRecordings.status} IN ('recording','uploading','stop_requested')`)).returning({ id: sessionRecordings.id });
    if (!saved) { await this.storage.remove(storageKey, destination).catch(() => undefined); throw new ConflictException('Recording state changed before it could be saved'); }
    for (const chunk of chunks) await this.storage.remove(chunk.storageKey, join(this.directory, chunk.storageKey)).catch((error) => this.logger.warn(`Could not remove recording segment ${chunk.storageKey}: ${error instanceof Error ? error.message : 'unknown error'}`));
    if (this.storage.usesS3) await unlink(destination).catch(() => undefined);
    await this.audit(practiceId, userId, 'session_recording.saved_for_review', recordingId, { sizeBytes, durationSeconds });
    return { status: 'ready_for_review', sizeBytes, retentionExpiresAt: expiry };
  }

  async share(userId: string, practiceId: string, recordingId: string) {
    const [recording] = await this.db.select().from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording) throw new NotFoundException('Recording not found');
    await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    if (recording.status !== 'ready_for_review') throw new ConflictException('Only a saved recording awaiting review can be shared');
    const [updated] = await this.db.update(sessionRecordings).set({ status: 'shared', sharingStatus: 'shared', sharedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.status, 'ready_for_review'))).returning({ id: sessionRecordings.id });
    if (!updated) throw new ConflictException('Recording sharing state changed. Refresh and try again');
    await this.audit(practiceId, userId, 'session_recording.shared_with_customer', recordingId, {});
    return { shared: true };
  }

  async withdrawCustomer(userId: string, recordingId: string) {
    const [recording] = await this.db.select({ id: sessionRecordings.id, practiceId: sessionRecordings.practiceId, clientId: sessionRecordings.clientId, status: sessionRecordings.status, customerUserId: clients.userId })
      .from(sessionRecordings).innerJoin(clients, eq(clients.id, sessionRecordings.clientId)).where(and(eq(sessionRecordings.id, recordingId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording || recording.customerUserId !== userId) throw new NotFoundException('Recording not found');
    if (recording.status === 'recording' || recording.status === 'uploading') {
      const now = new Date();
      await this.db.update(sessionRecordingConsents).set({ decision: 'withdrawn', withdrawnAt: now, decidedAt: now }).where(and(eq(sessionRecordingConsents.recordingId, recordingId), eq(sessionRecordingConsents.participantUserId, userId), eq(sessionRecordingConsents.participantRole, 'customer')));
      await this.db.update(sessionRecordings).set({ status: 'stop_requested', sharingStatus: 'restricted', stopRequestedAt: now, updatedAt: now }).where(eq(sessionRecordings.id, recordingId));
    } else if (recording.status === 'awaiting_customer_consent') {
      await this.customerConsent(userId, recordingId, false);
    } else if (recording.status === 'ready_to_record') {
      const now = new Date();
      await this.db.update(sessionRecordingConsents).set({ decision: 'withdrawn', withdrawnAt: now, decidedAt: now }).where(and(eq(sessionRecordingConsents.recordingId, recordingId), eq(sessionRecordingConsents.participantUserId, userId), eq(sessionRecordingConsents.participantRole, 'customer')));
      await this.db.update(sessionRecordings).set({ status: 'declined', updatedAt: now }).where(eq(sessionRecordings.id, recordingId));
    } else {
      await this.db.update(sessionRecordings).set({ sharingStatus: 'restricted', updatedAt: new Date() }).where(eq(sessionRecordings.id, recordingId));
    }
    await this.audit(recording.practiceId, userId, 'session_recording.customer_access_restricted', recordingId, {});
    return { restricted: true };
  }

  async practitionerFile(userId: string, practiceId: string, recordingId: string) {
    const [recording] = await this.db.select().from(sessionRecordings).where(and(eq(sessionRecordings.id, recordingId), eq(sessionRecordings.practiceId, practiceId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording || !['ready_for_review', 'shared', 'stop_requested'].includes(recording.status) || (recording.retentionExpiresAt && recording.retentionExpiresAt <= new Date())) throw new NotFoundException('Recording audio is unavailable');
    await this.authorizedAppointment(userId, practiceId, recording.appointmentId);
    if (recording.sizeBytes === null) throw new NotFoundException('Recording audio is unavailable');
    const path = join(this.directory, recording.storageKey);
    await this.audit(practiceId, userId, 'session_recording.played_by_practitioner', recordingId, {});
    return { path, storageKey: recording.storageKey, sizeBytes: recording.sizeBytes, mimeType: recording.mimeType ?? 'audio/webm', filename: `session-${recordingId}.webm`, openReadStream: (range?: string) => this.storage.openReadStream(recording.storageKey, path, range) };
  }

  async customerFile(userId: string, recordingId: string) {
    const [recording] = await this.db.select({ id: sessionRecordings.id, practiceId: sessionRecordings.practiceId, clientId: sessionRecordings.clientId, storageKey: sessionRecordings.storageKey, mimeType: sessionRecordings.mimeType, sizeBytes: sessionRecordings.sizeBytes, sharingStatus: sessionRecordings.sharingStatus, status: sessionRecordings.status, customerUserId: clients.userId, retentionExpiresAt: sessionRecordings.retentionExpiresAt })
      .from(sessionRecordings).innerJoin(clients, eq(clients.id, sessionRecordings.clientId)).where(and(eq(sessionRecordings.id, recordingId), isNull(sessionRecordings.deletedAt))).limit(1);
    if (!recording || recording.customerUserId !== userId || recording.sharingStatus !== 'shared' || recording.status !== 'shared' || (recording.retentionExpiresAt && recording.retentionExpiresAt <= new Date())) throw new NotFoundException('Shared session replay not found');
    const path = join(this.directory, recording.storageKey);
    await this.audit(recording.practiceId, userId, 'session_recording.played_by_customer', recordingId, {});
    if (recording.sizeBytes === null) throw new NotFoundException('Session replay is unavailable');
    return { path, storageKey: recording.storageKey, sizeBytes: recording.sizeBytes, mimeType: recording.mimeType ?? 'audio/webm', filename: `session-${recordingId}.webm`, openReadStream: (range?: string) => this.storage.openReadStream(recording.storageKey, path, range) };
  }

  private async authorizedAppointment(userId: string, practiceId: string, appointmentId: string) {
    const [appointment] = await this.db.select({ id: appointments.id, clientId: appointments.clientId, customerUserId: clients.userId, locationId: appointments.locationId, professionalUserId: appointments.professionalUserId, status: appointments.status })
      .from(appointments).innerJoin(clients, eq(clients.id, appointments.clientId)).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
    if (!appointment) throw new NotFoundException('Appointment not found');
    await this.authorization.assertPermission({ userId, practiceId, permissionCode: 'appointments.read', locationId: appointment.locationId, resourceOwnerUserId: appointment.professionalUserId, ownRecordsAreQueryScoped: true });
    if (appointment.professionalUserId !== userId) throw new ForbiddenException('Only the practitioner assigned to this appointment can manage its recording');
    return appointment;
  }

  private async audit(practiceId: string, actorUserId: string, action: string, recordingId: string, metadata: Record<string, string | number | boolean | null>) {
    await this.db.insert(auditEvents).values({ practiceId, actorUserId, action, entityType: 'session_recording', entityId: recordingId, metadata });
  }

  private async expireOldRecordings() {
    try {
      const expired = await this.db.update(sessionRecordings).set({ status: 'expired', sharingStatus: 'expired', deletedAt: new Date(), updatedAt: new Date() })
        .where(and(lte(sessionRecordings.retentionExpiresAt, new Date()), isNull(sessionRecordings.deletedAt), sql`${sessionRecordings.status} IN ('ready_for_review','shared')`)).returning({ storageKey: sessionRecordings.storageKey, id: sessionRecordings.id });
      for (const row of expired) {
        await this.storage.remove(row.storageKey, join(this.directory, row.storageKey)).catch((error) => this.logger.warn(`Could not remove expired recording ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`));
        const chunks = await this.db.select({ storageKey: sessionRecordingChunks.storageKey }).from(sessionRecordingChunks).where(eq(sessionRecordingChunks.recordingId, row.id));
        for (const chunk of chunks) await this.storage.remove(chunk.storageKey, join(this.directory, chunk.storageKey)).catch(() => undefined);
      }
    } catch (error) { this.logger.error('Could not apply session recording retention cleanup', error); }
  }
}
