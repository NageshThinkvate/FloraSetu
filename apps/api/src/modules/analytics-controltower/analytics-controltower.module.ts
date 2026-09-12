import { Global, Module } from '@nestjs/common';
import { TowerService } from './internal/tower.service';
import { TowerController } from './internal/tower.controller';

@Global()
@Module({
  controllers: [TowerController],
  providers: [TowerService]
})
export class AnalyticsControltowerModule {}
