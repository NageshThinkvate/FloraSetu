import { Link } from 'react-router-dom';
import {
  ShieldCheck, ClipboardList, Camera, Truck,
  Zap, ArrowLeftRight, CalendarRange, Images, Route, Building2,
  ArrowRight, Play, Check
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PublicHeader, PublicFooter, useDocumentTitle } from '../components/PublicChrome';
import '../design/public.css';

// Public logged-out homepage (Phase 3 Part B; brand board 2026-09 restyle). Authenticated
// users never see this — App routes them through the WorkspaceRouter instead.
const HERO_IMG = 'https://images.pexels.com/photos/38909719/pexels-photo-38909719.jpeg?auto=compress&cs=tinysrgb';
const BAND_IMG = 'https://images.pexels.com/photos/13256146/pexels-photo-13256146.jpeg?auto=compress&cs=tinysrgb';
const BUYERS_IMG = 'https://images.pexels.com/photos/7156456/pexels-photo-7156456.jpeg?auto=compress&cs=tinysrgb';
const SUPPLIERS_IMG = 'https://images.unsplash.com/photo-1629730538660-2d5d2a0c8e98?crop=entropy&cs=srgb&fm=jpg&q=85';
const LOGISTICS_IMG = 'https://images.pexels.com/photos/17301401/pexels-photo-17301401.jpeg?auto=compress&cs=tinysrgb';
const EVENT_IMG = 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?crop=entropy&cs=srgb&fm=jpg&q=85';
const SUPPLIER_IMG = 'https://images.pexels.com/photos/38552007/pexels-photo-38552007.jpeg?auto=compress&cs=tinysrgb';
const LOT_IMG = 'https://images.unsplash.com/photo-1623500139994-7c8ebf254a80?crop=entropy&cs=srgb&fm=jpg&q=85';
const srcset = (base: string): string =>
  `${base}&w=640 640w, ${base}&w=1200 1200w, ${base}&w=1800 1800w`;

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
          <div className="fs-pub__hero-img">
            <img
              src={`${HERO_IMG}&w=1200`}
              srcSet={srcset(HERO_IMG)}
              sizes="(max-width: 900px) 100vw, 42vw"
              width="1200"
              height="1500"
              alt="Elegant white lilies — premium cut flowers for the professional trade"
              loading="eager"
              {...{ fetchpriority: 'high' }}
            />
          </div>
          <p className="fs-pub__hero-words" aria-hidden="true" data-testid="public-hero-words">
            <span>People</span>
            <span>Flowers</span>
            <span>Progress</span>
            <span>Together</span>
          </p>
        </section>

        <section className="fs-pub__strip" aria-label="Why FloraSetu">
          <div className="fs-pub__wrap fs-pub__strip-grid">
            {STRIP.map(([Icon, title, body]) => (
              <div key={title}>
                <span className="pub-strip-ico" aria-hidden="true"><Icon size={20} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
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
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 'var(--fs-space-8)' }}>
            <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-how-cta">
              Get flowers <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="fs-pub__section fs-pub__section--alt" id="audiences">
          <div className="fs-pub__wrap">
            <h2>One network. Different jobs.</h2>
            <p className="pub-sub">Buyers, suppliers and logistics partners each get a workspace built for their work.</p>
            <div className="pub-cards-3">
              <article>
                <img className="pub-card-img" src={`${BUYERS_IMG}&w=800`} alt="Florists selecting fresh flowers for their buyers" loading="lazy" />
                <div className="pub-card-body">
                  <p className="pub-aud-label">BUYERS</p>
                  <h3>Source with less uncertainty.</h3>
                  <p>For florists, event planners, hotels, wholesalers and professional buyers.</p>
                  <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-buyers">Find flowers</Link>
                </div>
              </article>
              <article id="suppliers">
                <img className="pub-card-img" src={`${SUPPLIERS_IMG}&w=800`} alt="Rows of fresh cut flowers growing under a greenhouse roof" loading="lazy" />
                <div className="pub-card-body">
                  <p className="pub-aud-label">SUPPLIERS</p>
                  <h3>Turn available flowers into reliable business.</h3>
                  <p>For growers, wholesalers and importers.</p>
                  <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-suppliers">Join as a supplier</Link>
                </div>
              </article>
              <article>
                <img className="pub-card-img" src={`${LOGISTICS_IMG}&w=800`} alt="Fresh roses packed and ready for dispatch" loading="lazy" />
                <div className="pub-card-body">
                  <p className="pub-aud-label">LOGISTICS PARTNERS</p>
                  <h3>Connect flower supply to its destination.</h3>
                  <p>Support pickup, transport, parcel movement and proof of delivery.</p>
                  <Link to="/register" className="pub-btn pub-btn--primary" data-testid="public-audience-logistics">Partner with FloraSetu</Link>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="fs-pub__wrap fs-pub__section" id="features">
          <h2>Built for real flower trade — not just listings.</h2>
          <p className="pub-sub">The workflows a professional flower business actually runs, end to end.</p>
          <div className="pub-cards-6">
            {FEATURES.map(([Icon, title, body]) => (
              <article key={title}>
                <span className="pub-feat-ico" aria-hidden="true"><Icon size={19} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fs-pub__section pub-orgband" id="about">
          <div className="fs-pub__wrap pub-split">
            <div>
              <h2>Built for businesses, not casual flower shopping.</h2>
              <p className="pub-sub">
                FloraSetu is designed around organizations, teams and commercial workflows. Buyers, suppliers
                and partners work through verified business profiles, role-based access and traceable
                transactions — while the experience stays simple for the person doing the work.
              </p>
              <ul className="pub-checks">
                <li><span className="pub-check" aria-hidden="true"><Check size={13} /></span>Organization-based accounts</li>
                <li><span className="pub-check" aria-hidden="true"><Check size={13} /></span>Role-based permissions</li>
                <li><span className="pub-check" aria-hidden="true"><Check size={13} /></span>Traceable commercial actions</li>
              </ul>
            </div>
            <img
              src={`${BAND_IMG}&w=1200`}
              srcSet={srcset(BAND_IMG)}
              sizes="(max-width: 900px) 100vw, 45vw"
              width="1200"
              height="800"
              alt="White lilies against a dark botanical backdrop"
              loading="lazy"
            />
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
              src={`${EVENT_IMG}&w=1200`}
              srcSet={srcset(EVENT_IMG)}
              sizes="(max-width: 900px) 100vw, 50vw"
              width="1200"
              height="900"
              alt="Elegant wedding ceremony flower arrangements"
              loading="lazy"
            />
          </div>
        </section>

        <section className="fs-pub__section fs-pub__section--alt">
          <div className="fs-pub__wrap pub-split">
            <img
              src={`${SUPPLIER_IMG}&w=1200`}
              srcSet={srcset(SUPPLIER_IMG)}
              sizes="(max-width: 900px) 100vw, 50vw"
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
              src={`${LOT_IMG}&w=1200`}
              srcSet={srcset(LOT_IMG)}
              sizes="(max-width: 900px) 100vw, 50vw"
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
              <a href="mailto:hello@florasetu.in" className="pub-btn pub-btn--ghost" style={{ borderColor: '#fff', color: '#fff' }} data-testid="public-contact-cta">Talk to our team</a>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
