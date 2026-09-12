// 011 — Build 3 fix: RFQ lines may be commodity-level (no variety). Requirement lines
// already allow null variety; the legacy NOT NULL from 004 rejected QUICK requests
// that specify only a commodity. Canonical model derives RFQ lines 1:1, so nullability
// must match.
exports.up = async (client) => {
  await client.query(`
    ALTER TABLE demand.rfq_lines ALTER COLUMN variety_id DROP NOT NULL;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM demand.rfq_lines WHERE variety_id IS NULL;
    ALTER TABLE demand.rfq_lines ALTER COLUMN variety_id SET NOT NULL;
  `);
};
