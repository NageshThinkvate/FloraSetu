import { apiGet, apiPatch, apiPost } from './client';

// ADR-014 (Phase 7): Admin Control Plane client. The backend enforces every boundary —
// this client renders governance surfaces, it never decides authority.

export interface AdminOverview {
  kybPendingReview: number;
  restrictedOrganizations: number;
  suspendedUsers: number;
  payoutFreezingBankChanges: number;
  securityEventsLast24h: number;
  recentAdminActivity: { action: string; object_type: string; object_ref: string | null; occurred_at: string }[];
}

export interface AdminOrg {
  id: string; ref: string; name: string; type: string; status: string;
  kyb_status: string; capabilities: string[]; created_at: string; member_count?: number;
}

export interface KybQueueRow {
  id: string; ref: string; name: string; type: string; kyb_status: string; updated_at: string;
  document_count: number; last_submitted_at: string | null;
  last_reason_code: string | null; decided_at: string | null;
}

export interface KybDocument {
  id: string; docType: string; status: string; contentType: string;
  byteSize: number; uploadedAt: string; url: string;
}

export interface KybHistoryRow {
  subject_type: string; from_status: string | null; to_status: string;
  reason_code: string | null; note: string | null; actor_user_id: string | null; created_at: string;
}

export interface KybReviewDetail {
  org: { id: string; ref: string; name: string; type: string; status: string; kyb_status: string; created_at: string };
  documents: KybDocument[];
  history: KybHistoryRow[];
}

export interface AdminUser {
  id: string; ref: string; email: string; display_name: string; status: string; created_at: string;
  mfa_active: boolean;
  memberships: { orgId: string; orgName: string; orgRef: string; membershipStatus: string; roles: string[] }[] | null;
}

export interface RoleMatrixRow {
  name: string; is_system: boolean; mfa_required: boolean;
  permissions: { code: string; description: string }[];
}

export interface ConfigRow { key: string; value: string; updated_at: string }
export interface FlagRow { key: string; enabled: boolean; valid_from: string; valid_to: string | null; created_at: string }

export interface SecurityOverview {
  privilegedUsers: { id: string; ref: string; email: string; display_name: string; status: string; mfa_active: boolean; privileged_roles: string[] | null }[];
  securityEvents: { event_type: string; severity: string; occurred_at: string; trace_id: string | null }[];
  supportGrants: { id: string; support_email: string; org_name: string; org_ref: string; reason: string; expires_at: string; created_at: string }[];
}

export interface AuditRow {
  id: string; action: string; object_type: string; object_id: string; object_ref: string | null;
  org_id: string | null; actor_user_id: string | null; actor_roles: string[]; trace_id: string | null; occurred_at: string;
}

export const KYB_REJECTION_REASONS: [string, string][] = [
  ['CORRECTION_REQUIRED', 'Correction required'],
  ['DOCUMENT_ILLEGIBLE', 'Document illegible'],
  ['DOCUMENT_EXPIRED', 'Document expired'],
  ['DETAILS_MISMATCH', 'Details do not match'],
  ['INELIGIBLE', 'Business not eligible'],
  ['OTHER', 'Other']
];

export const adminOverview = () => apiGet<AdminOverview>('/admin/overview');
export const adminOrgs = () => apiGet<{ items: AdminOrg[] }>('/admin/orgs');
export const adminOrg = (id: string) => apiGet<AdminOrg>(`/admin/orgs/${id}`);
export const restrictOrg = (id: string, reason: string) => apiPost(`/admin/orgs/${id}/restrict`, { reason });
export const liftOrg = (id: string) => apiPost(`/admin/orgs/${id}/lift`, undefined);
export const kybQueue = () => apiGet<{ items: KybQueueRow[] }>('/admin/kyb-queue');
export const kybReviewDetail = (orgId: string) => apiGet<KybReviewDetail>(`/admin/kyb/${orgId}/detail`);
export const reviewKyb = (orgId: string, body: { decision: 'VERIFIED' | 'REJECTED'; reasonCode?: string; note?: string }) =>
  apiPost(`/admin/kyb/${orgId}/review`, body);
export const adminUsers = (q?: string, status?: string) =>
  apiGet<{ items: AdminUser[] }>(`/admin/users${q || status ? `?${[q ? `q=${encodeURIComponent(q)}` : '', status ? `status=${status}` : ''].filter(Boolean).join('&')}` : ''}`);
export const suspendUser = (id: string, reason: string) => apiPost(`/admin/users/${id}/suspend`, { reason });
export const reactivateUser = (id: string) => apiPost(`/admin/users/${id}/reactivate`, undefined);
export const adminRoles = () => apiGet<{ items: RoleMatrixRow[] }>('/admin/roles');
export const adminConfig = () => apiGet<{ items: ConfigRow[] }>('/admin/config');
export const updateConfig = (key: string, value: string | number, reason?: string) =>
  apiPatch(`/admin/config/${key}`, { value, reason });
export const adminFlags = () => apiGet<{ items: FlagRow[] }>('/admin/flags');
export const setFlag = (key: string, enabled: boolean, reason?: string) =>
  apiPost(`/admin/flags/${key}`, { enabled, reason });
export const adminSecurity = () => apiGet<SecurityOverview>('/admin/security');
export const adminAudit = (filters: Record<string, string>) => {
  const qs = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return apiGet<{ items: AuditRow[] }>(`/admin/audit${qs ? `?${qs}` : ''}`);
};

export const adminAuditExport = async (filters: Record<string, string>): Promise<void> => {
  const session = JSON.parse(localStorage.getItem('florasetu.session') ?? '{}') as { accessToken?: string };
  const org = localStorage.getItem('florasetu.activeOrg') ?? '';
  const base = (import.meta.env.VITE_API_URL as string) ?? '';
  const qs = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${base}/api/admin/audit/export${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${session.accessToken ?? ''}`, 'X-Org-Id': org }
  });
  if (!res.ok) {
    throw new Error('Export failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
