import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/api/auth';
import { ToastProvider } from './lib/toast';
import { WorkspaceProvider, useWorkspace } from './lib/workspace-context';
import { WorkspaceRouter } from './shell/WorkspaceRouter';
import { ShellLoading } from './shell/states';
import { BuyerHome, SupplierHome } from './shell/homes';
import { PlaceholderPage } from './shell/placeholders';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { CatalogPage } from './pages/CatalogPage';
import { CatalogAdminPage } from './pages/CatalogAdminPage';
import { CapabilitiesPage } from './pages/CapabilitiesPage';
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
import { DesignSystemPreviewPage } from './pages/DesignSystemPreviewPage';

const BuyerShell = lazy(() => import('./shell/BuyerShell'));
const SupplierShell = lazy(() => import('./shell/SupplierShell'));
const PartnerShell = lazy(() => import('./shell/PartnerShell'));
const OpsShell = lazy(() => import('./shell/OpsShell'));
const AdminShell = lazy(() => import('./shell/AdminShell'));

function Protected({ children }: { children: JSX.Element }): JSX.Element {
  const { me, loading } = useAuth();
  if (loading) {
    return <ShellLoading />;
  }
  return me ? children : <Navigate to="/login" replace />;
}

// Controlled legacy → workspace redirect map (§5): legacy paths never become a
// second source of UX truth; working pages live on under the new shell roots.
function LegacyRedirect({ to }: { to: string }): JSX.Element {
  const params = useParams();
  return <Navigate to={to.replace(':id', params.id ?? '')} replace />;
}

function AccountRedirect(): JSX.Element {
  const { activeWorkspace } = useWorkspace();
  const target =
    activeWorkspace === 'supplier' ? '/supplier/org' : activeWorkspace === 'buyer' ? '/buyer/org' : '/';
  return <Navigate to={target} replace />;
}

