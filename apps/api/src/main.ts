import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { TraceMiddleware } from './common/tracing/trace.middleware';
import { AuthMiddleware } from './common/authz/auth.middleware';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: ['error', 'warn', 'log'] });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  // Media uploads are base64 JSON (15MB binary ≈ 20MB encoded) — bound the body
  // limit so oversize payloads get a clean 4xx instead of a parser 500.
  app.use(json({ limit: '30mb' }));
  app.use(new TraceMiddleware().use);
  app.use(new AuthMiddleware(config.jwtDevSecret).use);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
