import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { Drawer } from '../components/Drawer';

export interface NavItem {
  to: string;
  label: string;
  testId: string;
  end?: boolean;
}

export function NavList({ items, testId }: { items: NavItem[]; testId: string }): JSX.Element {
  return (
    <nav className="fs-nav" aria-label="Sections" data-testid={`${testId}-sidebar`}>
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          data-testid={i.testId}
          className={({ isActive }) => `fs-nav__item${isActive ? ' fs-nav__item--active' : ''}`}
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function BottomNav({
  items,
  moreItems = [],
  testId
}: {
  items: NavItem[];
  moreItems?: NavItem[];
  testId: string;
}): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const main = moreItems.length > 0 ? items.slice(0, 4) : items.slice(0, 5);
  return (
    <span data-testid={testId} style={{ display: 'contents' }}>
      {main.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          data-testid={`${i.testId}-bottom`}
          className={({ isActive }) => `fs-bottomnav__item${isActive ? ' fs-bottomnav__item--active' : ''}`}
        >
          {i.label}
        </NavLink>
      ))}
      {moreItems.length > 0 && (
        <button
          type="button"
          className="fs-bottomnav__item"
          data-testid={`${testId}-more`}
          aria-label="More destinations"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
          More
        </button>
      )}
      <Drawer open={moreOpen} title="More" onClose={() => setMoreOpen(false)} testId={`${testId}-more-drawer`}>
        <div className="fs-md-stack">
          {moreItems.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              data-testid={`${i.testId}-more`}
 onClick={() => setMoreOpen(false)}
              className={({ isActive }) => `fs-nav__item${isActive ? ' fs-nav__item--active' : ''}`}
            >
              {i.label}
            </NavLink>
          ))}
        </div>
      </Drawer>
    </span>
  );
}
