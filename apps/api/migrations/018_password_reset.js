// 018 — Public-site/auth polish: password-recovery tokens (owner directive).
// Additive: single-use, SHA-256-hashed, 60-minute reset tokens. The raw token is never
// stored or logged; sessions (refresh tokens) are revoked on successful reset.
exports.up = async (client) => {
  await client.query(`
    CREATE TABLE identity.password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX password_reset_tokens_user ON identity.password_reset_tokens (user_id);
  `);
};

exports.down = async (client) => {
  await client.query(`
    DROP TABLE IF EXISTS identity.password_reset_tokens;
  `);
};
