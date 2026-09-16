import { Outlet } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

const NAV: NavItem[] = [
  { to: '/partner/logistics', label: 'Home', testId: 'partner-nav-home', end: true },
  { to: '/partner/logistics/jobs', label: 'Jobs', testId: 'partner-nav-jobs' },
  { to: '/partner/logistics/delivered', label: 'Delivered', testId: 'partner-nav-delivered' }
];

export default function PartnerShell(): JSX.Element {
  return (
    <WorkspaceGuard workspace="partner">
      <ShellFrame
        testId="partner-shell"
        header={
          <>
            <WorkspaceSwitcher />
            <span className="fs-shell__header-actions">
              <NotificationBell />
            </span>
          </>
        }
        sidebar={<NavList items={NAV} testId="partner-nav" />}
        bottomNav={<BottomNav items={NAV} testId="partner-bottomnav" />}
      >
        <Outlet />
      </ShellFrame>
    </WorkspaceGuard>
  );
}
