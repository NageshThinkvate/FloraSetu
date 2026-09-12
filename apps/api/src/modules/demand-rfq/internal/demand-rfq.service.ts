import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { AwardSnapshot, DemandRfqService } from '../contracts';

@Injectable()
export class DemandRfqServiceImpl implements DemandRfqService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'demand-rfq' {
    return 'demand-rfq';
  }

  async requirementExists(requirementId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM demand.requirements WHERE id = $1`,
      [requirementId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // Committed award snapshot: requirement + RFQ + accepted quotation versions + specs.
  async getAwardSnapshot(awardId: string): Promise<AwardSnapshot | null> {
    const award = await this.db.query(
      `SELECT a.id, a.ref, a.status, a.requirement_id, a.rfq_id, a.buyer_org_id, a.buyer_consent, a.conditions
       FROM demand.awards a WHERE a.id = $1`,
      [awardId]
    );
    if (award.rowCount === 0) {
      return null;
    }
    const a = award.rows[0];
    const req = await this.db.query(
      `SELECT r.ref, r.event_id,
              (SELECT rl.delivery_destination FROM demand.requirement_lines rl
                JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
                WHERE rl.requirement_id = r.id AND rv.version_no = r.current_version_no
                ORDER BY rl.created_at LIMIT 1) AS delivery_destination
       FROM demand.requirements r WHERE r.id = $1`,
      [a.requirement_id]
    );
    const rfq = await this.db.query(
      `SELECT delivery_requirements FROM demand.rfqs WHERE id = $1`,
      [a.rfq_id]
    );
    const lines = await this.db.query(
      `SELECT al.id AS award_line_id, al.requirement_line_id, al.quotation_version_id,
              al.supplier_org_id, al.awarded_qty, al.uom_id, al.unit_price_minor, al.currency,
              al.accepted_spec,
              EXISTS (
                SELECT 1 FROM demand.quotation_lines ql
                WHERE ql.quotation_version_id = al.quotation_version_id
                  AND ql.requirement_line_id = al.requirement_line_id
                  AND (ql.deviation_note IS NOT NULL OR ql.proposes_substitution = true)
              ) AS has_deviation
       FROM demand.award_lines al WHERE al.award_id = $1 ORDER BY al.created_at`,
      [awardId]
    );
    return {
      awardId: a.id,
      ref: a.ref,
      status: a.status,
      requirementId: a.requirement_id,
      requirementRef: req.rows[0]?.ref,
      eventId: req.rows[0]?.event_id ?? null,
      rfqId: a.rfq_id,
      buyerOrgId: a.buyer_org_id,
      buyerConsent: a.buyer_consent ?? null,
      conditions: a.conditions ?? null,
      deliveryDestination: req.rows[0]?.delivery_destination ?? '',
      deliveryRequirements: rfq.rows[0]?.delivery_requirements ?? null,
      lines: lines.rows.map((l) => ({
        awardLineId: l.award_line_id,
        requirementLineId: l.requirement_line_id,
        quotationVersionId: l.quotation_version_id,
        supplierOrgId: l.supplier_org_id,
        awardedQty: Number(l.awarded_qty),
        uomId: l.uom_id,
        unitPriceMinor: Number(l.unit_price_minor),
        currency: l.currency,
        acceptedSpec: l.accepted_spec ?? null,
        hasDeviation: l.has_deviation
      }))
    };
  }

  async markRequirementConverted(requirementId: string, orderId: string): Promise<void> {
    const updated = await this.db.query(
      `UPDATE demand.requirements SET status = 'CONVERTED', version = version + 1, updated_at = now()
       WHERE id = $1 AND status = 'AWARDED'`,
      [requirementId]
    );
    if (updated.rowCount === 0) {
      throw new ApiException(409, 'CONFLICT', 'Requirement is not in AWARDED state', {
        code_detail: 'ILLEGAL_TRANSITION'
      });
    }
    await this.db.query(
      `UPDATE demand.requirements SET updated_at = now() WHERE id = $1`, [requirementId]
    );
    void orderId;
  }

  async listFinalAwards(): Promise<{ id: string; ref: string; buyerOrgId: string; createdAt: string }[]> {
    const r = await this.db.query(
      `SELECT id, ref, buyer_org_id, created_at FROM demand.awards
       WHERE status = 'FINAL' ORDER BY created_at DESC LIMIT 100`);
    return r.rows.map((a) => ({
      id: a.id, ref: a.ref, buyerOrgId: a.buyer_org_id, createdAt: a.created_at
    }));
  }
}
