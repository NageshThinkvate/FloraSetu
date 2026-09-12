interface ModuleInfo {
  key: string;
  name: string;
  blurb: string;
}

const MODULES: ModuleInfo[] = [
  { key: 'identity-party', name: 'Identity & Party', blurb: 'Orgs, users, RBAC, KYC, bank accounts with reverification freeze (ADR-004).' },
  { key: 'catalog-standards', name: 'Catalog & Standards', blurb: 'Commodity hierarchy, canonical units, versioned grade standards.' },
  { key: 'supply-inventory', name: 'Supply & Inventory', blurb: 'Lots with DB-enforced available/reserved/allocated — never oversell (ADR-001).' },
  { key: 'demand-rfq', name: 'Demand / RFQ', blurb: 'Demand intents, procurement events, multi-supplier RFQ awards.' },
  { key: 'auction-market', name: 'Auction & Market', blurb: 'Auction lots, immutable bids and results, price snapshots.' },
  { key: 'order-allocation', name: 'Order & Allocation', blurb: 'Orders, row-locked lot allocations, immutable status history.' },
  { key: 'quality-traceability', name: 'Quality & Traceability', blurb: 'QC results, certificates, lot genealogy, chain of custody.' },
  { key: 'logistics-coldchain', name: 'Logistics & Cold Chain', blurb: 'Shipments, temperature excursions with HOLD gating (ADR-002).' },
  { key: 'payments-settlement', name: 'Payments & Settlement', blurb: 'Invoices, immutable settlements, irreversible payouts (ADR-003/004).' },
  { key: 'claims-support', name: 'Claims & Support', blurb: 'Post-settlement claims, evidence, decisions, tickets.' },
  { key: 'notifications', name: 'Notifications', blurb: 'Versioned templates, web push now, FCM/APNs later (ADR-006).' },
  { key: 'analytics-controltower', name: 'Analytics & Control Tower', blurb: 'KPI definitions, snapshots, control-tower alerts.' }
];

export function ModuleNavigator(): JSX.Element {
  return (
    <section className="module-grid" data-testid="module-navigator">
      {MODULES.map((m) => (
        <article key={m.key} className="module-tile" data-testid={`module-tile-${m.key}`}>
          <h2>{m.name}</h2>
          <p>{m.blurb}</p>
          <span className="state-chip frozen">Schema frozen · UI inactive</span>
        </article>
      ))}
    </section>
  );
}
