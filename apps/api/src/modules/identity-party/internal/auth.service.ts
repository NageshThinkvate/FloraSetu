import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'crypto';
import { AppConfig } from '../../../config/configuration';
import { APP_CONFIG } from '../../../common/database/database.module';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { RateLimitService } from '../../../common/rate-limit/rate-limit.service';
import { DevTokenVerifier } from '../../../common/authz/token-verifier';
import { ApiException } from '../../../common/errors/error-envelope';

const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_DAYS = 7;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly verifier: DevTokenVerifier;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {
    this.verifier = new DevTokenVerifier(config.jwtDevSecret);
  }

  async register(email: string, password: string, displayName: string): Promise<{ userId: string } & TokenPair> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Invalid email');
    }
    if (!displayName?.trim()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'displayName is required');
    }
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Password must be 10+ chars with letters and numbers');
    }
    const existing = await this.db.query('SELECT 1 FROM identity.users WHERE email = $1', [normalized]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ApiException(409, 'CONFLICT', 'Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = await this.db.withTransaction(async (client) => {
      const ref = await client.query<{ next: string }>(
        `INSERT INTO core.reference_counters (entity, year, next_value) VALUES ('USR', 2026, 2)
         ON CONFLICT (entity, year) DO UPDATE SET next_value = core.reference_counters.next_value + 1
         RETURNING next_value - 1 AS next`
      );
      const usrRef = `USR-2026-${String(Number(ref.rows[0].next)).padStart(6, '0')}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO identity.users (ref, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [usrRef, normalized, displayName.trim()]
      );
      const id = inserted.rows[0].id;
      await client.query('INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)', [id, passwordHash]);
      await client.query(
        `INSERT INTO identity.auth_identities (user_id, provider, subject) VALUES ($1, 'password', $2)`,
        [id, normalized]
      );
      await this.audit.record(client, { action: 'user.register', objectType: 'user', objectId: id, objectRef: usrRef });
      await this.outbox.emit(client, {
        aggregateType: 'user', aggregateId: id, type: 'party.user.registered', payload: { userId: id }
      });
      return id;
    });
    const tokens = await this.issueTokens(userId);
    return { userId, ...tokens };
  }

  async login(email: string, password: string, mfaCode: string | undefined, ip: string): Promise<{ userId: string } & TokenPair> {
    const normalized = email.trim().toLowerCase();
    // Account-scoped lockout key: source IPs are unreliable behind ingress load-balancing.
    const lockKey = normalized;
    const lockedFor = await this.rateLimit.isLocked('login', lockKey);
    if (lockedFor > 0) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many failed attempts; temporarily locked', { retryAfterSeconds: lockedFor });
    }
    const found = await this.db.query<{ id: string; status: string; password_hash: string }>(
      `SELECT u.id, u.status, c.password_hash FROM identity.users u
       JOIN identity.user_credentials c ON c.user_id = u.id WHERE u.email = $1`,
      [normalized]
    );
    const user = found.rows[0];
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !ok) {
      await this.rateLimit.recordFailure('login', lockKey);
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiException(403, 'FORBIDDEN', `User is ${user.status.toLowerCase()}`);
    }
    const mfa = await this.db.query<{ secret_ref: string }>(
      `SELECT secret_ref FROM identity.mfa_enrollments WHERE user_id = $1 AND status = 'ACTIVE'`,
      [user.id]
    );
    if (mfa.rowCount && mfa.rowCount > 0) {
      if (!mfaCode) {
        throw new ApiException(401, 'MFA_REQUIRED', 'MFA code required', { mfaRequired: true });
      }
      if (!authenticator.check(mfaCode, mfa.rows[0].secret_ref)) {
        await this.rateLimit.recordFailure('login', lockKey);
        throw new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid MFA code');
      }
    }
    await this.rateLimit.clear('login', lockKey);
    const tokens = await this.issueTokens(user.id, ip);
    return { userId: user.id, ...tokens };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.hashRefresh(refreshToken);
    const result = await this.db.query<{ id: string; user_id: string }>(
      `UPDATE identity.refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id, user_id`,
      [hash]
    );
    if (result.rowCount === 0) {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Invalid or expired refresh token');
    }
    return this.issueTokens(result.rows[0].user_id);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
      this.hashRefresh(refreshToken)
    ]);
  }

  // Password recovery (owner directive): neutral anti-enumeration response, rate-limited
  // per email, single-use 60-minute tokens stored only as SHA-256 hashes. The raw token
  // is never logged; in non-production it is returned as devResetToken because the pilot
  // has no outbound email provider (documented pilot limitation).
  async forgotPassword(email: string): Promise<{ ok: true; devResetToken?: string }> {
    const normalized = (email ?? '').trim().toLowerCase();
    const lockedFor = await this.rateLimit.isLocked('password-reset', normalized);
    if (lockedFor > 0) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many attempts; temporarily locked', { retryAfterSeconds: lockedFor });
    }
    await this.rateLimit.recordFailure('password-reset', normalized);
    const found = await this.db.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [normalized]
    );
    const user = found.rows[0];
    if (!user) {
      return { ok: true };
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE identity.password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      await client.query(
        `INSERT INTO identity.password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '60 minutes')`,
        [user.id, tokenHash]
      );
      await this.audit.record(client, { action: 'auth.password_reset.requested', objectType: 'user', objectId: user.id });
    });
    return this.config.nodeEnv === 'production' ? { ok: true } : { ok: true, devResetToken: token };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    if (!token || password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Password must be 10+ chars with letters and numbers');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.db.withTransaction(async (client) => {
      const found = await client.query<{ id: string; user_id: string }>(
        `UPDATE identity.password_reset_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING id, user_id`,
        [tokenHash]
      );
      if (found.rowCount === 0) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'This reset link is invalid, expired or already used. Request a new one.');
      }
      const userId = found.rows[0].user_id;
      const passwordHash = await bcrypt.hash(password, 10);
      await client.query('UPDATE identity.user_credentials SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
      // Session security: every active session is revoked after a password change.
      await client.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await this.audit.record(client, { action: 'auth.password_reset.completed', objectType: 'user', objectId: userId });
    });
  }

  async mfaEnroll(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    await this.db.query(`DELETE FROM identity.mfa_enrollments WHERE user_id = $1 AND status = 'PENDING'`, [userId]);
    await this.db.query(
      `INSERT INTO identity.mfa_enrollments (user_id, method, secret_ref, status) VALUES ($1, 'TOTP', $2, 'PENDING')`,
      [userId, secret]
    );
    const url = authenticator.keyuri(`user:${userId}`, 'FloraSetu', secret);
    return { secret, otpauthUrl: url };
  }

  async mfaVerify(userId: string, code: string): Promise<void> {
    const pending = await this.db.query<{ id: string; secret_ref: string }>(
      `SELECT id, secret_ref FROM identity.mfa_enrollments WHERE user_id = $1 AND status = 'PENDING'`,
      [userId]
    );
    const row = pending.rows[0];
    if (!row || !authenticator.check(code, row.secret_ref)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Invalid MFA code');
    }
    await this.db.query(`UPDATE identity.mfa_enrollments SET status = 'ACTIVE' WHERE id = $1`, [row.id]);
  }

  async me(userId: string): Promise<Record<string, unknown>> {
    const user = await this.db.query(
      `SELECT id, ref, email, display_name, status FROM identity.users WHERE id = $1`,
      [userId]
    );
    if (user.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'User not found');
    }
    const memberships = await this.db.query(
      `SELECT m.org_id, o.name, o.type, o.status AS org_status, m.status AS membership_status, o.capabilities,
              COALESCE(array_agg(DISTINCT ro.name) FILTER (WHERE ro.name IS NOT NULL), '{}') AS roles
       FROM identity.org_memberships m
       JOIN identity.organizations o ON o.id = m.org_id
       LEFT JOIN identity.user_roles ur ON ur.user_id = m.user_id AND ur.org_id = m.org_id
       LEFT JOIN identity.roles ro ON ro.id = ur.role_id
       WHERE m.user_id = $1
       GROUP BY m.org_id, o.name, o.type, o.status, m.status, o.capabilities`,
      [userId]
    );
    const mfa = await this.db.query(
      `SELECT status FROM identity.mfa_enrollments WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId]
    );
    return {
      ...user.rows[0],
      mfaActive: (mfa.rowCount ?? 0) > 0,
      memberships: memberships.rows
    };
  }

  private async issueTokens(userId: string, ip?: string): Promise<TokenPair> {
    const accessToken = this.verifier.sign({
      sub: userId,
      type: 'access',
      exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.query(
      `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at, ip)
       VALUES ($1, $2, now() + interval '${REFRESH_TTL_DAYS} days', $3)`,
      [userId, this.hashRefresh(refreshToken), ip ?? null]
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  private hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
