// 017 — Phase 7 (ADR-014): Admin Control Plane.
// Additive: admin.user.read / admin.user.manage / flag.manage granted to PLATFORM_ADMIN
// only; verification_history gains reason_code for structured KYB rejection/correction
// reasons (CORRECTION_REQUIRED displays as "Correction requested", never a new state).
// NOTE: identity.users.status already permits SUSPENDED (migration 002) — no CHECK change.
exports.up = async (client) => {
  await client.query(`
    INSERT INTO identity.permissions (code, description) VALUES
      ('admin.user.read','Platform-level user account read (masked, no credentials)'),
      ('admin.user.manage','User account governance: suspend/reactivate with reason — no IAM mutation, no MFA bypass'),
      ('flag.manage','Manage feature flags (effective-dated, audited)')
    ON CONFLICT (code) DO NOTHING;
    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND ro.name = 'PLATFORM_ADMIN'
      AND pe.code IN ('admin.user.read','admin.user.manage','flag.manage')
    ON CONFLICT DO NOTHING;
    ALTER TABLE identity.verification_history ADD COLUMN IF NOT EXISTS reason_code TEXT;
  `);
};

exports.down = async (client) => {
  await client.query(`
    ALTER TABLE identity.verification_history DROP COLUMN IF EXISTS reason_code;
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN ('admin.user.read','admin.user.manage','flag.manage'));
    DELETE FROM identity.permissions WHERE code IN ('admin.user.read','admin.user.manage','flag.manage');
  `);
};
