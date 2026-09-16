// Typed wrappers for the Build 4 pilot fulfilment API surface.
import { apiGet, apiPost, newIdempotencyKey } from './client';

export interface OrderSummary {
  id: string; ref: string; status: string; total_minor: number; currency: string;
  delivery_destination: string | null; created_at: string; suppliers: number; lines: number;
}
export interface OrderLineRow {
  id: string; variety_id: string | null; qty: string; agreed_unit_price_minor: string;
  currency: string; uom_id: string; spec_snapshot: Record<string, unknown>;
}
export interface AllocationRow {
  id: string; ref: string; supplier_org_id: string; status: string; delivery_commitment: string | null;
}
export interface AllocationLineRow {
  id: string; allocation_id?: string; order_line_id: string; awarded_qty: string; uom_id: string;
  unit_price_minor: string; currency: string; accepted_spec: Record<string, unknown>;
  fulfilment_status: string; supplier_org_id?: string;
}
export interface LotAllocationRow {
  id: string; lot_id: string; qty: string; supplier_allocation_line_id: string;
  status: string; order_line_id?: string;
}
export interface HistoryRow { from_status: string | null; to_status: string; reason: string | null; changed_at: string }
export interface BuyerOrderDetail {
  id: string; ref: string; status: string; total_minor: number; currency: string;
  delivery_destination: string | null; created_at: string; accepted_qty: string | null;
  disputed_qty: string | null; accepted_at: string | null; cancel_reason: string | null;
  closed_at: string | null; buyer_org_id: string;
  lines: OrderLineRow[]; allocations: AllocationRow[]; allocationLines: AllocationLineRow[];
  lotAllocations: LotAllocationRow[]; history: HistoryRow[];
}
export interface SupplierOrderDetail {
  id: string; ref: string; status: string; delivery_destination: string | null;
  allocation: AllocationRow; lines: AllocationLineRow[]; lotAllocations: LotAllocationRow[];
}
export type OrderDetail = BuyerOrderDetail | SupplierOrderDetail;
export const isSupplierSlice = (o: OrderDetail): o is SupplierOrderDetail => 'allocation' in o;

export interface SupplierAllocationSummary {
  id: string; ref: string; status: string; delivery_commitment: string | null; created_at: string;
  order_id: string; order_ref: string; delivery_destination: string | null; lines: AllocationLineRow[];
}

export interface LotSummary {
  id: string; variety_id: string | null; commodity_id: string; status: string; source_flow: string;
  origin_type: string; declared_qty: string; available_qty: string; reserved_qty: string;
  allocated_qty: string; packed_qty: string; dispatched_qty: string; delivered_qty: string;
  qc_accepted_qty: string | null; qc_rejected_qty: string | null; qc_held_qty: string | null;
  harvest_at: string | null; received_at: string | null; created_at: string; media_count: number;
}
export interface LotMediaRow { id: string; media_object_id: string; purpose: string; inspection_id: string | null; captured_at: string; url?: string }
export interface ReservationRow { id: string; order_id: string; qty: string; status: string; created_at: string }
export type LotDetail = LotSummary & {
  ref: string; org_id: string; uom_id: string; grade_profile_id: string | null;
  colour_code: string | null; origin_detail: string | null;
  quality_basis: string; declared_stem_length_cm: string | null; bloom_stage: string | null;
  batch_ref: string | null; declaration_notes: string | null; declared_at: string | null;
  media: LotMediaRow[]; reservations: ReservationRow[];
};

export interface QcQueueLot {
  id: string; orgId: string; status: string; commodityId: string; varietyId: string | null;
  uomId: string; declaredQty: number | null; availableQty: number; allocatedQty: number;
  qcAcceptedQty: number | null; gradeProfileId: string | null; originType: string;
}
export interface CustodyRow {
  id: string; lot_id: string; order_id: string | null; shipment_id: string | null;
  from_org_id: string; to_org_id: string; event_type: string; occurred_at: string;
  location_text: string | null; condition_note: string | null; temperature_c: string | null;
}

