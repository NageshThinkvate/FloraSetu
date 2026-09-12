import { createHmac, timingSafeEqual } from 'crypto';

export interface TokenClaims {
  sub: string;
  orgId: string;
  roles: string[];
  permissions: string[];
}

export interface AuthTokenVerifier {
  verify(token: string): TokenClaims | null;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Dev-token format: base64url(json) + '.' + hmac_sha256_hex. OIDC provider replaces this (OD-02).
export class DevTokenVerifier implements AuthTokenVerifier {
  constructor(private readonly secret: string) {}

  verify(token: string): TokenClaims | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) {
      return null;
    }
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    try {
      return JSON.parse(b64urlDecode(payload).toString('utf8')) as TokenClaims;
    } catch {
      return null;
    }
  }

  sign(claims: TokenClaims): string {
    const payload = b64url(JSON.stringify(claims));
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }
}
