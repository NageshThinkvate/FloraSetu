import { Link } from 'react-router-dom';
import {
  ShieldCheck, ClipboardList, Camera, Truck,
  Zap, ArrowLeftRight, CalendarRange, Images, Route, Building2,
  ArrowRight, Play, BadgeCheck,
  Store, Leaf, Handshake
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PublicHeader, PublicFooter, useDocumentTitle } from '../components/PublicChrome';
import '../design/public.css';
import heroLilies from '../assets/hero-lilies.jpg';
import gerberas from '../assets/gerberas.jpg';
import greenhouse from '../assets/greenhouse.jpg';
import orchids from '../assets/orchids.jpg';

// Public logged-out homepage — approved design-system restyle (reference codebase 2026-09).
// White-background botanical photography blends into the ivory page via mix-blend-multiply
// + gradient masks; copy and data-testids preserved. Authenticated users never see this —
// App routes them through the WorkspaceRouter instead.
const EVENT_IMG = '/images/event-flowers.jpg';
const SUPPLIER_IMG = '/images/supplier-facility.jpg';
const LOT_IMG = '/images/lot-evidence.jpg';

const STRIP: [LucideIcon, string, string][] = [
  [ShieldCheck, 'Verified business network', 'Trade with verified organizations and authorized users.'],
  [ClipboardList, 'Clear flower specifications', 'Keep variety, quantity, grade/specification, pack and delivery needs structured.'],
  [Camera, 'Actual lot visibility', 'See supplier-submitted photos, lot details and fulfilment evidence.'],
  [Truck, 'Delivery clarity', 'Follow pickup, dispatch, transit and delivery status.']
];

const STEPS: [string, string][] = [
  ['Tell us what you need', 'Choose flowers, quantity, required date and delivery location.'],
  ['Receive offers', 'Suitable suppliers respond with quantity, pricing and delivery commitments.'],
  ['Choose your offer', 'Compare price, specification, quantity coverage and delivery.'],
  ['See the actual supply', 'View supplier-declared lot details and actual lot evidence before fulfilment.'],
  ['Track delivery', 'Follow packing, logistics, delivery and receipt.']
];

const SOLUTIONS: [LucideIcon, string, string, string, string, string, string][] = [
  [Store, 'BUYERS', 'Source with less uncertainty.', 'For florists, event planners, hotels, wholesalers and professional buyers.', 'Find flowers', gerberas, 'Blush and cream gerbera daisies'],
  [Leaf, 'SUPPLIERS', 'Turn available flowers into reliable business.', 'For growers, wholesalers and importers.', 'Join as a supplier', greenhouse, 'Bright greenhouse aisle filled with blooms'],
  [Handshake, 'LOGISTICS PARTNERS', 'Connect flower supply to its destination.', 'Support pickup, transport, parcel movement and proof of delivery.', 'Partner with FloraSetu', orchids, 'White and lilac orchid stems']
];

const FEATURES: [LucideIcon, string, string][] = [
  [Zap, 'Quick flower requests', 'A simple request in about a minute — we handle the sourcing workflow.'],
  [ArrowLeftRight, 'Comparable offers', 'Price, specification, quantity coverage, delivery and validity side by side.'],
  [CalendarRange, 'Events & planned demand', 'Ceremonies, delivery milestones and flower lists in one event plan.'],
  [Images, 'Actual lot evidence', 'Supplier-declared details with real photos and optional video of the lot.'],
  [Route, 'Order & delivery timeline', 'From offer selection to delivery and receipt — one clear timeline.'],
  [Building2, 'Organization workspaces', 'Teams, roles and permissions for real businesses.']
];

