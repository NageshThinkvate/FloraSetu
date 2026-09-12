import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { LogisticsColdchainService, PodSnapshot } from '../contracts';

@Injectable()
export class LogisticsColdchainServiceImpl implements LogisticsColdchainService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'logistics-coldchain' {
    return 'logistics-coldchain';
  }

  async getPodForOrder(orderId: string): Promise<PodSnapshot[]> {
    const r = await this.db.query(
      `SELECT p.id, p.shipment_id, p.order_id, p.delivered_qty, p.received_at, p.shortage_flag, p.damage_flag
       FROM logistics.pod_records p WHERE p.order_id = $1`, [orderId]);
    return r.rows.map((p) => ({
      id: p.id, shipmentId: p.shipment_id, orderId: p.order_id,
      deliveredQty: Number(p.delivered_qty), receivedAt: p.received_at,
      shortageFlag: p.shortage_flag, damageFlag: p.damage_flag
    }));
  }

  async getShipmentSnapshot(shipmentId: string) {
    const r = await this.db.query(
      `SELECT id, order_id, status, supplier_org_id FROM logistics.shipments WHERE id = $1`, [shipmentId]);
    if (r.rowCount === 0) {
      return null;
    }
    const s = r.rows[0];
    return { id: s.id, orderId: s.order_id, status: s.status, supplierOrgId: s.supplier_org_id };
  }

  // ADR-002: open severe exception blocks acceptance/settlement until ops resolves.
  async hasBlockingException(orderId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM logistics.shipment_exceptions e
       JOIN logistics.shipments s ON s.id = e.shipment_id
       WHERE s.order_id = $1 AND e.status = 'OPEN'
         AND (e.blocks_buyer_acceptance OR e.blocks_supplier_settlement) LIMIT 1`,
      [orderId]);
    return (r.rowCount ?? 0) > 0;
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const [dispatchOverdue, etaOverdue, podMissing, openExceptions] = await Promise.all([
      this.db.query(
        `SELECT id, ref, order_id, created_at FROM logistics.shipments
         WHERE status = 'PLANNED' AND created_at < now() - interval '12 hours' LIMIT 50`),
      this.db.query(
        `SELECT id, ref, order_id, eta FROM logistics.shipments
         WHERE status = 'IN_TRANSIT' AND eta IS NOT NULL AND eta < now() LIMIT 50`),
      this.db.query(
        `SELECT s.id, s.ref, s.order_id, s.dispatched_at FROM logistics.shipments s
         WHERE s.status = 'IN_TRANSIT' AND s.dispatched_at < now() - interval '24 hours'
           AND NOT EXISTS (SELECT 1 FROM logistics.pod_records p WHERE p.shipment_id = s.id) LIMIT 50`),
      this.db.query(
        `SELECT e.id, e.shipment_id, e.status, e.blocks_buyer_acceptance, e.blocks_supplier_settlement
         FROM logistics.shipment_exceptions e WHERE e.status = 'OPEN' LIMIT 50`)
    ]);
    return {
      dispatchOverdue: dispatchOverdue.rows,
      etaOverdue: etaOverdue.rows,
      podMissing: podMissing.rows,
      openShipmentExceptions: openExceptions.rows
    };
  }
}
