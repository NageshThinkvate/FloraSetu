import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { RequestContext } from '../../../common/request-context';
import { DemandRfq_SERVICE, DemandRfqService } from '../../demand-rfq/contracts';
import { OrderAllocation_SERVICE, OrderAllocationService, OpsOrderRow } from '../../order-allocation/contracts';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { QualityTraceability_SERVICE, QualityTraceabilityService } from '../../quality-traceability/contracts';
import { LogisticsColdchain_SERVICE, LogisticsColdchainService, OpsShipmentRow } from '../../logistics-coldchain/contracts';
import { PaymentsSettlement_SERVICE, PaymentsSettlementService } from '../../payments-settlement/contracts';
import { ClaimsSupport_SERVICE, ClaimsSupportService } from '../../claims-support/contracts';
import { IdentityParty_SERVICE, IdentityPartyService } from '../../identity-party/contracts';

export type BoardDiscipline = 'PROCUREMENT' | 'ORDERS' | 'LOGISTICS' | 'CLAIMS' | 'FINANCE';
export type BoardSeverity = 'INFO' | 'ATTENTION' | 'URGENT' | 'CRITICAL';

export interface BoardAction { key: string; label: string }

// ADR-013: normalized, discipline-scoped exception/action item. Source bounded contexts
// remain authoritative — this is a composed representation, never a copied record.
export interface BoardItem {
  id: string;
  discipline: BoardDiscipline;
  category: string;
  severity: BoardSeverity;
  title: string;
  ref: string;
  objectType: string;
  objectId: string;
  orderId: string | null;
  orgName: string | null;
  detectedAt: string;
  dueAt: string | null;
  state: string;
  nextOwner: string;
  href: string;
  allowedActions: BoardAction[];
}

export interface SearchHit {
  type: 'order' | 'requirement' | 'claim' | 'shipment' | 'organization';
  id: string; ref: string; label: string; href: string;
}

const SEV_RANK: Record<BoardSeverity, number> = { CRITICAL: 0, URGENT: 1, ATTENTION: 2, INFO: 3 };
const ROAD_MODES = new Set(['NORMAL_ROAD', 'INSULATED_ROAD', 'REEFER_ROAD', 'LOCAL_PICKUP', 'SPECIAL_EXPRESS']);
const hoursAgo = (iso: string): number => (Date.now() - new Date(iso).getTime()) / 3600e3;
// pg returns TIMESTAMPTZ as Date objects — normalize everything to ISO strings at the boundary.
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

// Human next-action owners (§24): "Logistics partner" never implies Ops may do the partner's work.
const CLAIM_OWNER: Record<string, string> = {
  DRAFT: 'Buyer', SUBMITTED: 'FloraSetu support', EVIDENCE_VALIDATION: 'FloraSetu support',
  COUNTERPARTY_RESPONSE: 'Supplier', UNDER_REVIEW: 'FloraSetu support',
  PROPOSED_RESOLUTION: 'Buyer', OPENED: 'FloraSetu support', DECIDED: 'FloraSetu finance'
};

