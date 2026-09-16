import { Link } from 'react-router-dom';
import { Logo } from './Logo';

// Shared auth/recovery layout (owner ruling): corrected logo that links to /, an explicit
// Back-to-home control, and brand continuity with the public site — without becoming a
// marketing page. Auth logic is untouched.
export function AuthLayout({
  title,
  children,
  testId
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <main className="fs-pub pub-auth" data-testid={testId}>
      <div className="pub-auth__top">
        <Link to="/" aria-label="FloraSetu home" className="pub-auth__logo" data-testid="auth-logo">
          <Logo variant="horizontal" size={44} testId="auth-logo-img" />
        </Link>
        <Link to="/" className="pub-auth__back" data-testid="auth-back-home">← Back to home</Link>
      </div>
      <div className="pub-auth__card" data-testid={`${testId}-card`}>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
