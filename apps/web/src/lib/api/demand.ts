// Typed wrappers for the Build 3 demand/RFQ API surface.
import { apiGet, apiPost } from './client';

export interface UnitOfMeasure { id: string; code: string; name: string; status: string }
export interface ProductSummary {
  id: string; ref: string; name: string; commercial_name: string | null;
  validation_status: string; category_code?: string; matched_alias?: string | null;
}

export interface RequirementSummary {
  id: string; ref: string; title: string; mode: string; status: string;
  current_version_no: number; assistance_requested: boolean; created_at: string;
  event_ref: string | null; event_name: string | null; line_count: number;
}
export interface RequirementLine {
  id: string; bom_line_id: string | null; commodity_id: string; variety_id: string | null;
  grade_profile_id: string | null; pack_definition_id: string | null; quantity: string;
  uom_id: string; needed_at: string; delivery_destination: string;
  substitution_policy: Record<string, unknown>; notes: string | null;
  master_snapshot: { commodity?: { name?: string; ref?: string }; uom?: { code?: string }; variety?: { name?: string } };
}
export interface RequirementVersion {
  id: string; version_no: number; change_reason: string | null; consent_required: boolean;
  consented_at: string | null; created_at: string;
}
export interface RequirementDetail extends RequirementSummary {
  org_id: string; event_id: string | null;
  lines: RequirementLine[]; versions: RequirementVersion[];
  awardedByLine: Record<string, string>;
}

export interface EventSummary {
  id: string; ref: string; name: string; event_type: string; status: string;
  starts_at: string | null; ends_at: string | null; ceremonies: number; bom_lines: number;
}
export interface Ceremony { id: string; name: string; starts_at: string | null; venue_name: string | null; sort_order: number }
export interface BomLine {
  id: string; ceremony_id: string | null; commodity_id: string; variety_id: string | null;
  quantity: string; uom_id: string; needed_at: string | null; delivery_milestone: string | null;
  sourcing_status: string; linked: boolean;
}
export interface EventDetail extends Omit<EventSummary, 'ceremonies' | 'bom_lines'> {
  venue_name: string | null; venue_address: string | null; notes: string | null;
  ceremonies: Ceremony[]; bomLines: BomLine[];
}

export interface RfqSummary {
  id: string; ref: string; title: string; status: string; mode: string;
  quote_deadline: string | null; published_at: string | null;
  requirement_ref?: string; requirement_status?: string; invited?: number; quotes?: number;
}
export interface InboxItem {
  id: string; ref: string; title: string; status: string; quote_deadline: string | null;
  published_at: string | null; invitation_id: string; invitation_status: string; buyer_org_id: string;
}
export interface RfqLine {
  id: string; requirement_line_id: string; qty: string; master_snapshot: RequirementLine['master_snapshot'];
  quantity?: string; uom_id?: string; needed_at?: string; delivery_destination?: string;
  req_qty?: string; substitution_policy?: Record<string, unknown>;
}
export interface RfqDetail {
  id: string; ref: string; title: string; status: string; mode: string;
  quote_deadline: string | null; clarification_deadline: string | null;
  commercial_instructions: string | null; delivery_requirements: string | null;
  published_at: string | null; requirement_ref: string; requirement_id?: string;
  invitationStatus?: string; lines: RfqLine[];
  invitations?: { supplier_org_id: string; status: string; decline_reason: string | null }[];
  quotations?: { id: string; ref: string; supplier_org_id: string; version_status: string; submitted_at: string }[];
}
export interface QuoteSummary {
  id: string; ref: string; status: string; current_version_no: number; created_at: string;
  rfq_ref: string; rfq_title: string; rfq_status: string; valid_to: string; version_status: string;
}
export interface QuoteLine {
  id: string; requirement_line_id: string; quoted_qty: string; quoted_uom_id: string;
  unit_price_minor: string; currency: string; components: Record<string, { state: string; amount_minor?: number }>;
  normalized_qty: string | null; normalization_status: string;
  deviation_note: string | null; proposes_substitution: boolean;
}
export interface Comparison {
  requirementLines: { id: string; quantity: string; uom_id: string; master_snapshot: RequirementLine['master_snapshot'] }[];
  offers: {
    quotation_id: string; ref: string; supplier_org_id: string; version_id: string; version_no: number;
    version_status: string; valid_to: string; lead_time_days: number | null; submitted_at: string;
    lines: QuoteLine[]; landedCostComplete: boolean; landedCostLabel: string;
  }[];
}
export interface Award {
  id: string; ref: string; status: string; conditions: string | null; created_at: string;
  lines: { requirement_line_id: string; supplier_org_id: string; awarded_qty: string; unit_price_minor: string; currency: string }[] | null;
}
export interface Clarification {
  id: string; question: string; response: string | null; visibility: string;
  status: string; author_org_id: string; created_at: string;
}
export interface OpsDesk {
  needsSourcing: { id: string; ref: string; title: string; mode: string; created_at: string }[];
  openRfqs: { id: string; ref: string; title: string; quote_deadline: string | null; invited: number; quotes: number; deadlineRisk: boolean }[];
  uncoveredDemand: { id: string; ref: string; title: string; status: string; remaining_qty: string }[];
  openClarifications: { id: string; rfq_id: string; question: string; rfq_ref: string; created_at: string }[];
  assistanceRequested: { id: string; ref: string; title: string; status: string }[];
}

