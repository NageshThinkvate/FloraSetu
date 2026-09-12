import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
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
  app.use(new TraceMiddleware().use);
  app.use(new AuthMiddleware(config.jwtDevSecret).use);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