function CatalogRedirect(): JSX.Element {
  const { activeWorkspace } = useWorkspace();
  return <Navigate to={activeWorkspace === 'supplier' ? '/supplier/catalog' : '/buyer/catalog'} replace />;
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <WorkspaceProvider>
            <Routes>
              <Route path="/" element={<WorkspaceRouter />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
              {import.meta.env.DEV && (
                <Route path="/dev/design-system" element={<DesignSystemPreviewPage />} />
              )}

              <Route path="/buyer" element={<Suspense fallback={<ShellLoading />}><BuyerShell /></Suspense>}>
                <Route index element={<Navigate to="home" replace />} />
                <Route path="home" element={<BuyerHome />} />
                <Route path="requests/new" element={<QuickRequestPage />} />
                <Route path="requests/:id" element={<RequirementDetailPage />} />
                <Route path="offers" element={<RfqsPage />} />
                <Route path="offers/:id" element={<RfqDetailPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="orders/:id" element={<OrderDetailPage />} />
                <Route path="deliveries" element={<OrdersPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="events/:id" element={<EventDetailPage />} />
                <Route path="issues" element={<ClaimsPage />} />
                <Route path="issues/:id" element={<ClaimDetailPage />} />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="org" element={<AccountPage />} />
              </Route>

              <Route path="/supplier" element={<Suspense fallback={<ShellLoading />}><SupplierShell /></Suspense>}>
                <Route index element={<Navigate to="home" replace />} />
                <Route path="home" element={<SupplierHome />} />
                <Route path="requests" element={<SupplierInboxPage />} />
                <Route path="requests/:id" element={<SupplierRfqPage />} />
                <Route path="offers" element={<MyQuotesPage />} />
                <Route path="orders" element={<SupplierOrdersPage />} />
                <Route path="supply" element={<LotsPage />} />
                <Route path="supply/:id" element={<LotDetailPage />} />
                <Route
                  path="payments"
                  element={
                    <PlaceholderPage
                      overline="Supplier workspace"
                      title="Payouts"
                      description="Gross, deductions, adjustments, net and payout status with references will appear here."
                      testId="supplier-payments"
                    />
                  }
                />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="capabilities" element={<CapabilitiesPage />} />
                <Route path="org" element={<AccountPage />} />
              </Route>

              <Route path="/partner" element={<Suspense fallback={<ShellLoading />}><PartnerShell /></Suspense>}>
                <Route index element={<Navigate to="qc" replace />} />
                <Route path="qc" element={<QcQueuePage />} />
                <Route
                  path="completed"
                  element={
                    <PlaceholderPage
                      overline="Partner workspace"
                      title="Completed inspections"
                      description="Your finished quality checks will appear here."
                      actionLabel="Open queue"
                      actionTo="/partner/qc"
                      testId="partner-completed"
                    />
                  }
                />
              </Route>

              <Route path="/ops" element={<Suspense fallback={<ShellLoading />}><OpsShell /></Suspense>}>
                <Route index element={<Navigate to="exceptions" replace />} />
                <Route path="exceptions" element={<ControlTowerPage />} />
                <Route path="sourcing" element={<OpsDeskPage />} />
                <Route path="quality" element={<QcQueuePage />} />
                <Route
                  path="logistics"
                  element={
                    <PlaceholderPage
                      overline="Operations"
                      title="Logistics"
                      description="Shipment and excursion workspaces arrive with the Operations console phase."
                      actionLabel="Open exceptions"
                      actionTo="/ops/exceptions"
                      testId="ops-logistics"
                    />
                  }
                />
                <Route path="claims" element={<ClaimsPage />} />
                <Route path="claims/:id" element={<ClaimDetailPage />} />
                <Route path="finance" element={<FinancePage />} />
              </Route>

              <Route path="/admin" element={<Suspense fallback={<ShellLoading />}><AdminShell /></Suspense>}>
                <Route index element={<Navigate to="organizations" replace />} />
                <Route path="organizations" element={<AdminPage />} />
                <Route path="kyb" element={<AdminPage />} />
                <Route
                  path="users"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Users & access"
                      description="Member and role management across organizations arrives with the Platform Admin phase."
                      testId="admin-users"
                    />
                  }
                />
                <Route
                  path="roles"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Roles & permissions"
                      description="Role and permission matrices arrive with the Platform Admin phase."
                      testId="admin-roles"
                    />
                  }
                />
                <Route path="catalog" element={<CatalogAdminPage />} />
                <Route
                  path="config"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Configuration"
                      description="Effective-dated platform configuration arrives with the Platform Admin phase."
                      testId="admin-config"
                    />
                  }
                />
                <Route
                  path="flags"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Feature flags"
                      description="Feature flag management arrives with the Platform Admin phase."
                      testId="admin-flags"
                    />
                  }
                />
                <Route
                  path="security"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Security"
                      description="MFA policy, sessions and security controls arrive with the Platform Admin phase."
                      testId="admin-security"
                    />
                  }
                />
                <Route
                  path="audit"
                  element={
                    <PlaceholderPage
                      overline="Platform Admin"
                      title="Audit"
                      description="Audit log search (trace ID, organization, actor, object) arrives with the Platform Admin phase."
                      testId="admin-audit"
                    />
                  }
                />
              </Route>

              {/* Legacy redirect map — §5 controlled migration */}
              <Route path="/demand" element={<Navigate to="/buyer/home" replace />} />
              <Route path="/demand/quick" element={<Navigate to="/buyer/requests/new" replace />} />
              <Route path="/demand/requirements/:id" element={<LegacyRedirect to="/buyer/requests/:id" />} />
              <Route path="/demand/events" element={<Navigate to="/buyer/events" replace />} />
              <Route path="/demand/events/:id" element={<LegacyRedirect to="/buyer/events/:id" />} />
              <Route path="/demand/rfqs" element={<Navigate to="/buyer/offers" replace />} />
              <Route path="/demand/rfqs/:id" element={<LegacyRedirect to="/buyer/offers/:id" />} />
              <Route path="/orders" element={<Navigate to="/buyer/orders" replace />} />
              <Route path="/orders/:id" element={<LegacyRedirect to="/buyer/orders/:id" />} />
              <Route path="/claims" element={<Navigate to="/buyer/issues" replace />} />
              <Route path="/claims/:id" element={<LegacyRedirect to="/buyer/issues/:id" />} />
              <Route path="/supply/inbox" element={<Navigate to="/supplier/requests" replace />} />
              <Route path="/supply/rfqs/:id" element={<LegacyRedirect to="/supplier/requests/:id" />} />
              <Route path="/supply/quotes" element={<Navigate to="/supplier/offers" replace />} />
              <Route path="/supply/orders" element={<Navigate to="/supplier/orders" replace />} />
              <Route path="/supply/lots" element={<Navigate to="/supplier/supply" replace />} />
              <Route path="/supply/lots/:id" element={<LegacyRedirect to="/supplier/supply/:id" />} />
              <Route path="/ops/desk" element={<Navigate to="/ops/sourcing" replace />} />
              <Route path="/ops/qc" element={<Navigate to="/ops/quality" replace />} />
              <Route path="/ops/tower" element={<Navigate to="/ops/exceptions" replace />} />
              <Route path="/ops/finance" element={<Navigate to="/ops/finance" replace />} />
              <Route path="/account" element={<AccountRedirect />} />
              <Route path="/catalog" element={<CatalogRedirect />} />
              <Route path="/catalog/admin" element={<Navigate to="/admin/catalog" replace />} />
              <Route path="/catalog/capabilities" element={<Navigate to="/supplier/capabilities" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </WorkspaceProvider>
        </ToastProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
