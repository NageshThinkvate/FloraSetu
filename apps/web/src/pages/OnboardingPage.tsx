import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api/auth';
import { apiPost } from '../lib/api/client';

const CATEGORIES: { value: string; label: string; gated?: boolean }[] = [
  { value: 'BUYER', label: 'Buyer organization' },
  { value: 'FLORIST', label: 'Florist' },
  { value: 'WHOLESALER', label: 'Flower wholesaler' },
  { value: 'DECORATOR', label: 'Decorator' },
  { value: 'EVENT_PLANNER', label: 'Wedding / event planner' },
  { value: 'HOTEL', label: 'Hotel' },
  { value: 'CORPORATE_BUYER', label: 'Corporate / institutional buyer' },
  { value: 'GROWER', label: 'Commercial grower' },
  { value: 'GROWER_GROUP', label: 'Grower group' },
  { value: 'IMPORTER', label: 'Wholesaler / importer' },
  { value: 'AGGREGATION_HUB', label: 'Aggregation hub' },
  { value: 'QC_PARTNER', label: 'Grader / QC partner' },
  { value: 'LOGISTICS_PROVIDER', label: 'Logistics provider' },
  { value: 'COLD_CHAIN_PARTNER', label: 'Cold-chain partner' },
  { value: 'EXPORTER', label: 'Exporter (coming soon)', gated: true },
  { value: 'GOVERNMENT', label: 'Government tenant (coming soon)', gated: true }
];

export function OnboardingPage(): JSX.Element {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('BUYER');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await apiPost('/orgs', {
        name,
        category,
        address: city && state ? { line1: city, city, state, postalCode: '000000' } : undefined
      });
      await refresh();
      navigate('/account');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create organization');
    }
  };

  return (
    <main className="auth-shell" data-testid="onboarding-page">
      <form className="auth-card" onSubmit={submit} data-testid="onboarding-form">
        <h1>Create your organization</h1>
        <label>
          Organization name
          <input data-testid="onboarding-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Category
          <select data-testid="onboarding-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} disabled={c.gated}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <input data-testid="onboarding-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          State
          <input data-testid="onboarding-state" value={state} onChange={(e) => setState(e.target.value)} />
        </label>
        {error && <p className="form-error" data-testid="onboarding-error">{error}</p>}
        <button type="submit" data-testid="onboarding-submit">Create organization</button>
      </form>
    </main>
  );
}
