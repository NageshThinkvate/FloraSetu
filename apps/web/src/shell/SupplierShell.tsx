import { Outlet } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import { WorkspaceGuard } from './WorkspaceGuard';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NotificationBell } from './NotificationBell';
import { NavList, BottomNav, NavItem } from './ShellNav';

const NAV: NavItem[] = [
  { to: '/supplier/home', label: 'Home', testId: 'supplier-nav-home' },
  { to: '/supplier/requests', label: 'Requests', testId: 'supplier-nav-requests' },
  { to: '/supplier/offers', label: 'Offers', testId: 'supplier-nav-offers' },
  { to: '/supplier/supply', label: 'Supply', testId: 'supplier-nav-supply' },
  { to: '/supplier/orders', label: 'Orders', testId: 'supplier-nav-orders' },
  { to: '/supplier/payments', label: 'Payments', testId: 'supplier-nav-payments' },
  { to: '/supplier/catalog', label: 'Catalog', testId: 'supplier-nav-catalog' },
  { to: '/supplier/capabilities', label: 'Capabilities', testId: 'supplier-nav-capabilities' },
  { to: '/supplier/org', label: 'Company', testId: 'supplier-nav-org' }
];

const BOTTOM: NavItem[] = [NAV[0], NAV[1], NAV[3], NAV[4]];
const MORE: NavItem[] = [NAV[2], NAV[5], NAV[6], NAV[7], NAV[8]];

export default function SupplierShell(): JSX.Element {
  return (
    <WorkspaceGuard workspace="supplier">
      <ShellFrame
        testId="supplier-shell"
        header={
          <>
            <WorkspaceSwitcher />
            <span className="fs-shell__header-actions">
              <NotificationBell />
            </span>
          </>
        }
        sidebar={<NavList items={NAV} testId="supplier-nav" />}
        bottomNav={<BottomNav items={BOTTOM} moreItems={MORE} testId="supplier-bottomnav" />}
      >
        <Outlet />
      </ShellFrame>
    </WorkspaceGuard>
  );
}
