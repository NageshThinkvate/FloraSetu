import { ReactNode } from 'react';
import { StatusPill } from './StatusPill';

interface TaskCardProps {
  title: string;
  meta?: string[];
  status?: string;
  statusLabel?: string;
  age?: string;
  actionLabel?: string;
  onAction?: () => void;
  footer?: ReactNode;
  testId?: string;
}

export function TaskCard({
  title,
  meta = [],
  status,
  statusLabel,
  age,
  actionLabel,
  onAction,
  footer,
  testId = 'task-card'
}: TaskCardProps): JSX.Element {
  return (
    <article className="fs-card fs-task-card" data-testid={testId}>
      <div className="fs-task-card__top">
        <h3 className="fs-task-card__title">{title}</h3>
        {status && <StatusPill status={status} label={statusLabel} testId={`${testId}-status`} />}
      </div>
      {meta.length > 0 && (
        <div className="fs-task-card__meta">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
      <div className="fs-task-card__foot">
        <span className="fs-task-card__age">{age ?? ''}</span>
        {footer ??
          (actionLabel && (
            <button className="fs-btn fs-btn--sm" data-testid={`${testId}-action`} onClick={onAction}>
              {actionLabel}
            </button>
          ))}
      </div>
    </article>
  );
}
