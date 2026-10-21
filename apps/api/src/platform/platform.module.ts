import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformController } from './platform.controller.js';

@Module({ imports: [AuthModule], controllers: [PlatformController] })
export class PlatformModule {}
