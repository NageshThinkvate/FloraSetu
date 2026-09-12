import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { APP_CONFIG } from '../database/database.module';

const WINDOW_SECONDS = 900; // 15 min lockout window
const MAX_FAILURES = 5;

// Brute-force protection for auth endpoints (Redis-backed, per ip+email).
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redis = new Redis(config.redisUrl);
  }

  private key(scope: string, id: string): string {
    return `rl:${scope}:${id}`;
  }

  async isLocked(scope: string, id: string): Promise<number> {
    const count = Number((await this.redis.get(this.key(scope, id))) ?? 0);
    if (count < MAX_FAILURES) {
      return 0;
    }
    const ttl = await this.redis.ttl(this.key(scope, id));
    return ttl > 0 ? ttl : WINDOW_SECONDS;
  }

  async recordFailure(scope: string, id: string): Promise<void> {
    const k = this.key(scope, id);
    const n = await this.redis.incr(k);
    if (n === 1) {
      await this.redis.expire(k, WINDOW_SECONDS);
    }
  }

  async clear(scope: string, id: string): Promise<void> {
    await this.redis.del(this.key(scope, id));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