export interface PackRow {
  id: string; ref: string; lot_id: string; supplier_allocation_line_id: string; pack_type: string | null;
  bunch_count: number | null; carton_count: number | null; packed_qty: string; uom_id: string;
  label_ref: string | null; seal_ref: string | null; packed_at: string;
}
export interface PodRow {
  id: string; delivered_qty: string; receiver_name: string | null; shortage_flag: boolean;
  damage_flag: boolean; exception_note: string | null; notes: string | null; created_at: string;
}
export interface ShipmentExceptionRow {
  id: string; status: string; blocks_buyer_acceptance: boolean; blocks_supplier_settlement: boolean;
}
export interface ShipmentRow {
  id: string; ref: string; order_id: string; status: string; mode: string; temp_controlled: boolean;
  carrier_name: string | null; origin_text: string | null; destination_text: string | null;
  transport_ref: string | null; parcel_awb_ref: string | null; package_count: number | null;
  pickup_at: string | null; etd: string | null; eta: string | null; dispatched_at: string | null;
  actual_arrival_at: string | null; acceptance_hold: boolean; exception_note: string | null; created_at: string;
  pods?: PodRow[]; exceptions?: ShipmentExceptionRow[];
}

export interface PaymentRow {
  id: string; ref: string; amount_minor: string; currency: string; method: string;
  external_ref: string; status: string; record_kind: string; paid_at: string;
  recorded_by: string; verified_by: string | null; verified_at: string | null; created_at: string;
}
export interface SettlementRow {
  id: string; ref: string; org_id: string; order_id?: string; status: string;
  gross_minor: string; deductions: { label: string; amountMinor: number }[] | null;
  claim_adjustment_minor: string; net_minor: string; payout_ref: string | null;
  payout_date: string | null; completed_at: string | null; updated_at: string;
}

export interface ClaimRow {
  id: string; ref: string; order_id: string; category: string; claim_type: string;
  status: string; disputed_qty: string | null; created_at: string; response_at: string | null;
}
export interface ClaimEvidenceRow { id: string; media_object_id: string; note: string | null; created_at: string }
export interface ClaimDecisionRow { id: string; outcome: string; adjustment_minor: string | null; created_at: string }
export type ClaimDetail = ClaimRow & {
  description?: string; counterparty_response?: string | null; resolution_note?: string | null;
  supplier_org_id?: string; org_id?: string;
  evidences: ClaimEvidenceRow[]; decisions: ClaimDecisionRow[];
};

export interface TowerExceptions {
  awardNotConverted: { id: string; ref?: string; status?: string; created_at?: string }[];
  supplierNotConfirmed: { id: string; ref: string; created_at: string }[];
  orderShortAfterQc: { id: string; order_id: string; order_ref: string; awarded_qty: string; allocated_qty: string }[];
  buyerAcceptancePending: { id: string; ref: string; updated_at: string }[];
  lotAwaitingQc: { id: string; org_id: string; declared_qty: string; created_at: string }[];
  qcHoldOrReject: { id: string; org_id: string; qc_held_qty: string }[];
  packedAwaitingDispatch: { id: string; org_id: string; packed_qty: string; dispatched_qty: string }[];
  openInspections: { id: string; lot_id: string; created_at: string }[];
  dispatchOverdue: { id: string; ref: string; order_id: string; created_at: string }[];
  etaOverdue: { id: string; ref: string; order_id: string; eta: string }[];
  podMissing: { id: string; ref: string; order_id: string; dispatched_at: string }[];
  openShipmentExceptions: { id: string; shipment_id: string; status: string; blocks_buyer_acceptance: boolean; blocks_supplier_settlement: boolean }[];
  paymentUnverified: { id: string; ref: string; order_id: string; amount_minor: string; created_at: string }[];
  settlementPending: { id: string; ref: string; order_id: string; org_id: string; status: string; net_minor: string }[];
  claimOpen: { id: string; ref: string; order_id: string; category: string; status: string; created_at: string }[];
}

