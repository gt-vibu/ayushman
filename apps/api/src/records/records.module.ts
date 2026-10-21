import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomerDocumentsController, PracticeRecordsController } from './records.controller.js';
import { RecordsService } from './records.service.js';
import { PracticeSessionRecordingsController, CustomerSessionRecordingsController } from './session-recordings.controller.js';
import { SessionRecordingsService } from './session-recordings.service.js';

@Module({ imports: [AuthModule], controllers: [PracticeRecordsController, CustomerDocumentsController, PracticeSessionRecordingsController, CustomerSessionRecordingsController], providers: [RecordsService, SessionRecordingsService] })
export class RecordsModule {}
