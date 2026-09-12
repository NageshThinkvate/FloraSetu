interface ModuleInfo {
  key: string;
  name: string;
  blurb: string;
  status: 'live' | 'planned';
}

const MODULES: ModuleInfo[] = [
  { key: 'identity-party', name: 'Identity & Party', blurb: 'Orgs, users, RBAC, KYB, MFA, bank accounts with reverification freeze (ADR-004).', status: 'live' },
  { key: 'catalog-standards', name: 'Catalog & Standards', blurb: 'Commodity hierarchy, canonical units, versioned grade standards, validation lifecycle.', status: 'live' },
  { key: 'demand-rfq', name: 'Demand / RFQ', blurb: 'Quick requests, events, RFQs, immutable quotes, multi-supplier awards.', status: 'live' },
  { key: 'supply-inventory', name: 'Supply & Inventory', blurb: 'Lots with DB-enforced available/reserved/allocated — never oversell (ADR-001).', status: 'live' },
  { key: 'auction-market', name: 'Auction & Market', blurb: 'Auction lots, immutable bids and results, price snapshots.', status: 'planned' },
  { key: 'order-allocation', name: 'Order & Allocation', blurb: 'Orders, row-locked lot allocations, immutable status history.', status: 'live' },
  { key: 'quality-traceability', name: 'Quality & Traceability', blurb: 'QC results, certificates, lot genealogy, chain of custody.', status: 'live' },
  { key: 'logistics-coldchain', name: 'Logistics & Cold Chain', blurb: 'Shipments, temperature excursions with HOLD gating (ADR-002).', status: 'live' },
  { key: 'payments-settlement', name: 'Payments & Settlement', blurb: 'Manual external payment/settlement records, immutable once complete (ADR-003/004).', status: 'live' },
  { key: 'claims-support', name: 'Claims & Support', blurb: 'Post-delivery claims, evidence, decisions, adjustments.', status: 'live' },
  { key: 'notifications', name: 'Notifications', blurb: 'Versioned templates, web push now, FCM/APNs later (ADR-006).', status: 'planned' },
  { key: 'analytics-controltower', name: 'Analytics & Control Tower', blurb: 'Pilot control-tower exception queues across all contexts.', status: 'live' }
];

export function ModuleNavigator(): JSX.Element {
  return (
    <section className="module-grid" data-testid="module-navigator">
      {MODULES.map((m) => (
        <article key={m.key} className="module-tile" data-testid={`module-tile-${m.key}`}>
          <h2>{m.name}</h2>
          <p>{m.blurb}</p>
          <span className={m.status === 'live' ? 'state-chip frozen' : 'state-chip'}>
            {m.status === 'live' ? 'Live' : 'Schema frozen · UI inactive'}
          </span>
        </article>
      ))}
    </section>
  );
}
