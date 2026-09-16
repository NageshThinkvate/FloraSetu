import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { useDocumentTitle } from '../components/PublicChrome';

export function RegisterPage(): JSX.Element {
  useDocumentTitle('Create account | FloraSetu');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await register(email, password, displayName);
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create account" testId="register-page">
      <form className="pub-auth__form" onSubmit={submit} data-testid="register-form">
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="register-name">Full name</label>
          <input id="register-name" className="fs-input" data-testid="register-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="register-email">Email</label>
          <input id="register-email" className="fs-input" data-testid="register-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="register-password">Password</label>
          <input id="register-password" className="fs-input" data-testid="register-password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="pub-auth__hint">At least 10 characters, with letters and numbers.</p>
        </div>
        {error && <p className="pub-auth__error" role="alert" data-testid="register-error">{error}</p>}
        <button type="submit" className="pub-btn pub-btn--primary pub-auth__submit" disabled={busy} data-testid="register-submit">
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="pub-auth__switch">Already have an account? <Link to="/login" data-testid="register-to-login">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