// §24 Operations Pilot Control Tower: exception queues aggregated across contexts
// strictly through public contracts (docs/04 boundary). No analytics beyond queues.
// ADR-013 (Phase 6): composed exception-first board, monitors, scoped search, audited export.
@Injectable()
export class TowerService {
  constructor(
    @Inject(DemandRfq_SERVICE) private readonly demand: DemandRfqService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(QualityTraceability_SERVICE) private readonly quality: QualityTraceabilityService,
    @Inject(LogisticsColdchain_SERVICE) private readonly logistics: LogisticsColdchainService,
    @Inject(PaymentsSettlement_SERVICE) private readonly payments: PaymentsSettlementService,
    @Inject(ClaimsSupport_SERVICE) private readonly claims: ClaimsSupportService,
    @Inject(IdentityParty_SERVICE) private readonly identity: IdentityPartyService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async exceptions(): Promise<Record<string, unknown[]>> {
    const [finalAwards, converted, order, supply, quality, logistics, payments, claims] = await Promise.all([
      this.demand.listFinalAwards(),
      this.orders.convertedAwardIds(),
      this.orders.pilotExceptions(),
      this.supply.pilotExceptions(),
      this.quality.pilotExceptions(),
      this.logistics.pilotExceptions(),
      this.payments.pilotExceptions(),
      this.claims.pilotExceptions()
    ]);
    return {
      awardNotConverted: finalAwards.filter((a) => !converted.includes(a.id)),
      ...order,
      ...supply,
      ...quality,
      ...logistics,
      ...payments,
      ...claims
    };
  }

  // ---------- Phase 6 (ADR-013): exception board ----------

  private severity(detectedAt: string, dueAt: string | null, critical = false): BoardSeverity {
    if (critical) {
      return 'CRITICAL';
    }
    if (dueAt && new Date(dueAt).getTime() < Date.now()) {
      return 'URGENT';
    }
    const age = hoursAgo(detectedAt);
    if (age > 48) {
      return 'URGENT';
    }
    if (age > 24) {
      return 'ATTENTION';
    }
    return 'INFO';
  }

  async board(): Promise<{ items: BoardItem[] }> {
    const ctx = RequestContext.get();
    const perms = ctx.permissions;
    const canProcurement = perms.includes('procurement.manage');
    const canOrderRead = perms.includes('order.read');
    const canPay = perms.includes('payment.verify');
    const canSettle = perms.includes('settlement.verify');
    const canClaims = perms.includes('claim.manage') || perms.includes('claim.read') || perms.includes('support.access');
    const canLogistics = canProcurement || perms.includes('support.access');

    const [finalAwards, converted, orderX, supplyX, logisticsX, paymentsX, claimsX, ordersMon, logisticsMon, sourcing] =
      await Promise.all([
        this.demand.listFinalAwards(),
        this.orders.convertedAwardIds(),
        this.orders.pilotExceptions(),
        this.supply.pilotExceptions(),
        this.logistics.pilotExceptions(),
        this.payments.pilotExceptions(),
        this.claims.pilotExceptions(),
        this.orders.opsMonitor(),
        this.logistics.opsMonitor(),
        this.demand.sourcingRisks()
      ]);

    const orderMap = new Map(ordersMon.map((o) => [o.id, o]));
    const shipMap = new Map(logisticsMon.map((s) => [s.id, s]));
    type RawItem = Omit<BoardItem, 'orgName'> & { orgId: string | null };
    const raw: RawItem[] = [];
    const push = (
      lane: BoardDiscipline, visible: boolean,
      item: Omit<BoardItem, 'discipline' | 'orgName'>, orgId: string | null = null
    ): void => {
      if (visible) {
        raw.push({ ...item, discipline: lane, orgId });
      }
    };

    // PROCUREMENT — sourcing gaps, deadlines, awards awaiting conversion.
    for (const a of finalAwards.filter((a) => !converted.includes(a.id))) {
      push('PROCUREMENT', canProcurement, {
        id: `award:${a.id}`, category: 'AWARD_NOT_CONVERTED', severity: this.severity(a.createdAt, null),
        title: 'Award waiting to become an order', ref: a.ref, objectType: 'award', objectId: a.id,
        orderId: null, detectedAt: a.createdAt, dueAt: null, state: 'FINAL',
        nextOwner: 'FloraSetu procurement', href: '/ops/procurement',
        allowedActions: [{ key: 'convert-award', label: 'Convert to order' }]
      }, a.buyerOrgId);
    }
    for (const r of sourcing) {
      const titles: Record<string, string> = {
        NEEDS_SOURCING: 'No sourcing started',
        RFQ_DEADLINE_RISK: 'Quote deadline approaching',
        UNCOVERED: 'Supply gap — demand not fully covered'
      };
      push('PROCUREMENT', canProcurement, {
        id: `sourcing:${r.kind}:${r.id}`, category: r.kind, severity: this.severity(r.detectedAt, r.deadline),
        title: titles[r.kind] ?? 'Sourcing risk', ref: r.ref, objectType: 'requirement', objectId: r.id,
        orderId: null, detectedAt: r.detectedAt, dueAt: r.deadline, state: r.status,
        nextOwner: 'FloraSetu procurement', href: '/ops/procurement',
        allowedActions: [{ key: 'open-procurement', label: 'Open procurement desk' }]
      }, r.orgId);
    }

    // ORDERS — fulfilment attention (supply-side risks included; no QC workflow — ADR-011).
    for (const o of orderX.supplierNotConfirmed as { id: string; ref: string; created_at: string }[]) {
      push('ORDERS', canOrderRead, {
        id: `order-unconfirmed:${o.id}`, category: 'SUPPLIER_CONFIRMATION_OVERDUE',
        severity: this.severity(o.created_at, null),
        title: 'Supplier confirmation overdue', ref: o.ref, objectType: 'order', objectId: o.id,
        orderId: o.id, detectedAt: o.created_at, dueAt: null, state: 'PENDING_CONFIRMATION',
        nextOwner: 'Supplier', href: `/ops/orders?focus=${o.id}`, allowedActions: []
      }, orderMap.get(o.id)?.buyerOrgId ?? null);
    }
    for (const o of orderX.orderShortAfterQc as { id: string; order_id: string; order_ref: string }[]) {
      push('ORDERS', canOrderRead, {
        id: `order-short:${o.id}`, category: 'SUPPLY_SHORT', severity: 'ATTENTION',
        title: 'Supply short against commitment', ref: o.order_ref, objectType: 'order', objectId: o.order_id,
        orderId: o.order_id, detectedAt: orderMap.get(o.order_id)?.updatedAt ?? new Date().toISOString(),
        dueAt: null, state: 'ALLOCATING',
        nextOwner: 'Supplier', href: `/ops/orders?focus=${o.order_id}`, allowedActions: []
      }, orderMap.get(o.order_id)?.buyerOrgId ?? null);
    }
    for (const o of orderX.buyerAcceptancePending as { id: string; ref: string; updated_at: string }[]) {
      push('ORDERS', canOrderRead, {
        id: `acceptance:${o.id}`, category: 'BUYER_ACCEPTANCE_PENDING', severity: this.severity(o.updated_at, null),
        title: 'Waiting for buyer acceptance', ref: o.ref, objectType: 'order', objectId: o.id,
        orderId: o.id, detectedAt: o.updated_at, dueAt: null, state: 'ACCEPTANCE_PENDING',
        nextOwner: 'Buyer', href: `/ops/orders?focus=${o.id}`, allowedActions: []
      }, orderMap.get(o.id)?.buyerOrgId ?? null);
    }
    for (const l of supplyX.qcHoldOrReject as { id: string; org_id: string }[]) {
      push('ORDERS', canOrderRead, {
        id: `lot-hold:${l.id}`, category: 'LOT_ON_HOLD', severity: 'ATTENTION',
        title: 'Supply lot on hold — supplier action needed', ref: 'Supply lot', objectType: 'lot', objectId: l.id,
        orderId: null, detectedAt: new Date().toISOString(), dueAt: null, state: 'HOLD',
        nextOwner: 'Supplier', href: '/ops/orders', allowedActions: []
      }, l.org_id);
    }
    for (const l of supplyX.packedAwaitingDispatch as { id: string; org_id: string }[]) {
      push('ORDERS', canOrderRead, {
        id: `packed:${l.id}`, category: 'PACKED_AWAITING_DISPATCH', severity: 'ATTENTION',
        title: 'Packed, waiting for dispatch', ref: 'Packed stock', objectType: 'lot', objectId: l.id,
        orderId: null, detectedAt: new Date().toISOString(), dueAt: null, state: 'PACKED',
        nextOwner: 'Supplier', href: '/ops/orders', allowedActions: []
      }, l.org_id);
    }

    // LOGISTICS — monitor/support only (ADR-012: never execution actions here).
    for (const s of logisticsX.dispatchOverdue as { id: string; ref: string; order_id: string; created_at: string }[]) {
      push('LOGISTICS', canLogistics, {
        id: `dispatch-overdue:${s.id}`, category: 'PICKUP_NOT_STARTED', severity: this.severity(s.created_at, null),
        title: 'Pickup not started — dispatch window passed', ref: s.ref, objectType: 'shipment', objectId: s.id,
        orderId: s.order_id, detectedAt: s.created_at, dueAt: null, state: 'PLANNED',
        nextOwner: 'Logistics partner', href: `/ops/logistics?focus=${s.id}`, allowedActions: []
      }, shipMap.get(s.id)?.logisticsOrgId ?? null);
    }
    for (const s of logisticsX.etaOverdue as { id: string; ref: string; order_id: string; eta: string }[]) {
      push('LOGISTICS', canLogistics, {
        id: `eta-overdue:${s.id}`, category: 'DELIVERY_LATE', severity: 'URGENT',
        title: 'Running late — ETA has passed', ref: s.ref, objectType: 'shipment', objectId: s.id,
        orderId: s.order_id, detectedAt: s.eta, dueAt: s.eta, state: 'IN_TRANSIT',
        nextOwner: 'Logistics partner', href: `/ops/logistics?focus=${s.id}`, allowedActions: []
      }, shipMap.get(s.id)?.logisticsOrgId ?? null);
    }
    for (const s of logisticsX.podMissing as { id: string; ref: string; order_id: string; dispatched_at: string }[]) {
      push('LOGISTICS', canLogistics, {
        id: `pod-missing:${s.id}`, category: 'POD_MISSING', severity: this.severity(s.dispatched_at, null),
        title: 'POD missing after delivery window', ref: s.ref, objectType: 'shipment', objectId: s.id,
        orderId: s.order_id, detectedAt: s.dispatched_at, dueAt: null, state: 'IN_TRANSIT',
        nextOwner: 'Logistics partner', href: `/ops/logistics?focus=${s.id}`, allowedActions: []
      }, shipMap.get(s.id)?.logisticsOrgId ?? null);
    }
    for (const e of logisticsX.openShipmentExceptions as {
      id: string; shipment_id: string; blocks_buyer_acceptance: boolean; blocks_supplier_settlement: boolean;
    }[]) {
      const ship = shipMap.get(e.shipment_id);
      push('LOGISTICS', canLogistics, {
        id: `shipment-exception:${e.id}`, category: 'LOGISTICS_EXCEPTION',
        severity: e.blocks_buyer_acceptance || e.blocks_supplier_settlement ? 'CRITICAL' : 'ATTENTION',
        title: 'Partner-reported issue', ref: ship?.ref ?? 'Shipment', objectType: 'shipment_exception', objectId: e.id,
        orderId: ship?.orderId ?? null, detectedAt: ship?.createdAt ?? new Date().toISOString(), dueAt: null,
        state: 'OPEN', nextOwner: 'Logistics partner', href: `/ops/logistics?focus=${e.shipment_id}`,
        allowedActions: canProcurement ? [{ key: 'resolve-exception', label: 'Resolve issue' }] : []
      }, ship?.logisticsOrgId ?? null);
    }

    // FINANCE — only for finance-permission holders; actions mirror existing dual control.
    for (const p of paymentsX.paymentUnverified as { id: string; ref: string; order_id: string; created_at: string }[]) {
      push('FINANCE', canPay, {
        id: `payment:${p.id}`, category: 'PAYMENT_UNVERIFIED', severity: this.severity(p.created_at, null),
        title: 'Payment awaiting verification', ref: p.ref, objectType: 'payment', objectId: p.id,
        orderId: p.order_id, detectedAt: p.created_at, dueAt: null, state: 'RECORDED',
        nextOwner: 'FloraSetu finance', href: '/ops/finance',
        allowedActions: [{ key: 'verify-payment', label: 'Verify payment' }]
      }, orderMap.get(p.order_id)?.buyerOrgId ?? null);
    }
    for (const s of paymentsX.settlementPending as { id: string; ref: string; order_id: string; org_id: string; status: string }[]) {
      push('FINANCE', canSettle, {
        id: `settlement:${s.id}`, category: 'SETTLEMENT_PENDING', severity: 'ATTENTION',
        title: s.status === 'RECORDED' ? 'Settlement awaiting verification' : 'Settlement awaiting completion',
        ref: s.ref, objectType: 'settlement', objectId: s.id,
        orderId: s.order_id, detectedAt: new Date().toISOString(), dueAt: null, state: s.status,
        nextOwner: 'FloraSetu finance', href: '/ops/finance',
        allowedActions: [s.status === 'RECORDED'
          ? { key: 'verify-settlement', label: 'Verify settlement' }
          : { key: 'complete-settlement', label: 'Complete settlement' }]
      }, s.org_id);
    }

    // CLAIMS — evidence-first case visibility for support/reviewers.
    for (const c of claimsX.claimOpen as { id: string; ref: string; order_id: string; category: string; status: string; created_at: string }[]) {
      push('CLAIMS', canClaims, {
        id: `claim:${c.id}`, category: 'CLAIM_OPEN', severity: this.severity(c.created_at, null),
        title: `Open claim — ${c.category.toLowerCase().replace(/_/g, ' ')}`, ref: c.ref,
        objectType: 'claim', objectId: c.id,
        orderId: c.order_id, detectedAt: c.created_at, dueAt: null, state: c.status,
        nextOwner: CLAIM_OWNER[c.status] ?? 'FloraSetu support', href: `/ops/claims/${c.id}`, allowedActions: []
      }, orderMap.get(c.order_id)?.buyerOrgId ?? null);
    }

    const orgIds = [...new Set(raw.map((i) => i.orgId).filter((v): v is string => Boolean(v)))];
    const profiles = await this.identity.getOrgPublicProfiles(orgIds);
    const nameOf = new Map(profiles.map((p) => [p.orgId, p.name]));
    const items: BoardItem[] = raw.map(({ orgId, ...i }) => ({
      ...i,
      detectedAt: iso(i.detectedAt),
      dueAt: i.dueAt ? iso(i.dueAt) : null,
      orgName: orgId ? nameOf.get(orgId) ?? null : null
    }));
    items.sort((a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity]
      || new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());
    return { items };
  }

  // ---------- Phase 6 (ADR-013): orders monitor ----------

  private orderSla(r: OpsOrderRow): string | null {
    const age = hoursAgo(r.updatedAt);
    switch (r.status) {
      case 'PENDING_CONFIRMATION':
        return hoursAgo(r.createdAt) > 24 ? 'CONFIRMATION_OVERDUE' : null;
      case 'READY_FOR_DISPATCH':
        return age > 24 ? 'DISPATCH_OVERDUE' : null;
      case 'DISPATCHED':
      case 'IN_TRANSIT':
        return age > 72 ? 'DELIVERY_OVERDUE' : null;
      case 'DELIVERED':
      case 'ACCEPTANCE_PENDING':
        return age > 48 ? 'ACCEPTANCE_OVERDUE' : null;
      default:
        return null;
    }
  }

  private orderOwner(status: string, hasOpenClaim: boolean): string {
    if (hasOpenClaim) {
      return 'FloraSetu support';
    }
    switch (status) {
      case 'PENDING_CONFIRMATION':
      case 'SUPPLY_CONFIRMED':
      case 'ALLOCATING':
      case 'QC_PACK':
      case 'READY_FOR_DISPATCH':
        return 'Supplier';
      case 'DISPATCHED':
      case 'IN_TRANSIT':
        return 'Logistics partner';
      case 'DELIVERED':
      case 'ACCEPTANCE_PENDING':
        return 'Buyer';
      default:
        return 'System / waiting';
    }
  }

  async ordersMonitor(): Promise<{ items: Record<string, unknown>[] }> {
    const [rows, claimsX] = await Promise.all([this.orders.opsMonitor(), this.claims.pilotExceptions()]);
    const claimOrders = new Set((claimsX.claimOpen as { order_id: string }[]).map((c) => c.order_id));
    const orgIds = new Set<string>();
    for (const r of rows) {
      orgIds.add(r.buyerOrgId);
      r.supplierOrgIds.forEach((s) => orgIds.add(s));
    }
    const profiles = await this.identity.getOrgPublicProfiles([...orgIds]);
    const nameOf = new Map(profiles.map((p) => [p.orgId, p.name]));
    return {
      items: rows.map((r) => ({
        ...r,
        buyerName: nameOf.get(r.buyerOrgId) ?? null,
        supplierNames: r.supplierOrgIds.map((s) => nameOf.get(s) ?? 'Supplier'),
        hasOpenClaim: claimOrders.has(r.id),
        slaBreach: this.orderSla(r),
        nextOwner: this.orderOwner(r.status, claimOrders.has(r.id))
      }))
    };
  }

  // ---------- Phase 6 (ADR-013): logistics monitor (read-only; ADR-012 intact) ----------

  async logisticsMonitor(): Promise<{ items: Record<string, unknown>[] }> {
    const [ships, ordersMon] = await Promise.all([this.logistics.opsMonitor(), this.orders.opsMonitor()]);
    const orderRef = new Map(ordersMon.map((o) => [o.id, o.ref]));
    const partnerIds = [...new Set(ships.map((s) => s.logisticsOrgId).filter((v): v is string => Boolean(v)))];
    const profiles = await this.identity.getOrgPublicProfiles(partnerIds);
    const nameOf = new Map(profiles.map((p) => [p.orgId, p.name]));
    return {
      items: ships.map((s) => ({
        ...s,
        partnerName: s.logisticsOrgId ? nameOf.get(s.logisticsOrgId) ?? null : null,
        orderRef: orderRef.get(s.orderId) ?? null,
        pickupOverdue: s.status === 'PLANNED' && hoursAgo(s.createdAt) > 12,
        etaBreached: s.status === 'IN_TRANSIT' && !!s.eta && new Date(s.eta).getTime() < Date.now(),
        podMissing: s.status === 'IN_TRANSIT' && !s.hasPod && !!s.dispatchedAt && hoursAgo(s.dispatchedAt) > 24,
        // ADR-012: driver expectation applies to road modes only — bus/rail/air are driverless.
        awaitingPartnerResource: !!s.mode && ROAD_MODES.has(s.mode) && !s.driverAssigned && s.status === 'PLANNED'
      }))
    };
  }

  // ---------- Phase 6 (ADR-013): scoped staff search ----------

  async search(q: string): Promise<{ items: SearchHit[] }> {
    const query = q.trim();
    if (query.length < 2) {
      return { items: [] };
    }
    const perms = RequestContext.get().permissions;
    const canProcurement = perms.includes('procurement.manage');
    const [orders, reqs, claims, ships, orgs] = await Promise.all([
      perms.includes('order.read') ? this.orders.searchOrders(query) : Promise.resolve([]),
      canProcurement ? this.demand.searchRequirements(query) : Promise.resolve([]),
      perms.includes('claim.manage') || perms.includes('claim.read') || perms.includes('support.access')
        ? this.claims.searchClaims(query) : Promise.resolve([]),
      canProcurement || perms.includes('support.access') ? this.logistics.searchShipments(query) : Promise.resolve([]),
      perms.includes('admin.org.read') ? this.identity.searchOrgsByName(query) : Promise.resolve([])
    ]);
    const items: SearchHit[] = [
      ...orders.map((o) => ({
        type: 'order' as const, id: o.id, ref: o.ref,
        label: `Order ${o.ref}${o.deliveryDestination ? ` · ${o.deliveryDestination}` : ''}`,
        href: `/ops/orders?focus=${o.id}`
      })),
      ...reqs.map((r) => ({
        type: 'requirement' as const, id: r.id, ref: r.ref,
        label: `Requirement ${r.ref} · ${r.title}`, href: `/ops/procurement?focus=${r.id}`
      })),
      ...claims.map((c) => ({
        type: 'claim' as const, id: c.id, ref: c.ref,
        label: `Claim ${c.ref} · ${c.category.toLowerCase().replace(/_/g, ' ')}`, href: `/ops/claims/${c.id}`
      })),
      ...ships.map((s) => ({
        type: 'shipment' as const, id: s.id, ref: s.ref,
        label: `Shipment ${s.ref} · ${s.originText ?? ''} → ${s.destinationText ?? ''}`,
        href: `/ops/logistics?focus=${s.id}`
      })),
      ...orgs.map((o) => ({
        type: 'organization' as const, id: o.orgId, ref: o.ref,
        label: `${o.name} · ${o.type}`, href: '/admin/organizations'
      }))
    ];
    return { items };
  }

  // ---------- Phase 6 (ADR-013): audited CSV export of the caller-visible board ----------

  async boardCsv(): Promise<string> {
    const { items } = await this.board();
    const esc = (v: unknown): string => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = items.map((i) => [
      i.discipline, i.category, i.severity, i.title, i.ref, i.state, i.nextOwner, i.orgName ?? '', i.detectedAt, i.dueAt ?? ''
    ].map(esc).join(','));
    const csv = ['discipline,category,severity,title,ref,state,next_owner,organization,detected_at,due_at', ...rows].join('\n');
    await this.db.withTransaction(async (client) => {
      await this.audit.record(client, {
        action: 'tower.board_export', objectType: 'tower_board',
        objectId: '00000000-0000-0000-0000-000000000000', objectRef: 'tower_board',
        after: { rows: items.length }
      });
    });
    return csv;
  }
}
