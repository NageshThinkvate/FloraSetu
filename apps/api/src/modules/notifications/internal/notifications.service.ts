import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../contracts';

@Injectable()
export class NotificationsServiceImpl implements NotificationsService {
  contextKey(): 'notifications' {
    return 'notifications';
  }
}
