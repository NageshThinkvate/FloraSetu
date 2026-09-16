import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';
import { AuthLayout } from '../components/AuthLayout';
import { useDocumentTitle } from '../components/PublicChrome';

export function LoginPage(): JSX.Element {
  useDocumentTitle('Sign in | FloraSetu');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email, password, mfaCode || undefined);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setError('Enter the code from your authenticator app.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" testId="login-page">
      <form className="pub-auth__form" onSubmit={submit} data-testid="login-form">
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="login-email">Email</label>
          <input id="login-email" className="fs-input" data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="login-password">Password</label>
          <input id="login-password" className="fs-input" data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Link to="/forgot-password" className="pub-auth__aux" data-testid="login-forgot">Forgot password?</Link>
        </div>
        {mfaRequired && (
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="login-mfa">MFA code</label>
            <input id="login-mfa" className="fs-input" data-testid="login-mfa" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
          </div>
        )}
        {error && <p className="pub-auth__error" role="alert" data-testid="login-error">{error}</p>}
        <button type="submit" className="pub-btn pub-btn--primary pub-auth__submit" disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="pub-auth__switch">Don&apos;t have an account? <Link to="/register" data-testid="login-to-register">Create account</Link></p>
      </form>
    </AuthLayout>
  );
}
