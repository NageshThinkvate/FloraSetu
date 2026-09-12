import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password, mfaCode || undefined);
      navigate('/account');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setError('Enter the code from your authenticator app.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    }
  };

  return (
    <main className="auth-shell" data-testid="login-page">
      <form className="auth-card" onSubmit={submit} data-testid="login-form">
        <h1>Sign in</h1>
        <label>
          Email
          <input data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mfaRequired && (
          <label>
            MFA code
            <input data-testid="login-mfa" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
          </label>
        )}
        {error && <p className="form-error" data-testid="login-error">{error}</p>}
        <button type="submit" data-testid="login-submit">Sign in</button>
        <p className="auth-switch">No account? <Link to="/register">Register</Link></p>
      </form>
    </main>
  );
}
