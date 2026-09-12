import Joi from 'joi';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtDevSecret: string;
  corsOrigins: string[];
  rateLimitPerMinute: number;
  catalogAllowDemoMasters: boolean;
}

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').required(),
  PORT: Joi.number().port().required(),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis'] }).required(),
  JWT_DEV_SECRET: Joi.string().min(16).required(),
  CORS_ORIGINS: Joi.string().required(),
  RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).required(),
  CATALOG_ALLOW_DEMO_MASTERS: Joi.string().optional()
});

export function loadConfig(): AppConfig {
  const { error, value } = schema.validate(process.env, { allowUnknown: true });
  if (error) {
    throw new Error(`Invalid environment: ${error.message}`);
  }
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    jwtDevSecret: value.JWT_DEV_SECRET,
    corsOrigins: String(value.CORS_ORIGINS).split(','),
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    catalogAllowDemoMasters: demoFlag(value.NODE_ENV, value.CATALOG_ALLOW_DEMO_MASTERS)
  };
}

// GUARDRAIL A: DEMO masters fail closed. Only explicit 'true' in a non-production
// environment permits demo data; absent/malformed/false => prohibited. In production,
// ANY configured value is a hard startup error (never silently permissive).
function demoFlag(nodeEnv: string, raw: string | undefined): boolean {
  if (nodeEnv === 'production' && raw !== undefined) {
    throw new Error('CATALOG_ALLOW_DEMO_MASTERS must not be configured in production');
  }
  return raw === 'true' && nodeEnv !== 'production';
}
