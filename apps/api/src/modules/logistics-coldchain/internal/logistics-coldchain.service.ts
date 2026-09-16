import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { MediaService } from '../../../common/media/media.service';
import {
  LogisticsColdchainService, PackEvidence, PodSnapshot, ShipmentEvidence
} from '../contracts';

@Injectable()
export class LogisticsColdchainServiceImpl implements LogisticsColdchainService {
  constructor(private readonly db: DatabaseService, private readonly media: MediaService) {}

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

  // ADR-011 Phase 3: buyer evidence pack legs. Signed URLs minted here; object-level
  // authorization happens in the calling context (order-allocation).
  async getShipmentsEvidenceForOrder(orderId: string): Promise<ShipmentEvidence[]> {
    const shipments = await this.db.query<{
      id: string; ref: string; status: string; mode: string; carrier_name: string | null;
      parcel_awb_ref: string | null; transport_ref: string | null; package_count: number | null;
      pickup_at: string | null; dispatched_at: string | null; eta: string | null;
      actual_arrival_at: string | null; logistics_org_id: string | null;
    }>(
      `SELECT id, ref, status, mode, carrier_name, parcel_awb_ref, transport_ref, package_count,
              pickup_at, dispatched_at, eta, actual_arrival_at, logistics_org_id
       FROM logistics.shipments WHERE order_id = $1 ORDER BY created_at`, [orderId]);
    const out: ShipmentEvidence[] = [];
    for (const s of shipments.rows) {
      const media = await this.db.query<{
        id: string; purpose: string; captured_at: string; media_object_id: string; content_type: string;
      }>(
        `SELECT sm.id, sm.purpose, sm.captured_at, sm.media_object_id, mo.content_type
         FROM logistics.shipment_media sm JOIN core.media_objects mo ON mo.id = sm.media_object_id
         WHERE sm.shipment_id = $1 ORDER BY sm.captured_at`, [s.id]);
      const pods = await this.db.query<{
        id: string; delivered_qty: string; receiver_name: string | null; received_at: string;
      }>(
        `SELECT id, delivered_qty, receiver_name, received_at FROM logistics.pod_records
         WHERE shipment_id = $1`, [s.id]);
      out.push({
        id: s.id, ref: s.ref, status: s.status, mode: s.mode, carrierName: s.carrier_name,
        parcelAwbRef: s.parcel_awb_ref, transportRef: s.transport_ref, packageCount: s.package_count,
        pickupAt: s.pickup_at, dispatchedAt: s.dispatched_at, eta: s.eta,
        actualArrivalAt: s.actual_arrival_at, logisticsOrgId: s.logistics_org_id,
        media: await Promise.all(media.rows.map(async (m) => ({
          id: m.id, purpose: m.purpose, contentType: m.content_type,
          capturedAt: m.captured_at, url: (await this.media.signRead(m.media_object_id, 300)).url
        }))),
        pods: pods.rows.map((p) => ({
          id: p.id, deliveredQty: Number(p.delivered_qty), receiverName: p.receiver_name, receivedAt: p.received_at
        }))
      });
    }
    return out;
  }

  async getPackEvidenceForOrder(orderId: string): Promise<PackEvidence[]> {
    const r = await this.db.query<{
      id: string; ref: string; packed_qty: string; pack_type: string | null;
      carton_count: number | null; packed_at: string;
    }>(
      `SELECT id, ref, packed_qty, pack_type, carton_count, packed_at
       FROM logistics.pack_records WHERE order_id = $1 ORDER BY packed_at`, [orderId]);
    return r.rows.map((p) => ({
      id: p.id, ref: p.ref, packedQty: Number(p.packed_qty), packType: p.pack_type,
      cartonCount: p.carton_count, packedAt: p.packed_at
    }));
  }
}
