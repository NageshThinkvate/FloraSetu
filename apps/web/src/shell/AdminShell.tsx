import { Outlet } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

const NAV: NavItem[] = [
  { to: '/admin/overview', label: 'Overview', testId: 'admin-nav-overview' },
  { to: '/admin/organizations', label: 'Organizations', testId: 'admin-nav-orgs' },
  { to: '/admin/kyb', label: 'KYB governance', testId: 'admin-nav-kyb' },
  { to: '/admin/users', label: 'Users & access', testId: 'admin-nav-users' },
  { to: '/admin/roles', label: 'Roles & permissions', testId: 'admin-nav-roles' },
  { to: '/admin/catalog', label: 'Catalog standards', testId: 'admin-nav-catalog' },
  { to: '/admin/config', label: 'Configuration', testId: 'admin-nav-config' },
  { to: '/admin/flags', label: 'Feature flags', testId: 'admin-nav-flags' },
  { to: '/admin/security', label: 'Security', testId: 'admin-nav-security' },
  { to: '/admin/audit', label: 'Audit', testId: 'admin-nav-audit' }
];

export default function AdminShell(): JSX.Element {
  return (
    <WorkspaceGuard workspace="admin">
      <ShellFrame
        testId="admin-shell"
        header={
          <>
            <WorkspaceSwitcher />
            <span className="fs-shell__header-actions">
              <NotificationBell />
            </span>
          </>
        }
        sidebar={<NavList items={NAV} testId="admin-nav" />}
        bottomNav={<BottomNav items={NAV.slice(0, 4)} moreItems={NAV.slice(4)} testId="admin-bottomnav" />}
      >
        <Outlet />
      </ShellFrame>
    </WorkspaceGuard>
  );
}
