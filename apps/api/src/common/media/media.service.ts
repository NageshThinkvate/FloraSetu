import { Injectable } from '@nestjs/common';

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

// Stub signer until OD-03 selects the S3-compatible endpoint. Private-by-default contract:
// callers must pass an authorization proof; URLs are short-lived and per-object.
@Injectable()
export class MediaService {
  async signRead(objectKey: string, ttlSeconds = 300): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return { url: `stub://media/${encodeURIComponent(objectKey)}?expires=${expiresAt.getTime()}`, expiresAt };
  }
}