export const ORIGIN_TYPES = [
  'OWN_FARM', 'PARTNER_FARM', 'WHOLESALE_STOCK', 'IMPORTER_STOCK', 'MARKET_PURCHASE', 'OTHER_APPROVED_SOURCE'
];
export const TRANSPORT_MODES = [
  'BUS_PARCEL', 'RAIL_PARCEL', 'AIR_CARGO', 'NORMAL_ROAD', 'INSULATED_ROAD', 'REEFER_ROAD', 'LOCAL_PICKUP', 'SPECIAL_EXPRESS'
];
export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER_APPROVED_EXTERNAL'];
export const CLAIM_CATEGORIES = [
  'QUALITY_MISMATCH', 'GRADE_MISMATCH', 'SHORT_QUANTITY', 'DAMAGED',
  'WRONG_PRODUCT', 'LATE_DELIVERY', 'TEMPERATURE_EXCEPTION', 'OTHER'
];
export const CLAIM_NEXT: Record<string, string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['EVIDENCE_VALIDATION'],
  EVIDENCE_VALIDATION: ['COUNTERPARTY_RESPONSE', 'UNDER_REVIEW'],
  COUNTERPARTY_RESPONSE: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['PROPOSED_RESOLUTION', 'REJECTED'],
  PROPOSED_RESOLUTION: ['APPROVED', 'REJECTED'],
  APPROVED: ['FINANCIAL_ADJUSTMENT', 'REPLACEMENT', 'CLOSED'],
  FINANCIAL_ADJUSTMENT: ['CLOSED'],
  REPLACEMENT: ['CLOSED'],
  CLOSED: [],
  REJECTED: []
};
export const MANUAL_ORDER_TRANSITIONS = ['ALLOCATING', 'QC_PACK', 'READY_FOR_DISPATCH', 'CLOSED', 'CANCELLED'];
export const MEDIA_PURPOSES = ['LOT_PHOTO', 'LOT_ACTUAL', 'LOT_VIDEO', 'INSPECTION', 'PACKING', 'POD', 'CLAIM_EVIDENCE', 'OTHER'];

// Orders
export const listMyOrders = () => apiGet<{ items: OrderSummary[] }>('/orders');
export const getOrder = (id: string) => apiGet<OrderDetail>(`/orders/${id}`);
export const convertAward = (awardId: string) =>
  apiPost<{ id: string; ref: string; status: string }>('/orders/convert-award', { awardId }, { idempotencyKey: newIdempotencyKey() });
export const transitionOrder = (id: string, to: string, reason?: string) =>
  apiPost<{ id: string; status: string }>(`/orders/${id}/transition`, { to, reason });
export const acceptDelivery = (id: string, body: { acceptedQty: number; disputedQty?: number; reason?: string }) =>
  apiPost<{ id: string; status: string }>(`/orders/${id}/accept`, body);
export const allocateLot = (body: { supplierAllocationLineId: string; lotId: string; qty: number }) =>
  apiPost<{ reservationId: string; lineCovered: boolean }>('/orders/allocate', body, { idempotencyKey: newIdempotencyKey() });
export const listMyAllocations = () => apiGet<{ items: SupplierAllocationSummary[] }>('/orders/allocations/mine');
export const confirmAllocation = (id: string) => apiPost<{ id: string; status: string }>(`/orders/allocations/${id}/confirm`);
export const markShortfall = (id: string, note?: string) =>
  apiPost<{ id: string; status: string }>(`/orders/allocations/${id}/shortfall`, { note });

// Supply lots
export const createStockLot = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string }>('/supply/lots/stock', body, { idempotencyKey: newIdempotencyKey() });
export const createHarvestLot = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string }>('/supply/lots/harvest', body, { idempotencyKey: newIdempotencyKey() });
export const listMyLots = () => apiGet<{ items: LotSummary[] }>('/supply/lots');
export const getLot = (id: string) => apiGet<LotDetail>(`/supply/lots/${id}`);
export const submitLotForQc = (id: string) => apiPost<{ id: string; status: string }>(`/supply/lots/${id}/submit-qc`);
// ADR-011: supplier-declaration quality basis — evidence-first, no FloraSetu inspection.
export const submitLotDeclaration = (id: string, body: {
  declaredStemLengthCm?: number; bloomStage?: string; batchRef?: string; notes?: string; declaredGradeProfileId?: string;
}) => apiPost<{ id: string; status: string; basis: string }>(`/supply/lots/${id}/declaration`, body);
export const resolveLotHold = (id: string, body: { toAvailableQty: number; toRejectedQty: number; reason?: string }) =>
  apiPost<{ id: string; status: string }>(`/supply/lots/${id}/resolve-hold`, body);
