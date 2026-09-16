import { DynamicModule, Global, Module, Type } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AppConfig } from '../config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { FeatureFlagsService } from './flags/feature-flags.service';
import { MediaService } from './media/media.service';
import { ReferenceIdService } from './pagination/reference-id.service';
import { RbacGuard } from './authz/rbac.guard';
import { OrgContextService } from './authz/org-context.service';
import { RateLimitService } from './rate-limit/rate-limit.service';
import { HealthController } from './health/health.controller';
import { BaselineController } from './baseline/baseline.controller';
import { MediaController } from './media/media.controller';
import { PilotConfigController } from './flags/pilot-config.controller';
import { AdminConfigController } from './flags/admin-config.controller';

@Global()
@Module({})
export class CommonModule {
  static forRoot(config: AppConfig): DynamicModule {
    const providers = [
      AuditService,
      OutboxService,
      FeatureFlagsService,
      MediaService,
      ReferenceIdService,
      OrgContextService,
      RateLimitService,
      Reflector
    ];
    const controllers: Type<unknown>[] = [HealthController, MediaController, PilotConfigController, AdminConfigController];
    if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
      controllers.push(BaselineController);
    }
    return {
      module: CommonModule,
      imports: [DatabaseModule.forRoot(config)],
      controllers,
      providers,
      exports: [AuditService, OutboxService, FeatureFlagsService, MediaService, ReferenceIdService, OrgContextService, RateLimitService]
    };
  }
}

export const rbacGuardProvider = { provide: APP_GUARD, useClass: RbacGuard };
