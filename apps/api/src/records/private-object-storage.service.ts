import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { readEnvironment } from '../config.js';

@Injectable()
export class PrivateObjectStorage {
  private readonly logger = new Logger(PrivateObjectStorage.name);
  private readonly environment = readEnvironment();
  private readonly client = this.environment.OBJECT_STORAGE_DRIVER === 's3'
    ? new S3Client({
      region: this.environment.AWS_REGION,
      ...(this.environment.AWS_S3_ENDPOINT ? { endpoint: this.environment.AWS_S3_ENDPOINT } : {}),
      forcePathStyle: this.environment.AWS_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.environment.AWS_ACCESS_KEY_ID!,
        secretAccessKey: this.environment.AWS_SECRET_ACCESS_KEY!,
      },
    })
    : undefined;
  private readonly bucket = this.environment.AWS_S3_BUCKET;
  private readonly prefix = this.environment.AWS_S3_PREFIX.split('/').filter(Boolean).join('/');

  get usesS3() { return this.client !== undefined; }

  async writeBuffer(key: string, data: Buffer, localPath: string, contentType: string): Promise<void> {
    if (this.client && this.bucket) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: data, ContentType: contentType }));
      return;
    }
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, data, { flag: 'wx', mode: 0o600 });
  }

  async uploadFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
      Body: createReadStream(sourcePath),
      ContentType: contentType,
    }));
  }

  async openReadStream(key: string, localPath: string, range?: string): Promise<Readable> {
    if (this.client && this.bucket) {
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ...(range ? { Range: range } : {}) }));
        if (result.Body && typeof (result.Body as { pipe?: unknown }).pipe === 'function') return result.Body as Readable;
        throw new Error('Object storage returned no readable body');
      } catch (error) {
        if (!this.isMissingObject(error)) throw error;
        this.logger.warn('S3 object was not found; trying the legacy local file location');
      }
    }
    const file = await stat(localPath).catch(() => null);
    if (!file) throw new Error('Stored file is unavailable');
    if (!range) return createReadStream(localPath);
    const bounds = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!bounds) throw new Error('Invalid byte range');
    const start = Number(bounds[1]);
    const end = bounds[2] ? Number(bounds[2]) : file.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= file.size) {
      throw new Error('Byte range is outside the stored file');
    }
    return createReadStream(localPath, { start, end: Math.min(end, file.size - 1) });
  }

  async remove(key: string, localPath: string): Promise<void> {
    if (this.client && this.bucket) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    }
    await unlink(localPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private objectKey(key: string) {
    const normalized = key.replace(/^\/+/, '');
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  private isMissingObject(error: unknown) {
    if (!(error instanceof Error)) return false;
    const statusCode = '$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null && 'httpStatusCode' in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;
    return statusCode === 404 || ['NoSuchKey', 'NotFound'].includes(error.name);
  }
}
