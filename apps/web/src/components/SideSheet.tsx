import { ReactNode, useRef } from 'react';
import { X } from 'lucide-react';
import { useOverlay } from '../design/useOverlay';

interface SideSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

export function SideSheet({
  open,
  title,
  onClose,
  children,
  testId = 'side-sheet'
}: SideSheetProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, ref);
  if (!open) {
    return null;
  }
  return (
    <>
      <div className="fs-overlay" onClick={onClose} />
      <div
        ref={ref}
        className="fs-sidesheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
      >
        <div className="fs-sheet__head">
          <h2 className="fs-sheet__title">{title}</h2>
          <button className="fs-sheet__close" data-testid={`${testId}-close`} onClick={onClose} aria-label="Close panel">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="fs-sheet__body">{children}</div>
      </div>
    </>
  );
}
