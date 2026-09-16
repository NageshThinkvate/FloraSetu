import { Outlet } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

// Role-filtered Operations navigation (§9, ADR-013): no universal ops menu, and
// PLATFORM_ADMIN alone never grants Operations (UX-ADR-002). The physical QC queue
// is retired from Ops (ADR-011) — no Quality entry exists here by design.
function opsNav(roles: string[]): NavItem[] {
  const items: NavItem[] = [{ to: '/ops/exceptions', label: 'Exceptions', testId: 'ops-nav-exceptions' }];
  const isProc = roles.includes('PROCUREMENT_OPS');
  const isSupport = roles.includes('SUPPORT_AGENT');
  const isFinance = roles.includes('FINANCE_OPS');
  if (isProc) {
    items.push({ to: '/ops/procurement', label: 'Procurement', testId: 'ops-nav-procurement' });
  }
  if (isProc || isSupport || isFinance) {
    items.push({ to: '/ops/orders', label: 'Orders', testId: 'ops-nav-orders' });
  }
  // Logistics is monitor/support only (ADR-012) — execution stays with the partner.
  if (isProc || isSupport) {
    items.push({ to: '/ops/logistics', label: 'Logistics', testId: 'ops-nav-logistics' });
  }
  if (isProc || isSupport || isFinance) {
    items.push({ to: '/ops/claims', label: 'Claims', testId: 'ops-nav-claims' });
  }
  if (isFinance) {
    items.push({ to: '/ops/finance', label: 'Finance', testId: 'ops-nav-finance' });
  }
  return items;
}

export default function OpsShell(): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const membership = me?.memberships.find((m) => m.org_id === activeOrgId);
  const nav = opsNav(membership?.roles ?? []);
  return (
    <WorkspaceGuard workspace="ops">
      <ShellFrame
        testId="ops-shell"
        header={
          <>
            <WorkspaceSwitcher />
            <span className="fs-shell__header-actions">
              <NotificationBell />
            </span>
          </>
        }
        sidebar={<NavList items={nav} testId="ops-nav" />}
        bottomNav={<BottomNav items={nav.slice(0, 4)} moreItems={nav.slice(4)} testId="ops-bottomnav" />}
      >
        <Outlet />
      </ShellFrame>
    </WorkspaceGuard>
  );
}
