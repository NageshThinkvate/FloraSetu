import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiPost } from '../lib/api/client';
import { AuthLayout } from '../components/AuthLayout';
import { useDocumentTitle } from '../components/PublicChrome';

export function ResetPasswordPage(): JSX.Element {
  useDocumentTitle('Reset password | FloraSetu');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That reset link could not be used. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" testId="reset-password-page">
      {done ? (
        <div data-testid="reset-done">
          <p className="pub-auth__hint">Password updated successfully. You can now sign in with your new password.</p>
          <Link to="/login" className="pub-btn pub-btn--primary pub-auth__submit" data-testid="reset-to-login">Sign in</Link>
        </div>
      ) : !token ? (
        <div data-testid="reset-no-token">
          <p className="pub-auth__error" role="alert">This reset link is missing its token. Request a new reset link.</p>
          <p className="pub-auth__switch"><Link to="/forgot-password" data-testid="reset-request-new">Request a new reset link</Link></p>
        </div>
      ) : (
        <form className="pub-auth__form" onSubmit={submit} data-testid="reset-form">
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              className="fs-input"
              data-testid="reset-password"
              type={show ? 'text' : 'password'}
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="pub-auth__hint">At least 10 characters, with letters and numbers.</p>
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              className="fs-input"
              data-testid="reset-confirm"
              type={show ? 'text' : 'password'}
              required
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="pub-auth__aux"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            data-testid="reset-toggle-show"
            onClick={() => setShow((v) => !v)}
          >
            {show ? 'Hide password' : 'Show password'}
          </button>
          {error && <p className="pub-auth__error" role="alert" data-testid="reset-error">{error}</p>}
          <button type="submit" className="pub-btn pub-btn--primary pub-auth__submit" disabled={busy} data-testid="reset-submit">
            {busy ? 'Updating…' : 'Update password'}
          </button>
          <p className="pub-auth__switch"><Link to="/login" data-testid="reset-back-login">← Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
