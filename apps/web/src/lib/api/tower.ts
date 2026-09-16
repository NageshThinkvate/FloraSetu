import { apiGet } from './client';

// ADR-013 (Phase 6): composed Operations Control Tower client.
// The backend computes visibility + allowedActions from the caller's permissions —
// this client renders, it never decides authority.

export interface BoardAction {
  key: string;
  label: string;
}

export interface BoardItem {
  id: string;
  discipline: 'PROCUREMENT' | 'ORDERS' | 'LOGISTICS' | 'CLAIMS' | 'FINANCE';
  category: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT' | 'CRITICAL';
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

export interface OpsOrder {
  id: string;
  ref: string;
  status: string;
  buyerOrgId: string;
  deliveryDestination: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedQty: number | null;
  disputedQty: number | null;
  supplierOrgIds: string[];
  buyerName: string | null;
  supplierNames: string[];
  hasOpenClaim: boolean;
  slaBreach: string | null;
  nextOwner: string;
}

export interface OpsShipment {
  id: string;
  ref: string;
  orderId: string;
  orderRef: string | null;
  status: string;
  mode: string | null;
  logisticsOrgId: string | null;
  partnerName: string | null;
  originText: string | null;
  destinationText: string | null;
  carrierName: string | null;
  transportRef: string | null;
  parcelAwbRef: string | null;
  packageCount: number | null;
  tempControlled: boolean | null;
  pickupAt: string | null;
  etd: string | null;
  eta: string | null;
  jobAcceptedAt: string | null;
  arrivedPickupAt: string | null;
  arrivedDeliveryAt: string | null;
  dispatchedAt: string | null;
  actualArrivalAt: string | null;
  createdAt: string;
  driverAssigned: boolean;
  openExceptions: number;
  openExceptionTypes: string[];
  hasPod: boolean;
  pickupOverdue: boolean;
  etaBreached: boolean;
  podMissing: boolean;
  awaitingPartnerResource: boolean;
}

export interface SearchHit {
  type: 'order' | 'requirement' | 'claim' | 'shipment' | 'organization';
  id: string;
  ref: string;
  label: string;
  href: string;
}

export const towerBoard = (): Promise<{ items: BoardItem[] }> => apiGet('/tower/board');
export const towerOrders = (): Promise<{ items: OpsOrder[] }> => apiGet('/tower/orders');
export const towerLogistics = (): Promise<{ items: OpsShipment[] }> => apiGet('/tower/logistics');
export const towerSearch = (q: string): Promise<{ items: SearchHit[] }> =>
  apiGet(`/tower/search?q=${encodeURIComponent(q)}`);

// Audited CSV export (tower.board_export audit event server-side).
export const towerBoardExport = async (): Promise<void> => {
  const session = JSON.parse(localStorage.getItem('florasetu.session') ?? '{}') as { accessToken?: string };
  const org = localStorage.getItem('florasetu.activeOrg') ?? '';
  const base = (import.meta.env.VITE_API_URL as string) ?? '';
  const res = await fetch(`${base}/api/tower/board/export`, {
    headers: { Authorization: `Bearer ${session.accessToken ?? ''}`, 'X-Org-Id': org }
  });
  if (!res.ok) {
    throw new Error('Export failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ops-exceptions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
