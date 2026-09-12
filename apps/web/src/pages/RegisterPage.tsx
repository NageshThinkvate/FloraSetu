import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';

export function RegisterPage(): JSX.Element {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await register(email, password, displayName);
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <main className="auth-shell" data-testid="register-page">
      <form className="auth-card" onSubmit={submit} data-testid="register-form">
        <h1>Create account</h1>
        <label>
          Full name
          <input data-testid="register-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          Email
          <input data-testid="register-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password (10+ chars, letters and numbers)
          <input data-testid="register-password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form-error" data-testid="register-error">{error}</p>}
        <button type="submit" data-testid="register-submit">Register</button>
        <p className="auth-switch">Have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </main>
  );
}
