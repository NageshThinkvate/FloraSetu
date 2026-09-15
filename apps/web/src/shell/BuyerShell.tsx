import { Outlet } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

const NAV: NavItem[] = [
  { to: '/buyer/home', label: 'Home', testId: 'buyer-nav-home' },
  { to: '/buyer/requests/new', label: 'Get flowers', testId: 'buyer-nav-get-flowers' },
  { to: '/buyer/events', label: 'Events', testId: 'buyer-nav-events' },
  { to: '/buyer/offers', label: 'Offers', testId: 'buyer-nav-offers' },
  { to: '/buyer/orders', label: 'Orders', testId: 'buyer-nav-orders' },
  { to: '/buyer/deliveries', label: 'Deliveries', testId: 'buyer-nav-deliveries' },
  { to: '/buyer/issues', label: 'Issues', testId: 'buyer-nav-issues' },
  { to: '/buyer/catalog', label: 'Catalog', testId: 'buyer-nav-catalog' },
  { to: '/buyer/org', label: 'Organization', testId: 'buyer-nav-org' }
];

const BOTTOM: NavItem[] = [NAV[0], NAV[3], NAV[4], NAV[2]];
const MORE: NavItem[] = [NAV[1], NAV[5], NAV[6], NAV[7], NAV[8]];

export default function BuyerShell(): JSX.Element {
  return (
    <WorkspaceGuard workspace="buyer">
      <ShellFrame
        testId="buyer-shell"
        header={
          <>
            <WorkspaceSwitcher />
            <span className="fs-shell__header-actions">
              <NotificationBell />
            </span>
          </>
        }
        sidebar={<NavList items={NAV} testId="buyer-nav" />}
        bottomNav={<BottomNav items={BOTTOM} moreItems={MORE} testId="buyer-bottomnav" />}
      >
        <Outlet />
      </ShellFrame>
    </WorkspaceGuard>
  );
}
