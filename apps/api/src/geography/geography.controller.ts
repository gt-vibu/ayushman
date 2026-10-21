import { Controller, Get, Query } from '@nestjs/common';
import { GeographyOptionsQuery, type GeographyOptionsQuery as GeographyQuery } from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { GeographyService } from './geography.service.js';

@Controller('geography')
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get('countries') countries(@Query(new ZodValidationPipe(GeographyOptionsQuery)) query: GeographyQuery) {
    return this.geography.countries(query);
  }

  @Get('states') states(@Query(new ZodValidationPipe(GeographyOptionsQuery)) query: GeographyQuery) {
    return this.geography.states(query);
  }

  @Get('cities') cities(@Query(new ZodValidationPipe(GeographyOptionsQuery)) query: GeographyQuery) {
    return this.geography.cities(query);
  }

  @Get('timezones') timezones(@Query(new ZodValidationPipe(GeographyOptionsQuery)) query: GeographyQuery) {
    return this.geography.timezones(query);
  }
}