export const addLotMedia = (id: string, body: { mediaObjectId: string; purpose?: string }) =>
  apiPost<{ id: string }>(`/supply/lots/${id}/media`, body);
export const getLotMedia = (id: string) => apiGet<{ items: LotMediaRow[] }>(`/supply/lots/${id}/media`);

// ADR-011 Phase 3: buyer evidence pack (declaration → lot media → packing → logistics → POD → receipt)
export interface EvidenceMedia { id: string; purpose: string; contentType: string; capturedAt: string; url: string }
export interface LotEvidencePack {
  id: string; ref: string; status: string; qualityBasis: string; declaredQty: number | null;
  uomId: string | null; declaredStemLengthCm: number | null; bloomStage: string | null;
  batchRef: string | null; declarationNotes: string | null; declaredAt: string | null;
  harvestAt: string | null; receivedAt: string | null; originType: string | null; media: EvidenceMedia[];
}
export interface ShipmentEvidencePack {
  id: string; ref: string; status: string; mode: string; carrierName: string | null;
  parcelAwbRef: string | null; transportRef: string | null; packageCount: number | null;
  pickupAt: string | null; dispatchedAt: string | null; eta: string | null; actualArrivalAt: string | null;
  logisticsOrgId: string | null; media: EvidenceMedia[];
  pods: { id: string; deliveredQty: number; receiverName: string | null; receivedAt: string }[];
}
export interface PackEvidenceRow {
  id: string; ref: string; packedQty: number; packType: string | null; cartonCount: number | null; packedAt: string;
}
export interface EvidencePack {
  order: { id: string; ref: string; status: string; acceptedQty: number | null; disputedQty: number | null; acceptedAt: string | null };
  lots: LotEvidencePack[]; packs: PackEvidenceRow[]; shipments: ShipmentEvidencePack[];
  receipt: { items: EvidenceMedia[] };
}
export const getEvidencePack = (id: string) => apiGet<EvidencePack>(`/orders/${id}/evidence-pack`);

// Quality & custody
export const qcQueue = () => apiGet<{ items: QcQueueLot[] }>('/quality/queue');
export const createInspection = (body: { lotId: string; scope: string; notes?: string; conflictOverrideReason?: string }) =>
  apiPost<{ id: string; ref: string; lotId: string; status: string; conflictFlag: boolean }>('/quality/inspections', body);
export const completeInspection = (id: string, body: unknown) =>
  apiPost<{ id: string; status: string; lotStatus: string }>(`/quality/inspections/${id}/complete`, body, { idempotencyKey: newIdempotencyKey() });
export const recordCustody = (body: unknown) => apiPost<{ id: string }>('/quality/custody', body);
export const custodyForLot = (lotId: string) => apiGet<{ items: CustodyRow[] }>(`/quality/custody/lot/${lotId}`);

// Logistics
export const createPackRecord = (body: unknown) =>
  apiPost<{ id: string; ref: string }>('/logistics/pack', body, { idempotencyKey: newIdempotencyKey() });
export const listPackRecords = (orderId: string) => apiGet<{ items: PackRow[] }>(`/logistics/pack/${orderId}`);
export const createShipment = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string }>('/logistics/shipments', body, { idempotencyKey: newIdempotencyKey() });
export const listShipmentsForOrder = (orderId: string) => apiGet<{ items: ShipmentRow[] }>(`/logistics/shipments/order/${orderId}`);
export const getShipment = (id: string) => apiGet<ShipmentRow>(`/logistics/shipments/${id}`);
export const dispatchShipment = (id: string) =>
  apiPost<{ id: string; status: string }>(`/logistics/shipments/${id}/dispatch`, undefined, { idempotencyKey: newIdempotencyKey() });
