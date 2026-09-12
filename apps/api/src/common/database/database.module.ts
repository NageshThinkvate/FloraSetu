import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/configuration';
import { DatabaseService } from './database.service';

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DatabaseService, useFactory: () => new DatabaseService(config.databaseUrl) }
      ],
      exports: [APP_CONFIG, DatabaseService]
    };
  }
}
