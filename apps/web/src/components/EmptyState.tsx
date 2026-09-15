import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  actionLabel,
  onAction,
  testId = 'empty-state'
}: EmptyStateProps): JSX.Element {
  return (
    <div className="fs-empty" data-testid={testId}>
      <Icon size={28} aria-hidden="true" color="var(--fs-text-tertiary)" />
      <h3 className="fs-empty__title">{title}</h3>
      {hint && <p className="fs-empty__hint">{hint}</p>}
      {actionLabel && (
        <button className="fs-btn" data-testid={`${testId}-action`} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