export function PublicHomePage(): JSX.Element {
  useDocumentTitle('FloraSetu | Premium Flower Procurement & Fulfilment Network');
  return (
    <div className="fs-pub" data-testid="public-home">
      <PublicHeader />

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
              <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-hero-cta">
                Get started <ArrowRight size={16} />
              </Link>
              <a href="#how-it-works" className="pub-btn pub-btn--ghost" data-testid="public-hero-secondary">
                <Play size={15} /> See how FloraSetu works
              </a>
            </div>
            <p className="fs-pub__supporting">
              Built for florists, event planners, hotels, wholesalers, growers and professional flower businesses.
            </p>
          </div>
          <div className="fs-pub__hero-visual">
            <img
              className="fs-pub__hero-img"
              src={heroLilies}
              width={1408}
              height={1200}
              alt="White lilies with fresh green foliage"
              loading="eager"
              {...{ fetchpriority: 'high' }}
            />
            <p className="fs-pub__hero-words" aria-hidden="true" data-testid="public-hero-words">
              <span>People</span>
              <span>Flowers</span>
              <span>Progress</span>
              <span>Together</span>
            </p>
          </div>
        </section>

        <section className="fs-pub__strip" aria-label="Why FloraSetu">
          <div className="fs-pub__wrap fs-pub__strip-grid">
            {STRIP.map(([Icon, title, body]) => (
              <div key={title}>
                <span className="pub-strip-ico" aria-hidden="true"><Icon size={18} /></span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section" id="how-it-works">
          <h2>How FloraSetu works</h2>
          <p className="pub-sub">Five simple steps from requirement to receipt.</p>
          <ol className="pub-steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className="pub-step-no">{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 'var(--fs-space-6)' }}>
            <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-how-cta">
              Get flowers <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="fs-pub__section" id="audiences">
          <div className="fs-pub__wrap">
            <div className="fs-pub__section-head">
              <h2>One network. Different jobs.</h2>
              <p className="pub-sub">Buyers, suppliers and logistics partners each get a workspace built for their work.</p>
            </div>
            <div className="pub-cards-3">
              {SOLUTIONS.map(([Icon, label, title, body, cta, image, alt], i) => (
                <article key={label} {...(i === 1 ? { id: 'suppliers' } : {})}>
                  <img className="pub-card-img" src={image} alt={alt} loading="lazy" />
                  <div className="pub-card-body">
                    <span className="pub-card-ico" aria-hidden="true"><Icon size={16} /></span>
                    <p className="pub-aud-label">{label}</p>
                    <h3>{title}</h3>
                    <p>{body}</p>
                    <Link
                      to="/register"
                      className="pub-cta-link"
                      data-testid={i === 0 ? 'public-audience-buyers' : i === 1 ? 'public-audience-suppliers' : 'public-audience-logistics'}
                    >
                      {cta} <ArrowRight size={14} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section" id="features">
          <div className="fs-pub__section-head">
            <h2>Built for real flower trade — not just listings.</h2>
            <p className="pub-sub">The workflows a professional flower business actually runs, end to end.</p>
          </div>
          <div className="pub-cards-6">
            {FEATURES.map(([Icon, title, body]) => (
              <article key={title}>
                <span className="pub-feat-ico" aria-hidden="true"><Icon size={16} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fs-pub__section pub-orgband" id="about">
          <div className="fs-pub__wrap pub-split" style={{ gridTemplateColumns: '1.2fr 0.8fr' }}>
            <div>
              <h2>Built for businesses, not casual flower shopping.</h2>
              <p className="pub-sub">
                FloraSetu is designed around organizations, teams and commercial workflows. Buyers, suppliers
                and partners work through verified business profiles, role-based access and traceable
                transactions — while the experience stays simple for the person doing the work.
              </p>
              <ul className="pub-checks">
                <li><span className="pub-check" aria-hidden="true"><BadgeCheck size={16} /></span>Organization-based accounts</li>
                <li><span className="pub-check" aria-hidden="true"><BadgeCheck size={16} /></span>Role-based permissions</li>
                <li><span className="pub-check" aria-hidden="true"><BadgeCheck size={16} /></span>Traceable commercial actions</li>
              </ul>
            </div>
            <p className="pub-orgband__words" aria-hidden="true" style={{ textAlign: 'right' }}>
              Bigger<br />Blooms<br />Brighter<br />Business
            </p>
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
            <img
              src={EVENT_IMG}
              width="1200"
              height="900"
              alt="Elegant wedding ceremony flower arrangements"
              loading="lazy"
            />
          </div>
        </section>

        <section className="fs-pub__section" style={{ background: '#fff', borderTop: '1px solid var(--pub-line)', borderBottom: '1px solid var(--pub-line)' }}>
          <div className="fs-pub__wrap pub-split">
            <img
              src={SUPPLIER_IMG}
              width="1200"
              height="900"
              alt="Workers sorting fresh roses at a flower facility"
              loading="lazy"
            />
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
            <img
              src={LOT_IMG}
              width="1200"
              height="900"
              alt="Fresh market flowers packed on a wooden crate"
              loading="lazy"
            />
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
              <a href="mailto:hello@florasetu.in" className="pub-btn pub-btn--ghost" style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }} data-testid="public-contact-cta">Talk to our team</a>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