// Catalog helpers
export const listUnits = () => apiGet<{ items: UnitOfMeasure[] }>('/catalog/units');
export const searchProducts = (q: string) =>
  apiGet<{ items: ProductSummary[] }>(`/catalog/search?q=${encodeURIComponent(q)}`);
export const listProducts = () => apiGet<{ items: ProductSummary[] }>('/catalog/products');

// Events
export const createEvent = (body: unknown) => apiPost<EventSummary>('/demand/events', body);
export const listEvents = () => apiGet<{ items: EventSummary[] }>('/demand/events');
export const getEvent = (id: string) => apiGet<EventDetail>(`/demand/events/${id}`);
export const addCeremony = (id: string, body: unknown) => apiPost<{ id: string }>(`/demand/events/${id}/ceremonies`, body);
export const addBomLine = (id: string, body: unknown) => apiPost<{ id: string }>(`/demand/events/${id}/bom-lines`, body);

// Requirements
export const createRequirement = (body: unknown) => apiPost<{ id: string; ref: string }>('/demand/requirements', body);
export const listRequirements = () => apiGet<{ items: RequirementSummary[] }>('/demand/requirements');
export const getRequirement = (id: string) => apiGet<RequirementDetail>(`/demand/requirements/${id}`);
export const submitRequirement = (id: string, key: string) =>
  apiPost<{ status: string }>(`/demand/requirements/${id}/submit`, undefined, { idempotencyKey: key });
export const reviseRequirement = (id: string, body: unknown) =>
  apiPost<{ versionNo: number; consentRequired: boolean }>(`/demand/requirements/${id}/revise`, body);
export const evaluateRequirement = (id: string) => apiPost(`/demand/requirements/${id}/evaluate`);
export const consentRequirement = (id: string, versionNo: number) =>
  apiPost(`/demand/requirements/${id}/consent`, { versionNo });
export const cancelRequirement = (id: string, reason: string) =>
  apiPost(`/demand/requirements/${id}/cancel`, { reason });

// RFQs
export const publishRfq = (requirementId: string, body: unknown, key: string) =>
  apiPost<{ id: string; ref: string }>(`/demand/requirements/${requirementId}/publish-rfq`, body, { idempotencyKey: key });
export const listMyRfqs = () => apiGet<{ items: RfqSummary[] }>('/demand/rfqs');
export const rfqInbox = () => apiGet<{ items: InboxItem[] }>('/demand/rfqs/inbox');
export const getRfq = (id: string) => apiGet<RfqDetail>(`/demand/rfqs/${id}`);
export const cancelRfq = (id: string, reason: string) => apiPost(`/demand/rfqs/${id}/cancel`, { reason });
export const markRfqViewed = (id: string) => apiPost(`/demand/rfqs/${id}/viewed`);
export const intendToQuote = (id: string) => apiPost(`/demand/rfqs/${id}/intend`);
export const declineRfq = (id: string, reason: string) => apiPost(`/demand/rfqs/${id}/decline`, { reason });

// Clarifications
export const postClarification = (rfqId: string, question: string) =>
  apiPost(`/demand/rfqs/${rfqId}/clarifications`, { question });
export const listClarifications = (rfqId: string) =>
  apiGet<{ items: Clarification[] }>(`/demand/rfqs/${rfqId}/clarifications`);
export const respondClarification = (id: string, response: string, visibility: string) =>
  apiPost(`/demand/clarifications/${id}/respond`, { response, visibility });

// Quotes
export const submitQuote = (rfqId: string, body: unknown, key: string) =>
  apiPost<{ id: string; ref: string; versionId: string }>(`/demand/rfqs/${rfqId}/quotes`, body, { idempotencyKey: key });
export const listMyQuotes = () => apiGet<{ items: QuoteSummary[] }>('/demand/quotes');
export const reviseQuote = (id: string, body: unknown, key: string) =>
  apiPost(`/demand/quotes/${id}/revise`, body, { idempotencyKey: key });
export const compareQuotes = (rfqId: string) => apiGet<Comparison>(`/demand/rfqs/${rfqId}/comparison`);

// Awards
export const createAward = (rfqId: string, body: unknown, key: string) =>
  apiPost<{ id: string; ref: string; fullyAwarded: boolean }>(`/demand/rfqs/${rfqId}/awards`, body, { idempotencyKey: key });
export const listAwards = (rfqId: string) => apiGet<{ items: Award[] }>(`/demand/rfqs/${rfqId}/awards`);

// Ops
export const opsDesk = () => apiGet<OpsDesk>('/demand/ops/desk');
export const addSourcingNote = (requirementId: string, note: string) =>
  apiPost(`/demand/ops/requirements/${requirementId}/sourcing-notes`, { note });

export const inr = (minor: string | number): string => `₹${(Number(minor) / 100).toLocaleString('en-IN')}`;
