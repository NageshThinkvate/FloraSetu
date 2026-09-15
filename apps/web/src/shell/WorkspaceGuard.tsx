import { ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { useWorkspace } from '../lib/workspace-context';
import { hasWorkspace, WorkspaceId, WORKSPACE_HOME, WORKSPACE_LABEL } from '../lib/workspaces';
import { PermissionDenied, ShellLoading } from './states';

// Route-level workspace authorization (§15): navigation hiding is not authorization.
// Renders a designed permission-denied state — never raw 403/JSON/stack traces.
export function WorkspaceGuard({
  workspace,
  children
}: {
  workspace: WorkspaceId;
  children: ReactNode;
}): JSX.Element {
  const { me, loading, activeOrgId } = useAuth();
  const { workspaces, adoptContext } = useWorkspace();

  const allowedHere = hasWorkspace(workspaces, activeOrgId, workspace);
  const elsewhere = workspaces.find((w) => w.workspace === workspace);

  useEffect(() => {
    // Deep link into another authorized workspace (e.g. notification): adopt it explicitly
    // (toast announces the change) instead of showing content for the wrong organization.
    if (!loading && me && !allowedHere && elsewhere) {
      adoptContext(elsewhere.orgId, elsewhere.workspace);
    }
  }, [loading, me, allowedHere, elsewhere, adoptContext]);

  if (loading) {
    return <ShellLoading />;
  }
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  if (!allowedHere && !elsewhere) {
    const fallback = workspaces.find((w) => w.orgId === activeOrgId) ?? workspaces[0];
    return (
      <PermissionDenied
        workspaceLabel={WORKSPACE_LABEL[workspace]}
        homePath={fallback ? WORKSPACE_HOME[fallback.workspace] : '/'}
      />
    );
  }
  if (!allowedHere && elsewhere) {
    return <ShellLoading />;
  }
  return <>{children}</>;
}
