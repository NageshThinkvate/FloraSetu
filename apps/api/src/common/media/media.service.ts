import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../database/database.service';
import { AppConfig } from '../../config/configuration';
import { APP_CONFIG } from '../database/database.module';
import { ApiException } from '../errors/error-envelope';

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface StoredMedia {
  id: string;
  objectKey: string;
}

// DEV/LOCAL storage until OD-03 selects the S3-compatible provider.
// PILOT PRODUCTION BLOCKER: OD-03 — replace local-disk store with durable object storage
// before live pilot media. Private-by-default contract: reads require a short-lived
// HMAC-signed URL; the raw endpoint never leaks object existence without a valid signature.
@Injectable()
export class MediaService {
  private readonly dir: string;

  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {
    this.dir = process.env.MEDIA_LOCAL_DIR ?? '/app/media';
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async store(orgId: string, contentType: string, dataBase64: string, bucket = 'pilot'): Promise<StoredMedia> {
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Media must be 1 byte to 15MB');
    }
    const id = randomUUID();
    fs.writeFileSync(path.join(this.dir, id), bytes);
    // id == object_key by construction: consumers reference a single unambiguous handle.
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO core.media_objects (id, org_id, bucket, object_key, content_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, orgId, bucket, id, contentType, bytes.length]
    );
    return { id: result.rows[0].id, objectKey: id };
  }

  // Short-lived signed read URL (dev format). Callers must authorize BEFORE signing.
  async signRead(objectKey: string, ttlSeconds = 300): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.signature(objectKey, exp);
    return { url: `/api/media/raw/${encodeURIComponent(objectKey)}?exp=${exp}&sig=${sig}`, expiresAt };
  }

  verifySignature(objectKey: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
      return false;
    }
    return this.timingSafeEq(this.signature(objectKey, exp), sig);
  }

  private signature(objectKey: string, exp: number): string {
    return createHmac('sha256', this.config.jwtDevSecret).update(`${objectKey}.${exp}`).digest('hex');
  }

  private timingSafeEq(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  async readRaw(objectKey: string): Promise<{ contentType: string; bytes: Buffer }> {
    const row = await this.db.query<{ content_type: string }>(
      `SELECT content_type FROM core.media_objects WHERE object_key = $1`, [objectKey]);
    if (row.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Media not found');
    }
    const file = path.join(this.dir, path.basename(objectKey));
    if (!fs.existsSync(file)) {
      throw new ApiException(404, 'NOT_FOUND', 'Media not found');
    }
    return { contentType: row.rows[0].content_type, bytes: fs.readFileSync(file) };
  }
}
