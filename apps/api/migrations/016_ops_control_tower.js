// 016 — Phase 6 (ADR-013): Operations Control Tower permissions.
// Additive: tower.read gates the composed staff read surface; claim.read grants
// claims/evidence visibility without decision power (claim.manage unchanged).
exports.up = async (client) => {
  await client.query(`
    INSERT INTO identity.permissions (code, description) VALUES
      ('tower.read','Operations control tower read surface (board, monitors, search, export)'),
      ('claim.read','Read claims and evidence across organizations (no decision power)')
    ON CONFLICT (code) DO NOTHING;
    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND (
      (ro.name IN ('PROCUREMENT_OPS','SUPPORT_AGENT','FINANCE_OPS','PLATFORM_ADMIN') AND pe.code = 'tower.read')
      OR (ro.name IN ('SUPPORT_AGENT','FINANCE_OPS','PLATFORM_ADMIN') AND pe.code = 'claim.read')
    )
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN ('tower.read','claim.read'));
    DELETE FROM identity.permissions WHERE code IN ('tower.read','claim.read');
  `);
};
