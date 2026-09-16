// Public contract surface of the LogisticsColdchain bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface PodSnapshot {
  id: string;
  shipmentId: string;
  orderId: string;
  deliveredQty: number;
  receivedAt: string;
  shortageFlag: boolean;
  damageFlag: boolean;
}

export interface ShipmentMediaEvidence {
  id: string; purpose: string; contentType: string; capturedAt: string; url: string;
}

// ADR-011 evidence pack (Phase 3): buyer-facing logistics leg with media + POD.
export interface ShipmentEvidence {
  id: string; ref: string; status: string; mode: string; carrierName: string | null;
  parcelAwbRef: string | null; transportRef: string | null; packageCount: number | null;
  pickupAt: string | null; dispatchedAt: string | null; eta: string | null; actualArrivalAt: string | null;
  logisticsOrgId: string | null;
  media: ShipmentMediaEvidence[];
  pods: { id: string; deliveredQty: number; receiverName: string | null; receivedAt: string }[];
}

export interface PackEvidence {
  id: string; ref: string; packedQty: number; packType: string | null;
  cartonCount: number | null; packedAt: string;
}

export interface LogisticsColdchainService {
  contextKey(): 'logistics-coldchain';
  getPodForOrder(orderId: string): Promise<PodSnapshot[]>;
  getShipmentSnapshot(shipmentId: string): Promise<{
    id: string; orderId: string; status: string; supplierOrgId: string | null;
  } | null>;
  // ADR-002: an open severe exception blocks buyer acceptance / supplier settlement.
  hasBlockingException(orderId: string): Promise<boolean>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
  // ADR-011 evidence pack (Phase 3): signed-URL evidence; caller authorizes.
  getShipmentsEvidenceForOrder(orderId: string): Promise<ShipmentEvidence[]>;
  getPackEvidenceForOrder(orderId: string): Promise<PackEvidence[]>;
  // ADR-013 (Phase 6): staff logistics monitor — read-only composition (monitor + support,
  // never execution; ADR-012 denials unchanged).
  opsMonitor(): Promise<OpsShipmentRow[]>;
  searchShipments(q: string): Promise<OpsShipmentRow[]>;
}

export interface OpsShipmentRow {
  id: string; ref: string; orderId: string; status: string; mode: string | null;
  logisticsOrgId: string | null; originText: string | null; destinationText: string | null;
  carrierName: string | null; transportRef: string | null; parcelAwbRef: string | null;
  packageCount: number | null; tempControlled: boolean | null;
  pickupAt: string | null; etd: string | null; eta: string | null;
  jobAcceptedAt: string | null; arrivedPickupAt: string | null; arrivedDeliveryAt: string | null;
  dispatchedAt: string | null; actualArrivalAt: string | null; createdAt: string;
  driverAssigned: boolean; openExceptions: number; openExceptionTypes: string[]; hasPod: boolean;
}

export const LogisticsColdchain_SERVICE = 'LogisticsColdchain_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type LogisticsColdchainEvent =
  | { v: 1; type: 'shipment.dispatched'; shipmentId: string; orderId: string; at: string }
  | { v: 1; type: 'shipment.pod_recorded'; shipmentId: string; orderId: string; at: string }
  | { v: 1; type: 'shipment.exception_reported'; shipmentId: string; severity: string; at: string };
