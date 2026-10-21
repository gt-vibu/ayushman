import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { Body, Controller, Delete, Get, Param, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest, CustomerAuthenticatedRequest } from '../auth/session.guard.js';
import { CustomerSessionGuard, SessionGuard } from '../auth/session.guard.js';
import { ClientDocumentUploadInput, type ClientDocumentUploadInput as ClientDocumentUploadPayload } from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { RecordsService } from './records.service.js';

const fileHeaders = (name: string, type: string, inline: boolean) => {
  const safeName = basename(name).replace(/[\r\n"\\]/g, '_');
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return { type, disposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encoded}` };
};

@Controller('practices/:practiceId/records')
@UseGuards(SessionGuard)
export class PracticeRecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Query('clientId') clientId?: string) {
    return this.records.list(req.user.id, practiceId, clientId);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Body(new ZodValidationPipe(ClientDocumentUploadInput)) body: ClientDocumentUploadPayload,
    @UploadedFile() file: Express.Multer.File) {
    return this.records.upload(req.user.id, practiceId, body, file);
  }

  @Get('files/:documentId/content')
  async content(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string,
    @Param('documentId') documentId: string, @Query('inline') inline?: string) {
    const file = await this.records.staffFile(req.user.id, practiceId, documentId);
    return new StreamableFile(createReadStream(file.path), { ...fileHeaders(file.originalName, file.mediaType, inline === '1'), length: file.sizeBytes });
  }

  @Delete('files/:documentId')
  remove(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('documentId') documentId: string) {
    return this.records.remove(req.user.id, practiceId, documentId);
  }
}

@Controller('customer/me/documents')
@UseGuards(CustomerSessionGuard)
export class CustomerDocumentsController {
  constructor(private readonly records: RecordsService) {}

  @Get(':documentId/content')
  async content(@Req() req: CustomerAuthenticatedRequest, @Param('documentId') documentId: string, @Query('inline') inline?: string) {
    const file = await this.records.customerFile(req.user.id, documentId);
    return new StreamableFile(createReadStream(file.path), { ...fileHeaders(file.originalName, file.mediaType, inline === '1'), length: file.sizeBytes });
  }
}
