import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller.js';
import { GeographyService } from './geography.service.js';

@Module({ controllers: [GeographyController], providers: [GeographyService] })
export class GeographyModule {}
