import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from './Logo';

export const PUBLIC_NAV: [string, string][] = [
  ['Buy Flowers', '/#audiences'],
  ['For Suppliers', '/#suppliers'],
  ['How It Works', '/#how-it-works'],
  ['Solutions', '/#features'],
  ['About', '/#about']
];

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'FloraSetu | Premium Flower Procurement & Fulfilment Network';
    };
  }, [title]);
}

// Shared public-site chrome (header + footer) — one premium composition across the
// homepage, legal pages and every public route. Logo is always a link to /.
export function PublicHeader(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="fs-pub__header">
      <div className="fs-pub__wrap fs-pub__header-in">
        <Link to="/" aria-label="FloraSetu home" className="fs-pub__logo-link" data-testid="public-logo">
          <Logo variant="horizontal" size={44} testId="public-logo-img" />
        </Link>
        <nav className="fs-pub__nav" aria-label="Primary">
          {PUBLIC_NAV.map(([label, href]) => (
            <a key={href} href={href} data-testid={`public-nav-${label.toLowerCase().replace(/ /g, '-')}`}>{label}</a>
          ))}
        </nav>
        <div className="fs-pub__actions">
          <Link to="/login" className="pub-btn pub-btn--ghost" data-testid="public-signin">Sign in</Link>
          <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-join">Join FloraSetu</Link>
        </div>
        <button
          type="button"
          className="fs-pub__menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          data-testid="public-menu-btn"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      <nav className="fs-pub__mobile-nav" data-open={menuOpen} data-testid="public-mobile-nav" aria-label="Mobile">
        {PUBLIC_NAV.map(([label, href]) => (
          <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
        ))}
        <Link to="/login" onClick={() => setMenuOpen(false)}>Sign in</Link>
      </nav>
    </header>
  );
}

export function PublicFooter(): JSX.Element {
  return (
    <footer className="fs-pub__footer">
      <div className="fs-pub__wrap">
        <div className="fs-pub__footer-grid">
          <div className="fs-pub__footer-brand">
            <Link to="/" aria-label="FloraSetu home" data-testid="public-footer-logo">
              <Logo variant="horizontal" light size={40} testId="public-footer-logo-img" />
            </Link>
            <p className="fs-pub__tagline">Premium Flower Procurement &amp; Fulfilment Network</p>
          </div>
          <nav aria-label="Platform" className="fs-pub__footer-col">
            <p className="fs-pub__footer-heading">Platform</p>
            <Link to="/register">For Buyers</Link>
            <Link to="/register">For Suppliers</Link>
            <Link to="/register">Logistics Partners</Link>
            <a href="/#how-it-works">How It Works</a>
          </nav>
          <nav aria-label="Company" className="fs-pub__footer-col">
            <p className="fs-pub__footer-heading">Company</p>
            <a href="/#about">About</a>
            <a href="mailto:hello@florasetu.in">Contact</a>
            <Link to="/login">Sign in</Link>
          </nav>
          <nav aria-label="Legal" className="fs-pub__footer-col">
            <p className="fs-pub__footer-heading">Legal</p>
            <Link to="/privacy" data-testid="public-footer-privacy">Privacy Policy</Link>
            <Link to="/terms" data-testid="public-footer-terms">Terms of Use</Link>
          </nav>
        </div>
        <p className="fs-pub__copy" data-testid="public-copyright">
          © 2026 FloraSetu / Thinkvate Solutions Private Limited. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

// Legal/information page layout: readable narrow measure, clear hierarchy.
export function PublicLegalLayout({
  title,
  updated,
  children,
  testId
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <div className="fs-pub" data-testid={testId}>
      <PublicHeader />
      <main className="fs-pub__wrap pub-legal">
        <h1 data-testid={`${testId}-title`}>{title}</h1>
        <p className="pub-legal__updated">Last updated: {updated}</p>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
