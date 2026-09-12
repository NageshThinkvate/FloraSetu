import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/api/auth';
import { AppShell } from './shell/AppShell';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { CatalogPage } from './pages/CatalogPage';
import { CatalogAdminPage } from './pages/CatalogAdminPage';
import { CapabilitiesPage } from './pages/CapabilitiesPage';
import { DemandHomePage } from './pages/DemandHomePage';
import { QuickRequestPage } from './pages/QuickRequestPage';
import { RequirementDetailPage } from './pages/RequirementDetailPage';
import { EventsPage } from './pages/EventsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { RfqsPage } from './pages/RfqsPage';
import { RfqDetailPage } from './pages/RfqDetailPage';
import { SupplierInboxPage } from './pages/SupplierInboxPage';
import { SupplierRfqPage } from './pages/SupplierRfqPage';
import { MyQuotesPage } from './pages/MyQuotesPage';
import { OpsDeskPage } from './pages/OpsDeskPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { SupplierOrdersPage } from './pages/SupplierOrdersPage';
import { LotsPage } from './pages/LotsPage';
import { LotDetailPage } from './pages/LotDetailPage';
import { QcQueuePage } from './pages/QcQueuePage';
import { ControlTowerPage } from './pages/ControlTowerPage';
import { FinancePage } from './pages/FinancePage';
import { ClaimsPage } from './pages/ClaimsPage';
import { ClaimDetailPage } from './pages/ClaimDetailPage';

function Protected({ children }: { children: JSX.Element }): JSX.Element {
  const { me, loading } = useAuth();
  if (loading) {
    return <main className="app-shell">Loading…</main>;
  }
  return me ? children : <Navigate to="/login" replace />;
}

function Nav(): JSX.Element {
  const { me } = useAuth();
  if (!me) {
    return <></>;
  }
  const platform = me.memberships.some((m) => m.type === 'PLATFORM_OPS' && m.roles.includes('PLATFORM_ADMIN'));
  const ops = me.memberships.some((m) =>
    m.roles.includes('PROCUREMENT_OPS') || m.roles.includes('PLATFORM_ADMIN'));
  const catalogManager = me.memberships.some((m) =>
    m.roles.includes('CATALOG_MANAGER') || m.roles.includes('PLATFORM_ADMIN') || m.roles.includes('ORG_ADMIN'));
  const finance = me.memberships.some((m) =>
    m.roles.includes('FINANCE_OPS') || m.roles.includes('PLATFORM_ADMIN'));
  return (
    <nav className="top-nav" data-testid="top-nav">
      <Link to="/" data-testid="nav-home">FloraSetu</Link>
      <Link to="/demand" data-testid="nav-demand">Procurement</Link>
      <Link to="/orders" data-testid="nav-orders">Orders</Link>
      <Link to="/supply/inbox" data-testid="nav-inbox">Inbox</Link>
      <Link to="/supply/orders" data-testid="nav-fulfilment">Fulfilment</Link>
      <Link to="/supply/lots" data-testid="nav-lots">Lots</Link>
      <Link to="/claims" data-testid="nav-claims">Claims</Link>
      <Link to="/catalog" data-testid="nav-catalog">Catalog</Link>
      <Link to="/catalog/capabilities" data-testid="nav-capabilities">Capabilities</Link>
      {catalogManager && <Link to="/catalog/admin" data-testid="nav-catalog-admin">Catalog admin</Link>}
      {ops && <Link to="/ops/desk" data-testid="nav-ops-desk">Ops desk</Link>}
      {ops && <Link to="/ops/qc" data-testid="nav-ops-qc">QC</Link>}
      {ops && <Link to="/ops/tower" data-testid="nav-ops-tower">Tower</Link>}
      {(ops || finance) && <Link to="/ops/finance" data-testid="nav-ops-finance">Finance</Link>}
      <Link to="/account" data-testid="nav-account">Account</Link>
      <Link to="/onboarding" data-testid="nav-onboarding">New organization</Link>
      {platform && <Link to="/admin" data-testid="nav-admin">Admin</Link>}
    </nav>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<AppShell />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
          <Route path="/account" element={<Protected><AccountPage /></Protected>} />
          <Route path="/admin" element={<Protected><AdminPage /></Protected>} />
          <Route path="/catalog" element={<Protected><CatalogPage /></Protected>} />
          <Route path="/catalog/admin" element={<Protected><CatalogAdminPage /></Protected>} />
          <Route path="/catalog/capabilities" element={<Protected><CapabilitiesPage /></Protected>} />
          <Route path="/demand" element={<Protected><DemandHomePage /></Protected>} />
          <Route path="/demand/quick" element={<Protected><QuickRequestPage /></Protected>} />
          <Route path="/demand/requirements/:id" element={<Protected><RequirementDetailPage /></Protected>} />
          <Route path="/demand/events" element={<Protected><EventsPage /></Protected>} />
          <Route path="/demand/events/:id" element={<Protected><EventDetailPage /></Protected>} />
          <Route path="/demand/rfqs" element={<Protected><RfqsPage /></Protected>} />
          <Route path="/demand/rfqs/:id" element={<Protected><RfqDetailPage /></Protected>} />
          <Route path="/supply/inbox" element={<Protected><SupplierInboxPage /></Protected>} />
          <Route path="/supply/rfqs/:id" element={<Protected><SupplierRfqPage /></Protected>} />
          <Route path="/supply/quotes" element={<Protected><MyQuotesPage /></Protected>} />
          <Route path="/ops/desk" element={<Protected><OpsDeskPage /></Protected>} />
          <Route path="/orders" element={<Protected><OrdersPage /></Protected>} />
          <Route path="/orders/:id" element={<Protected><OrderDetailPage /></Protected>} />
          <Route path="/supply/orders" element={<Protected><SupplierOrdersPage /></Protected>} />
          <Route path="/supply/lots" element={<Protected><LotsPage /></Protected>} />
          <Route path="/supply/lots/:id" element={<Protected><LotDetailPage /></Protected>} />
          <Route path="/claims" element={<Protected><ClaimsPage /></Protected>} />
          <Route path="/claims/:id" element={<Protected><ClaimDetailPage /></Protected>} />
          <Route path="/ops/qc" element={<Protected><QcQueuePage /></Protected>} />
          <Route path="/ops/tower" element={<Protected><ControlTowerPage /></Protected>} />
          <Route path="/ops/finance" element={<Protected><FinancePage /></Protected>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
