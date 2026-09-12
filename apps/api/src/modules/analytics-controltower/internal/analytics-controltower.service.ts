import { Injectable } from '@nestjs/common';
import { AnalyticsControltowerService } from '../contracts';

@Injectable()
export class AnalyticsControltowerServiceImpl implements AnalyticsControltowerService {
  contextKey(): 'analytics-controltower' {
    return 'analytics-controltower';
  }
}