export const recordPod = (id: string, body: unknown) =>
  apiPost<{ id: string; shipmentId: string }>(`/logistics/shipments/${id}/pod`, body, { idempotencyKey: newIdempotencyKey() });
export const reportTempException = (id: string, body: unknown) =>
  apiPost<{ excursionId: string; exceptionId: string | null; blocked: boolean }>(`/logistics/shipments/${id}/temperature-exception`, body);
export const resolveShipmentException = (id: string, resolution: string) =>
  apiPost<{ id: string; status: string }>(`/logistics/exceptions/${id}/resolve`, { resolution });

// Finance (manual external records — never a payment gateway)
export const recordPayment = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string }>('/finance/payments', body, { idempotencyKey: newIdempotencyKey() });
export const verifyPayment = (id: string) => apiPost<{ id: string; status: string }>(`/finance/payments/${id}/verify`);
export const listPaymentsForOrder = (orderId: string) => apiGet<{ items: PaymentRow[] }>(`/finance/payments/order/${orderId}`);
export const recordSettlement = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string; netMinor: number }>('/finance/settlements', body, { idempotencyKey: newIdempotencyKey() });
export const verifySettlement = (id: string) => apiPost<{ id: string; status: string }>(`/finance/settlements/${id}/verify`);
export const completeSettlement = (id: string) => apiPost<{ id: string; status: string }>(`/finance/settlements/${id}/complete`);
export const adjustSettlement = (id: string, body: { direction: string; amountMinor: number; reason: string; claimId?: string }) =>
  apiPost<{ adjustmentId: string }>(`/finance/settlements/${id}/adjustments`, body);
export const listMySettlements = () => apiGet<{ items: SettlementRow[] }>('/finance/settlements/mine');
export const listSettlementsForOrder = (orderId: string) => apiGet<{ items: SettlementRow[] }>(`/finance/settlements/order/${orderId}`);

// Claims
export const createClaim = (body: unknown) =>
  apiPost<{ id: string; ref: string; status: string }>('/claims', body, { idempotencyKey: newIdempotencyKey() });
export const listMyClaims = () => apiGet<{ items: ClaimRow[] }>('/claims');
export const addReceiptEvidence = (orderId: string, body: { mediaObjectId: string; purpose?: string; caption?: string }) =>
  apiPost<{ id: string; attached: boolean }>(`/orders/${orderId}/receipt-evidence`, body);
export const getClaim = (id: string) => apiGet<ClaimDetail>(`/claims/${id}`);
export const submitClaim = (id: string) =>
  apiPost<{ id: string; status: string }>(`/claims/${id}/submit`, undefined, { idempotencyKey: newIdempotencyKey() });
export const respondClaim = (id: string, response: string) => apiPost<{ id: string; status: string }>(`/claims/${id}/respond`, { response });
export const addClaimEvidence = (id: string, body: { mediaObjectId: string; note?: string }) =>
  apiPost<{ id: string }>(`/claims/${id}/evidence`, body);
export const transitionClaim = (id: string, body: { to: string; resolutionNote?: string; adjustmentMinor?: number }) =>
  apiPost<{ id: string; status: string }>(`/claims/${id}/transition`, body);

// Control tower
export const towerExceptions = () => apiGet<TowerExceptions>('/tower/exceptions');

// Media (dev local store — OD-03 production blocker noted for pilot)
export const mediaUrl = (path: string): string => `${import.meta.env.VITE_API_URL as string}${path}`;
export const uploadMedia = async (file: File): Promise<{ id: string; objectKey: string }> => {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
  return apiPost('/media', { contentType: file.type || 'application/octet-stream', dataBase64, bucket: 'pilot' });
};

export const fmtDate = (s?: string | null): string => (s ? new Date(s).toLocaleString('en-IN') : '—');
