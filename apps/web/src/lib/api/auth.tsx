import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiGet, apiPost, getSession, setActiveOrg, setSession } from '../api/client';

interface Membership {
  org_id: string;
  name: string;
  type: string;
  org_status: string;
  membership_status: string;
  roles: string[];
}

interface Me {
  id: string;
  email: string;
  display_name: string;
  mfaActive: boolean;
  memberships: Membership[];
}

interface AuthState {
  loading: boolean;
  me: Me | null;
  login(email: string, password: string, mfaCode?: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  selectOrg(orgId: string): void;
  activeOrgId: string | null;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    if (!getSession()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiGet<Me>('/auth/me');
      setMe(data);
    } catch {
      setSession(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const completeLogin = async (data: { accessToken: string; refreshToken: string; userId: string }): Promise<void> => {
    setSession(data);
    const profile = await apiGet<Me>('/auth/me');
    setMe(profile);
    const firstActive = profile.memberships.find((m) => m.membership_status === 'ACTIVE');
    if (firstActive) {
      setActiveOrg(firstActive.org_id);
      setActiveOrgId(firstActive.org_id);
    }
  };

  const value: AuthState = {
    loading,
    me,
    activeOrgId,
    refresh,
    login: async (email, password, mfaCode) => {
      await completeLogin(await apiPost('/auth/login', { email, password, mfaCode }));
    },
    register: async (email, password, displayName) => {
      await completeLogin(await apiPost('/auth/register', { email, password, displayName }));
    },
    logout: async () => {
      const session = getSession();
      if (session) {
        await apiPost('/auth/logout', { refreshToken: session.refreshToken }).catch(() => undefined);
      }
      setSession(null);
      setActiveOrg(null);
      setMe(null);
      setActiveOrgId(null);
    },
    selectOrg: (orgId) => {
      setActiveOrg(orgId);
      setActiveOrgId(orgId);
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth outside provider');
  }
  return ctx;
}
