import { PublicLegalLayout, useDocumentTitle } from '../components/PublicChrome';

// Pilot-scope terms draft (NEEDS LEGAL REVIEW before production/public commercial launch —
// recorded in the release documentation). Honest to current platform behavior: FloraSetu
// is a technology/procurement/fulfilment network — it does NOT operate transport, own
// vehicles/drivers/warehouses/farms, and makes no refund or outcome guarantees.
export function TermsPage(): JSX.Element {
  useDocumentTitle('Terms of Use | FloraSetu');
  return (
    <PublicLegalLayout title="Terms of Use" updated="16 September 2026" testId="terms-page">
      <p>
        These terms govern use of the FloraSetu platform during its pilot. FloraSetu is a
        business-to-business technology platform operated by Thinkvate Solutions Private Limited that
        connects professional flower buyers with verified supply partners and independent logistics
        partners. By creating an account you agree to these terms.
      </p>

      <h2>What FloraSetu is — and is not</h2>
      <ul>
        <li>FloraSetu provides structured sourcing, ordering, evidence, fulfilment-visibility and settlement-record workflows.</li>
        <li>Suppliers are independent businesses responsible for the flowers they offer and supply.</li>
        <li>Logistics are performed by independent logistics partners. FloraSetu does not operate transport and does not own vehicles, drivers, warehouses or farms.</li>
        <li>FloraSetu does not physically inspect flowers. Quality-relevant information on the platform consists of supplier declarations, actual-lot evidence, handling requirements, delivery/POD evidence and the buyer acceptance/claims workflow.</li>
      </ul>

      <h2>Accounts and organizations</h2>
      <ul>
        <li>You must provide accurate account and business information and keep credentials confidential.</li>
        <li>Organizations complete business verification (KYB) before trading. Verification decisions are recorded and may be revisited if information changes.</li>
        <li>Platform administrators may suspend organizations or users for documented reasons (for example fraud investigation). Suspension preserves records; it does not erase history.</li>
      </ul>

      <h2>Orders, payment and settlement records</h2>
      <ul>
        <li>Commercial terms for an order are those shown in the accepted offer and order record.</li>
        <li>Payment and settlement entries on the platform are records of external money movement (for example bank transfer or UPI references). FloraSetu is not a payment gateway and does not hold buyer or supplier funds in escrow.</li>
        <li>Financial records are protected by dual-control workflows; settled records are not silently edited. Corrections happen through new, recorded adjustments.</li>
      </ul>

      <h2>Claims</h2>
      <p>
        Buyers may raise issues on delivered orders with evidence. Claims follow a structured review
        workflow. Outcomes are recorded with reasons; financial consequences are applied through the
        platform&apos;s controlled adjustment records.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No unlawful, fraudulent or misleading activity.</li>
        <li>No attempts to access another organization&apos;s data or to bypass role permissions.</li>
        <li>No uploading of malicious files or content you have no right to share.</li>
      </ul>

      <h2>Availability and liability</h2>
      <p>
        The platform is provided during the pilot on a best-effort basis. To the extent permitted by law,
        FloraSetu is not liable for indirect losses, for the quality of goods supplied by independent
        suppliers, or for transport performed by independent logistics partners. Nothing in these terms
        excludes liability that cannot be excluded by law.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the platform evolves; the &quot;Last updated&quot; date will change and
        material changes will be communicated to registered organizations.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:hello@florasetu.in">hello@florasetu.in</a>.
      </p>
    </PublicLegalLayout>
  );
}
