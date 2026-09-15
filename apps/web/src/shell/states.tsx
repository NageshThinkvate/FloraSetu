import { Link } from 'react-router-dom';
import { ShieldX, CloudOff, LayoutGrid } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

export function ShellLoading(): JSX.Element {
  return (
    <div style={{ padding: 'var(--fs-space-8) var(--fs-space-4)' }} data-testid="shell-loading">
      <SkeletonLoader variant="card" count={3} />
    </div>
  );
}

export function PermissionDenied({
  workspaceLabel,
  homePath
}: {
  workspaceLabel: string;
  homePath: string;
}): JSX.Element {
  return (
    <div style={{ padding: 'var(--fs-space-8) var(--fs-space-4)' }} data-testid="permission-denied">
      <EmptyState
        icon={ShieldX}
        title={`You don't have access to ${workspaceLabel}`}
        hint="Your access to this workspace has changed, or this area belongs to a different role. Choose a workspace you're permitted to enter."
        testId="permission-denied-state"
      />
      <div style={{ marginTop: 'var(--fs-space-3)' }}>
        <Link to={homePath} data-testid="permission-denied-home" className="fs-btn">
          Return to my workspace
        </Link>
      </div>
    </div>
  );
}

export function NoWorkspace(): JSX.Element {
  return (
    <div className="fs-preview" style={{ minHeight: '100vh', padding: 'var(--fs-space-8) var(--fs-space-4)' }}>
      <EmptyState
        icon={LayoutGrid}
        title="No workspace available yet"
        hint="Your account doesn't have access to any workspace. Ask your organization administrator to grant you a role, or contact FloraSetu support."
        testId="no-workspace-state"
      />
    </div>
  );
}

export function ShellError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div style={{ padding: 'var(--fs-space-8) var(--fs-space-4)' }} data-testid="shell-error">
      <InlineAlert variant="error" title="We couldn't load this workspace right now" testId="shell-error-alert">
        Check your connection and try again. Your work is safe.
      </InlineAlert>
      <div style={{ marginTop: 'var(--fs-space-3)' }}>
        <button className="fs-btn" data-testid="shell-error-retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

export function OfflineBanner(): JSX.Element {
  return (
    <div className="fs-alert fs-alert--warning" role="status" data-testid="offline-banner">
      <CloudOff size={18} aria-hidden="true" />
      <div>
        <p>You're offline. Drafts are kept on this device; sending will resume when you're back.</p>
      </div>
    </div>
  );
}
