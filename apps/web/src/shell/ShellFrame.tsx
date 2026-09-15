import { ReactNode } from 'react';

interface ShellFrameProps {
  header?: ReactNode;
  sidebar?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
  testId?: string;
}

// Structural shell primitive (Phase 1). Not wired to routes yet — per-shell
// navigation lands in Phase 2 (UI_UX_SCREEN_REDESIGN_PLAN.md §7).
export function ShellFrame({
  header,
  sidebar,
  bottomNav,
  children,
  testId = 'shell-frame'
}: ShellFrameProps): JSX.Element {
  return (
    <div className="fs-shell" data-testid={testId}>
      {header && <header className="fs-shell__header">{header}</header>}
      <div className="fs-shell__body">
        {sidebar && (
          <aside className="fs-shell__sidebar" aria-label="Section navigation">
            {sidebar}
          </aside>
        )}
        <main className="fs-shell__content">{children}</main>
      </div>
      {bottomNav && <nav className="fs-shell__bottomnav" aria-label="Primary">{bottomNav}</nav>}
    </div>
  );
}
