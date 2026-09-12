import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppConfig, loadConfig } from '../../src/config/configuration';
import { TraceMiddleware, TRACE_HEADER } from '../../src/common/tracing/trace.middleware';
import { AuthMiddleware } from '../../src/common/authz/auth.middleware';
import { HttpExceptionFilter } from '../../src/common/errors/http-exception.filter';
import { DevTokenVerifier } from '../../src/common/authz/token-verifier';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.test') });

export interface TestApp {
  app: INestApplication;
  config: AppConfig;
  verifier: DevTokenVerifier;
  http: ReturnType<typeof request>;
  tokenFor(orgId: string, permissions: string[], sub?: string): string;
}

export const ORG_A = '11111111-1111-1111-1111-111111111111';
export const ORG_B = '22222222-2222-2222-2222-222222222222';
export const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

export async function bootTestApp(): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: false });
  app.setGlobalPrefix('api');
  app.use(new TraceMiddleware().use);
  app.use(new AuthMiddleware(config.jwtDevSecret).use);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  const verifier = new DevTokenVerifier(config.jwtDevSecret);
  return {
    app,
    config,
    verifier,
    http: request(app.getHttpServer()),
    tokenFor: (orgId, permissions, sub = USER_A) => verifier.sign({ sub, orgId, roles: [], permissions })
  };
}

export { TRACE_HEADER };
