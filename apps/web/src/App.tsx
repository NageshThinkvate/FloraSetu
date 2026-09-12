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
  return (
    <nav className="top-nav" data-testid="top-nav">
      <Link to="/" data-testid="nav-home">FloraSetu</Link>
      <Link to="/catalog" data-testid="nav-catalog">Catalog</Link>
      <Link to="/catalog/capabilities" data-testid="nav-capabilities">Capabilities</Link>
      <Link to="/catalog/admin" data-testid="nav-catalog-admin">Catalog admin</Link>
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
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
