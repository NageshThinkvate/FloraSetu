import { Outlet } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

// Role-filtered Operations navigation (§9): no universal ops menu, and
// PLATFORM_ADMIN alone never grants Operations (UX-ADR-002).
function opsNav(roles: string[]): NavItem[] {
  const items: NavItem[] = [{ to: '/ops/exceptions', label: 'Exceptions', testId: 'ops-nav-exceptions' }];
  if (roles.includes('PROCUREMENT_OPS')) {
    items.push(
      { to: '/ops/sourcing', label: 'Sourcing', testId: 'ops-nav-sourcing' },
      { to: '/ops/logistics', label: 'Logistics', testId: 'ops-nav-logistics' }
    );
  }
  if (roles.includes('QC_AGENT')) {
    items.push({ to: '/ops/quality', label: 'Quality', testId: 'ops-nav-quality' });
  }
  if (roles.includes('SUPPORT_AGENT')) {
    items.push({ to: '/ops/claims', label: 'Claims', testId: 'ops-nav-claims' });
  }
  if (roles.includes('FINANCE_OPS')) {
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
