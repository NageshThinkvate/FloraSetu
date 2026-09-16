import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../lib/api/client';
import { ApiError } from '../lib/api/client';
import { AuthLayout } from '../components/AuthLayout';
import { useDocumentTitle } from '../components/PublicChrome';

// Anti-enumeration: the backend always answers neutrally; this page mirrors that —
// known and unknown emails produce the identical message.
export function ForgotPasswordPage(): JSX.Element {
  useDocumentTitle('Forgot password | FloraSetu');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await apiPost('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else {
        setError("We couldn't process that right now. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Forgot your password?" testId="forgot-password-page">
      {sent ? (
        <div data-testid="forgot-sent">
          <p className="pub-auth__hint">
            If an account exists for <strong>{email}</strong>, password-reset instructions have been sent.
            The link expires after 60 minutes.
          </p>
          <p className="pub-auth__switch">
            <Link to="/login" data-testid="forgot-back-login">← Back to sign in</Link>
          </p>
        </div>
      ) : (
        <form className="pub-auth__form" onSubmit={submit} data-testid="forgot-form">
          <p className="pub-auth__hint">
            Enter the email address associated with your FloraSetu account and we&apos;ll send you a
            password-reset link.
          </p>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="forgot-email">Email address</label>
            <input
              id="forgot-email"
              className="fs-input"
              data-testid="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && <p className="pub-auth__error" role="alert" data-testid="forgot-error">{error}</p>}
          <button type="submit" className="pub-btn pub-btn--primary pub-auth__submit" disabled={busy} data-testid="forgot-submit">
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="pub-auth__switch">
            <Link to="/login" data-testid="forgot-back-login">← Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
