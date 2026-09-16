import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from '../components/Logo';
import '../design/public.css';

// Public logged-out homepage (Phase 3 Part B). Authenticated users never see this —
// App routes them through the WorkspaceRouter instead.
const HERO_IMG = 'https://images.unsplash.com/photo-1766682946500-adb9964777e8?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200';
const EVENT_IMG = 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200';
const SUPPLIER_IMG = 'https://images.pexels.com/photos/38552007/pexels-photo-38552007.jpeg?auto=compress&cs=tinysrgb&w=1200';
const EVIDENCE_IMG = 'https://images.pexels.com/photos/17301401/pexels-photo-17301401.jpeg?auto=compress&cs=tinysrgb&w=1200';

const NAV: [string, string][] = [
  ['Buy Flowers', '#audiences'],
  ['For Suppliers', '#suppliers'],
  ['How It Works', '#how-it-works'],
  ['Solutions', '#features'],
  ['About', '#about']
];

const STEPS: [string, string][] = [
  ['Tell us what you need', 'Choose flowers, quantity, required date and delivery location.'],
  ['Receive offers', 'Suitable suppliers respond with quantity, pricing and delivery commitments.'],
  ['Choose your offer', 'Compare price, specification, quantity coverage and delivery.'],
  ['See the actual supply', 'View supplier-declared lot details and actual lot evidence before fulfilment.'],
  ['Track delivery', 'Follow packing, logistics, delivery and receipt.']
];

const FEATURES: [string, string][] = [
  ['Quick flower requests', 'A simple request in about a minute — we handle the sourcing workflow.'],
  ['Comparable offers', 'Price, specification, quantity coverage, delivery and validity side by side.'],
  ['Events & planned demand', 'Ceremonies, delivery milestones and flower lists in one event plan.'],
  ['Actual lot evidence', 'Supplier-declared details with real photos and optional video of the lot.'],
  ['Order & delivery timeline', 'From offer selection to delivery and receipt — one clear timeline.'],
  ['Organization workspaces', 'Teams, roles and permissions for real businesses.']
];

