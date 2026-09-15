// Workspace resolution (UX-ADR-001): derives permitted workspaces from organization
// capabilities + membership + roles + permissions — never from org category alone.
export type WorkspaceId = 'buyer' | 'supplier' | 'partner' | 'ops' | 'admin';

export interface Membership {
  org_id: string;
  name: string;
  type: string;
  org_status: string;
  membership_status: string;
  roles: string[];
  capabilities?: string[];
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  mfaActive: boolean;
  memberships: Membership[];
}

export interface WorkspaceEntry {
  orgId: string;
  orgName: string;
  orgType: string;
  workspace: WorkspaceId;
  roles: string[];
}

export const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  buyer: 'Buyer workspace',
  supplier: 'Supplier workspace',
  partner: 'Partner workspace',
  ops: 'Operations',
  admin: 'Platform Admin'
};

export const WORKSPACE_HOME: Record<WorkspaceId, string> = {
  buyer: '/buyer/home',
  supplier: '/supplier/home',
  partner: '/partner/logistics',
  ops: '/ops/exceptions',
  admin: '/admin/organizations'
};

const INTERNAL_ORG_TYPES = ['PLATFORM_OPS', 'FINANCE', 'ADMIN'];
const OPS_ROLES = ['PROCUREMENT_OPS', 'QC_AGENT', 'FINANCE_OPS', 'SUPPORT_AGENT'];

// Human labels for shell chrome (§22: no raw backend codes in navigation surfaces).
export const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Organization Admin',
  MEMBER: 'Member',
  PLATFORM_ADMIN: 'Platform Admin',
  PROCUREMENT_OPS: 'Procurement Operations',
  QC_AGENT: 'Quality Agent',
  FINANCE_OPS: 'Finance Operations',
  SUPPORT_AGENT: 'Support',
  CATALOG_MANAGER: 'Catalog Manager',
  CATALOG_VALIDATOR: 'Catalog Validator',
  KYB_REVIEWER: 'KYB Reviewer'
};

export const ORG_TYPE_LABEL: Record<string, string> = {
  BUYER: 'Buyer',
  FLORIST: 'Florist',
  WHOLESALER: 'Wholesaler',
  DECORATOR: 'Decorator',
  EVENT_PLANNER: 'Event planner',
  HOTEL: 'Hotel',
  CORPORATE_BUYER: 'Corporate buyer',
  GROWER: 'Grower',
  GROWER_GROUP: 'Grower group',
  IMPORTER: 'Importer',
  AGGREGATION_HUB: 'Aggregation hub',
  QC_PARTNER: 'QC partner',
  LOGISTICS_PROVIDER: 'Logistics provider',
  COLD_CHAIN_PARTNER: 'Cold-chain partner',
  PLATFORM_OPS: 'FloraSetu',
  FINANCE: 'FloraSetu Finance',
  ADMIN: 'FloraSetu Admin'
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.toLowerCase().replace(/_/g, ' ');
}

export function orgTypeLabel(type: string): string {
  return ORG_TYPE_LABEL[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

export function resolveWorkspaces(me: Me | null): WorkspaceEntry[] {
  if (!me) {
    return [];
  }
  const out: WorkspaceEntry[] = [];
  for (const m of me.memberships) {
    if (m.membership_status !== 'ACTIVE' || m.org_status !== 'ACTIVE') {
      continue;
    }
    const base = { orgId: m.org_id, orgName: m.name, orgType: m.type, roles: m.roles };
    if (INTERNAL_ORG_TYPES.includes(m.type)) {
      // UX-ADR-002: PLATFORM_ADMIN alone never grants the Operations workspace.
      if (m.roles.includes('PLATFORM_ADMIN')) {
        out.push({ ...base, workspace: 'admin' });
      }
      if (m.roles.some((r) => OPS_ROLES.includes(r))) {
        out.push({ ...base, workspace: 'ops' });
      }
      continue;
    }
    const caps = m.capabilities ?? [];
    if (caps.includes('BUYER')) {
      out.push({ ...base, workspace: 'buyer' });
    }
    if (caps.includes('SUPPLIER')) {
      out.push({ ...base, workspace: 'supplier' });
    }
    if (caps.includes('PARTNER_QC') || caps.includes('PARTNER_LOGISTICS')) {
      out.push({ ...base, workspace: 'partner' });
    }
  }
  return out;
}

export function hasWorkspace(
  workspaces: WorkspaceEntry[],
  orgId: string | null,
  workspace: WorkspaceId
): boolean {
  return workspaces.some((w) => w.orgId === orgId && w.workspace === workspace);
}

export function orgsOf(workspaces: WorkspaceEntry[]): { orgId: string; orgName: string; orgType: string }[] {
  const seen = new Map<string, { orgId: string; orgName: string; orgType: string }>();
  for (const w of workspaces) {
    if (!seen.has(w.orgId)) {
      seen.set(w.orgId, { orgId: w.orgId, orgName: w.orgName, orgType: w.orgType });
    }
  }
  return [...seen.values()];
}
