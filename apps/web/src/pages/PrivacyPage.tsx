import { PublicLegalLayout, useDocumentTitle } from '../components/PublicChrome';

// Pilot-scope privacy draft (NEEDS LEGAL REVIEW before production/public commercial
// launch — recorded in the release documentation). Describes only what the platform
// actually collects and does today; no invented processors, retention periods,
// certifications or sharing practices.
export function PrivacyPage(): JSX.Element {
  useDocumentTitle('Privacy Policy | FloraSetu');
  return (
    <PublicLegalLayout title="Privacy Policy" updated="16 September 2026" testId="privacy-page">
      <p>
        FloraSetu (&quot;we&quot;, &quot;the platform&quot;) is a business-to-business flower procurement
        and fulfilment network operated by Thinkvate Solutions Private Limited. This policy explains, in
        plain terms, what information the platform handles during the pilot, why, and the choices you have.
      </p>

      <h2>What we collect</h2>
      <h3>Account and business information</h3>
      <p>
        When you register, we store your name, email address, password (only as a cryptographic hash — never
        in plain text), and the organization you belong to (business name, category, addresses and branches
        you provide).
      </p>
      <h3>Business verification (KYB) documents</h3>
      <p>
        Organizations submit verification documents (for example GST or trade-licence documents). These are
        stored privately, are visible only to the submitting organization and authorized verification
        reviewers, and every reviewer access is recorded in a security audit log.
      </p>
      <h3>Transaction and workflow data</h3>
      <p>
        Requirements, offers, orders, lots, shipments, claims, settlements and related records you create
        while using the platform, including photos, videos and notes you upload as evidence.
      </p>
      <h3>Technical and security logs</h3>
      <p>
        We keep audit and security logs of significant actions (who did what, when) to protect accounts,
        investigate misuse and meet our traceability commitments. Authentication attempts are rate-limited
        and lockouts are recorded.
      </p>
      <h3>Communications</h3>
      <p>In-app notifications and, where you contact us directly, the correspondence itself.</p>

      <h2>How we use information</h2>
      <ul>
        <li>Operating the procurement, fulfilment and settlement workflows you use.</li>
        <li>Verifying organizations before they trade.</li>
        <li>Protecting accounts and investigating fraud or misuse.</li>
        <li>Improving reliability and diagnosing errors.</li>
      </ul>
      <p>We do not sell your information. We do not use your business documents for advertising.</p>

      <h2>Who can see what</h2>
      <p>
        Access inside FloraSetu is role-based and organization-scoped: marketplace participants see their
        own organization&apos;s data; platform staff roles see only what their function requires (for
        example, verification reviewers see submitted documents; support staff see claims they triage).
        Evidence and documents are served through short-lived authorized links, not public URLs.
      </p>

      <h2>Storage and security</h2>
      <p>
        Passwords are stored only as bcrypt hashes. Sensitive actions are recorded in immutable audit
        logs. Uploads are validated for type and size. Access to the platform is over HTTPS.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        The application uses browser local storage to keep you signed in and remember your active
        organization. A service worker caches static application files so the app loads faster; it never
        caches your private business data, documents or credentials.
      </p>

      <h2>Retention</h2>
      <p>
        Transaction and audit records are retained to preserve the integrity of the trade record — the
        platform does not rewrite or delete history. Account-level deletion requests are handled through
        the contact route below during the pilot.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>You can review and update your profile and organization details in your account workspace.</li>
        <li>You can sign out at any time; suspended accounts are handled by platform administrators with a recorded reason.</li>
        <li>For access, correction or deletion questions, contact us at <a href="mailto:hello@florasetu.in">hello@florasetu.in</a>.</li>
      </ul>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, the &quot;Last updated&quot; date above will change. Material changes will be
        communicated to registered organizations before they take effect.
      </p>
    </PublicLegalLayout>
  );
}
