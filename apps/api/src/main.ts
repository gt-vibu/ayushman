import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { readEnvironment } from './config.js';

const envPath = resolve(process.cwd(), '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  const env = readEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(helmet());
  app.use(cookieParser());
  app.enableShutdownHooks();
  app.enableCors({ origin: [env.WEB_ORIGIN, env.ADMIN_WEB_ORIGIN], credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  app.setGlobalPrefix('api/v1');

  const documentConfig = new DocumentBuilder()
    .setTitle('Ayushman Happy Flow API')
    .setDescription('Practice setup and appointment booking API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, documentConfig));

  await app.listen(env.API_PORT, '0.0.0.0');
}

void bootstrap();
