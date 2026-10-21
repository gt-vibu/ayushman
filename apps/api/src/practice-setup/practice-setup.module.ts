import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PracticeSetupController } from './practice-setup.controller.js';
import { PracticeSetupService } from './practice-setup.service.js';

@Module({ imports: [AuthModule], controllers: [PracticeSetupController], providers: [PracticeSetupService] })
export class PracticeSetupModule {}
