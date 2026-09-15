import { useRef } from 'react';
import { useOverlay } from '../design/useOverlay';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmationDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  testId = 'confirmation-dialog'
}: ConfirmationDialogProps): JSX.Element | null {
  const boxRef = useRef<HTMLDivElement>(null);
  useOverlay(open, onCancel, boxRef);
  if (!open) {
    return null;
  }
  return (
    <>
      <div className="fs-overlay" onClick={onCancel} />
      <div className="fs-dialog" data-testid={testId}>
        <div
          ref={boxRef}
          className="fs-dialog__box"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${testId}-title`}
          aria-describedby={`${testId}-desc`}
        >
          <h2 className="fs-dialog__title" id={`${testId}-title`}>
            {title}
          </h2>
          <p className="fs-dialog__consequence" id={`${testId}-desc`}>
            {consequence}
          </p>
          <div className="fs-dialog__actions">
            <button className="fs-btn fs-btn--ghost" data-testid={`${testId}-cancel`} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              className={`fs-btn ${destructive ? 'fs-btn--danger' : ''}`}
              data-testid={`${testId}-confirm`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
