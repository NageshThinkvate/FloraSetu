import { Injectable } from '@nestjs/common';
import { QualityTraceabilityService } from '../contracts';

@Injectable()
export class QualityTraceabilityServiceImpl implements QualityTraceabilityService {
  contextKey(): 'quality-traceability' {
    return 'quality-traceability';
  }
}