export function PublicHomePage(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="fs-pub" data-testid="public-home">
      <header className="fs-pub__header">
        <div className="fs-pub__wrap fs-pub__header-in">
          <Logo variant="horizontal" testId="public-logo" />
          <nav className="fs-pub__nav" aria-label="Primary">
            {NAV.map(([label, href]) => <a key={href} href={href} data-testid={`public-nav-${label.toLowerCase().replace(/ /g, '-')}`}>{label}</a>)}
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
          {NAV.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          <Link to="/login" onClick={() => setMenuOpen(false)}>Sign in</Link>
        </nav>
      </header>

      <main>
        <section className="fs-pub__wrap fs-pub__hero">
          <div>
            <p className="fs-pub__eyebrow" data-testid="public-hero-eyebrow">A smarter flower trade starts here</p>
            <h1 data-testid="public-hero-headline">Source premium flowers with more confidence.</h1>
            <p className="pub-lede">
              FloraSetu connects professional buyers with verified growers, wholesalers, importers and
              fulfilment partners — from request and offers to actual lot visibility, logistics and delivery.
            </p>
            <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }}>
              <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-hero-cta">Get started</Link>
              <a href="#how-it-works" className="pub-btn pub-btn--ghost" data-testid="public-hero-secondary">See how FloraSetu works</a>
            </div>
            <p className="fs-pub__supporting">
              Built for florists, event planners, hotels, wholesalers, growers and professional flower businesses.
            </p>
          </div>
          <div className="fs-pub__hero-img">
            <img src={HERO_IMG} alt="Premium roses ready for the wholesale flower trade" loading="eager" />
          </div>
        </section>

        <section className="fs-pub__strip" aria-label="Why FloraSetu">
          <div className="fs-pub__wrap fs-pub__strip-grid">
            <div>
              <h3>Verified business network</h3>
              <p>Trade with verified organizations and authorized users.</p>
            </div>
            <div>
              <h3>Clear flower specifications</h3>
              <p>Keep variety, quantity, grade/specification, pack and delivery needs structured.</p>
            </div>
            <div>
              <h3>Actual lot visibility</h3>
              <p>See supplier-submitted photos, lot details and fulfilment evidence.</p>
            </div>
            <div>
              <h3>Delivery clarity</h3>
              <p>Follow pickup, dispatch, transit and delivery status.</p>
            </div>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section" id="how-it-works">
          <h2>How FloraSetu works</h2>
          <p className="pub-sub">Five simple steps from requirement to receipt.</p>
          <ol className="pub-steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className="pub-step-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 'var(--fs-space-8)' }}>
            <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-how-cta">Get flowers</Link>
          </div>
        </section>

        <section className="fs-pub__section fs-pub__section--alt" id="audiences">
          <div className="fs-pub__wrap">
            <h2>One network. Different jobs.</h2>
            <p className="pub-sub">Buyers, suppliers and logistics partners each get a workspace built for their work.</p>
            <div className="pub-cards-3">
              <article>
                <p className="pub-aud-label">BUYERS</p>
                <h3>Source with less uncertainty.</h3>
                <p>For florists, event planners, hotels, wholesalers and professional buyers.</p>
                <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-buyers">Find flowers</Link>
              </article>
              <article id="suppliers">
                <p className="pub-aud-label">SUPPLIERS</p>
                <h3>Turn available flowers into reliable business.</h3>
                <p>For growers, wholesalers and importers.</p>
                <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-suppliers">Join as a supplier</Link>
              </article>
              <article>
                <p className="pub-aud-label">LOGISTICS PARTNERS</p>
                <h3>Connect flower supply to its destination.</h3>
                <p>Support pickup, transport, parcel movement and proof of delivery.</p>
                <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-logistics">Partner with FloraSetu</Link>
              </article>
            </div>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section" id="features">
          <h2>Built for real flower trade — not just listings.</h2>
          <p className="pub-sub">The workflows a professional flower business actually runs, end to end.</p>
          <div className="pub-cards-6">
            {FEATURES.map(([title, body]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fs-pub__section fs-pub__section--alt" id="about">
          <div className="fs-pub__wrap">
            <h2>Built for businesses, not casual flower shopping.</h2>
            <p className="pub-sub">
              FloraSetu is designed around organizations, teams and commercial workflows. Buyers, suppliers
              and partners work through verified business profiles, role-based access and traceable
              transactions — while the experience stays simple for the person doing the work.
            </p>
            <ul className="pub-checks">
              <li>Organization-based accounts</li>
              <li>Role-based permissions</li>
              <li>Traceable commercial actions</li>
            </ul>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section">
          <div className="pub-split">
            <div>
              <h2>Planning flowers for an event?</h2>
              <p className="pub-sub" style={{ marginBottom: 'var(--fs-space-5)' }}>
                Start with the event — not the paperwork. Create your event, add flower requirements by
                ceremony or delivery milestone, and let FloraSetu organize the sourcing workflow behind
                the scenes.
              </p>
              <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-event-cta">Plan an event</Link>
            </div>
            <img src={EVENT_IMG} alt="Elegant wedding ceremony flower arrangements" loading="lazy" />
          </div>
        </section>

        <section className="fs-pub__section fs-pub__section--alt">
          <div className="fs-pub__wrap pub-split">
            <img src={SUPPLIER_IMG} alt="Workers sorting fresh roses at a flower facility" loading="lazy" />
            <div>
              <h2>More relevant demand. Less chasing.</h2>
              <p className="pub-sub" style={{ marginBottom: 'var(--fs-space-5)' }}>
                Receive structured buyer requirements, send offers, share actual lot evidence, fulfil
                orders and follow payout status from one workspace.
              </p>
              <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-supplier-cta">Join as a supplier</Link>
            </div>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section">
          <div className="pub-split">
            <div>
              <h2>See the flowers being supplied — not just a catalogue image.</h2>
              <p className="pub-sub" style={{ marginBottom: 0 }}>
                FloraSetu links supplier-declared lot details, actual photos, optional video, packing
                evidence and delivery records to the order so buyers have clearer visibility throughout
                fulfilment.
              </p>
            </div>
            <img src={EVIDENCE_IMG} alt="Fresh roses packed in containers ready for dispatch" loading="lazy" />
          </div>
        </section>

        <section className="fs-pub__section fs-pub__final">
          <div className="fs-pub__wrap">
            <h2>Ready for a better way to trade flowers?</h2>
            <p>
              Join FloraSetu&apos;s pilot network and help build a more connected, reliable and
              transparent professional flower trade.
            </p>
            <div style={{ display: 'flex', gap: 'var(--fs-space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/register" className="pub-btn pub-btn--light" data-testid="public-final-cta">Join FloraSetu</Link>
              <a href="mailto:hello@florasetu.in" className="pub-btn pub-btn--ghost" style={{ borderColor: '#fff', color: '#fff' }} data-testid="public-contact-cta">Talk to our team</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="fs-pub__footer">
        <div className="fs-pub__wrap">
          <div className="fs-pub__footer-grid">
            <div>
              <Logo variant="horizontal" testId="public-footer-logo" />
              <p className="fs-pub__tagline">Premium Flower Exchange &amp; Fulfilment Network</p>
            </div>
            <nav aria-label="Footer">
              <Link to="/register">For Buyers</Link>
              <Link to="/register">For Suppliers</Link>
              <Link to="/register">Logistics Partners</Link>
              <a href="#how-it-works">How It Works</a>
              <a href="#about">About</a>
              <a href="mailto:hello@florasetu.in">Contact</a>
              <Link to="/login">Privacy</Link>
              <Link to="/login">Terms</Link>
            </nav>
          </div>
          <p className="fs-pub__copy" data-testid="public-copyright">
            © 2026 FloraSetu / Thinkvate Solutions Private Limited. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
