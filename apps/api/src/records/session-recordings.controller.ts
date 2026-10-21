import type { Readable } from 'node:stream';
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest, CustomerAuthenticatedRequest } from '../auth/session.guard.js';
import { CustomerSessionGuard, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { SessionRecordingsService } from './session-recordings.service.js';

const consentInput = z.object({ accepted: z.boolean() });
const startInput = z.object({ mimeType: z.string().min(1).max(100) });
const completeInput = z.object({ durationSeconds: z.number().int().min(1).max(10800) });
const rangeResponse = async (req: Request, res: Response, file: { sizeBytes: number; mimeType: string; filename: string; openReadStream(range?: string): Promise<Readable> }) => {
  const range = req.headers.range;
  const encoded = encodeURIComponent(file.filename);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="session-audio"; filename*=UTF-8''${encoded}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  if (!range) {
    res.setHeader('Content-Length', file.sizeBytes);
    (await file.openReadStream()).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) { res.status(416).setHeader('Content-Range', `bytes */${file.sizeBytes}`).end(); return; }
  const suffixLength = Number(match[2]);
  const start = match[1] ? Number(match[1]) : Math.max(0, file.sizeBytes - suffixLength);
  const end = match[2] && match[1] ? Math.min(Number(match[2]), file.sizeBytes - 1) : file.sizeBytes - 1;
  if ((!match[1] && (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.sizeBytes) { res.status(416).setHeader('Content-Range', `bytes */${file.sizeBytes}`).end(); return; }
  res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${file.sizeBytes}`);
  res.setHeader('Content-Length', end - start + 1);
  (await file.openReadStream(`bytes=${start}-${end}`)).pipe(res);
};

@Controller('practices/:practiceId/session-recordings')
@UseGuards(SessionGuard)
export class PracticeSessionRecordingsController {
  constructor(private readonly recordings: SessionRecordingsService) {}

  @Get('appointments/:appointmentId')
  list(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('appointmentId') appointmentId: string) {
    return this.recordings.listForAppointment(req.user.id, practiceId, appointmentId);
  }

  @Post('appointments/:appointmentId')
  requestConsent(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('appointmentId') appointmentId: string) {
    return this.recordings.requestConsent(req.user.id, practiceId, appointmentId);
  }

  @Post(':recordingId/start')
  start(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string, @Body(new ZodValidationPipe(startInput)) body: z.infer<typeof startInput>) {
    return this.recordings.start(req.user.id, practiceId, recordingId, body.mimeType);
  }

  @Get(':recordingId/state')
  state(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string) {
    return this.recordings.getState(req.user.id, practiceId, recordingId);
  }

  @Post(':recordingId/chunks/:index')
  @UseInterceptors(FileInterceptor('chunk', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  chunk(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string,
    @Param('index', ParseIntPipe) index: number, @UploadedFile() file?: Express.Multer.File) {
    return this.recordings.uploadChunk(req.user.id, practiceId, recordingId, index, file);
  }

  @Post(':recordingId/complete')
  complete(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string, @Body(new ZodValidationPipe(completeInput)) body: z.infer<typeof completeInput>) {
    return this.recordings.complete(req.user.id, practiceId, recordingId, body.durationSeconds);
  }

  @Post(':recordingId/share')
  share(@Req() req: AuthenticatedRequest, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string) {
    return this.recordings.share(req.user.id, practiceId, recordingId);
  }

  @Get(':recordingId/content')
  async content(@Req() req: AuthenticatedRequest, @Res() res: Response, @Param('practiceId') practiceId: string, @Param('recordingId') recordingId: string) {
    return rangeResponse(req, res, await this.recordings.practitionerFile(req.user.id, practiceId, recordingId));
  }
}

@Controller('customer/me/session-recordings')
@UseGuards(CustomerSessionGuard)
export class CustomerSessionRecordingsController {
  constructor(private readonly recordings: SessionRecordingsService) {}

  @Get()
  list(@Req() req: CustomerAuthenticatedRequest) { return this.recordings.listForCustomer(req.user.id); }

  @Post(':recordingId/consent')
  consent(@Req() req: CustomerAuthenticatedRequest, @Param('recordingId') recordingId: string, @Body(new ZodValidationPipe(consentInput)) body: z.infer<typeof consentInput>) {
    return this.recordings.customerConsent(req.user.id, recordingId, body.accepted);
  }

  @Post(':recordingId/withdraw')
  withdraw(@Req() req: CustomerAuthenticatedRequest, @Param('recordingId') recordingId: string) {
    return this.recordings.withdrawCustomer(req.user.id, recordingId);
  }

  @Get(':recordingId/content')
  async content(@Req() req: CustomerAuthenticatedRequest, @Res() res: Response, @Param('recordingId') recordingId: string) {
    return rangeResponse(req, res, await this.recordings.customerFile(req.user.id, recordingId));
  }
}
