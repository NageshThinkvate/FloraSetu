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

export interface LogisticsColdchainService {
  contextKey(): 'logistics-coldchain';
  getPodForOrder(orderId: string): Promise<PodSnapshot[]>;
  getShipmentSnapshot(shipmentId: string): Promise<{
    id: string; orderId: string; status: string; supplierOrgId: string | null;
  } | null>;
  // ADR-002: an open severe exception blocks buyer acceptance / supplier settlement.
  hasBlockingException(orderId: string): Promise<boolean>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
}

export const LogisticsColdchain_SERVICE = 'LogisticsColdchain_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type LogisticsColdchainEvent =
  | { v: 1; type: 'shipment.dispatched'; shipmentId: string; orderId: string; at: string }
  | { v: 1; type: 'shipment.pod_recorded'; shipmentId: string; orderId: string; at: string }
  | { v: 1; type: 'shipment.exception_reported'; shipmentId: string; severity: string; at: string };
