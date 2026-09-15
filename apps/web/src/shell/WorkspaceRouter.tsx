import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { useWorkspace } from '../lib/workspace-context';
import { orgsOf, WORKSPACE_HOME, WORKSPACE_LABEL } from '../lib/workspaces';
import { ShellLoading, NoWorkspace } from './states';
import { PageHeader } from '../components/PageHeader';
import { Logo } from '../components/Logo';

// Root workspace router (§4): never renders the internal architecture page.
export function WorkspaceRouter(): JSX.Element {
  const { me, loading } = useAuth();
  const { workspaces, activeWorkspace, restored, switchContext } = useWorkspace();

  if (loading) {
    return <ShellLoading />;
  }
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  if (workspaces.length === 0) {
    return <NoWorkspace />;
  }
  // CASE A: exactly one permitted workspace → straight to its home.
  if (workspaces.length === 1) {
    return <Navigate to={WORKSPACE_HOME[workspaces[0].workspace]} replace />;
  }
  // CASE B/C: last-authorized context restored → its home; otherwise chooser.
  if (restored && activeWorkspace) {
    return <Navigate to={WORKSPACE_HOME[activeWorkspace]} replace />;
  }
  const groups = orgsOf(workspaces).map((o) => ({
    ...o,
    entries: workspaces.filter((w) => w.orgId === o.orgId)
  }));
  return (
    <div className="fs-preview" style={{ minHeight: '100vh' }}>
      <div className="fs-preview__wrap" data-testid="workspace-chooser" style={{ maxWidth: 640 }}>
        <div style={{ marginBottom: 'var(--fs-space-6)' }}>
          <Logo variant="horizontal" testId="chooser-logo" />
        </div>
        <PageHeader overline="Welcome" title="Choose your workspace" testId="chooser-header" />
        {groups.map((g) => (
          <section key={g.orgId} style={{ marginBottom: 'var(--fs-space-6)' }} data-testid={`chooser-org-${g.orgId.slice(0, 8)}`}>
            <p className="fs-overline" style={{ margin: '0 0 var(--fs-space-2)' }}>
              {g.orgName}
            </p>
            <div className="fs-md-stack">
              {g.entries.map((e) => (
                <button
                  key={`${e.orgId}-${e.workspace}`}
                  type="button"
                  className="fs-card fs-switcher__option"
                  data-testid={`chooser-option-${e.workspace}-${g.orgId.slice(0, 8)}`}
                  onClick={() => switchContext(e.orgId, e.workspace)}
                >
                  <span className="fs-h4">{WORKSPACE_LABEL[e.workspace]}</span>
                  <span className="fs-caption fs-text-secondary">{g.orgName}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
