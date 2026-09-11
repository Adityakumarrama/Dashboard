import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabase';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Initialize auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (error) {
        console.warn('Initial session check error:', error.message);
        try { supabase.auth.signOut({ scope: 'local' }); } catch {}
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
      setSession(s);
      if (s) {
        syncUser(s);
      } else {
        setLoading(false);
      }
    }).catch(err => {
      console.warn('Failed to retrieve session:', err);
      try { supabase.auth.signOut({ scope: 'local' }); } catch {}
      setSession(null);
      setUser(null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        syncUser(s);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const syncUser = async (s) => {
    if (!s?.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api.post('/auth/sync', {});
      if (data?.user) {
        setUser(data.user);
      } else {
        throw new Error('No user data returned from sync');
      }
    } catch (err) {
      console.warn('Backend sync failed, using session fallback:', err.message);
      // Fallback to Supabase user session data so user is not stuck
      const role = s.user.user_metadata?.role ||
        (s.user.email?.toLowerCase().includes('admin') ? 'ADMIN' : 'JURY');
      setUser({
        id: s.user.id,
        email: s.user.email,
        username: s.user.user_metadata?.username || s.user.email?.split('@')[0],
        fullName: s.user.user_metadata?.full_name || 'Administrator',
        role: role,
        judgeId: s.user.user_metadata?.judge_id || null,
        status: 'active',
        lastLoginAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  const login = useCallback(async (identifier, password) => {
    const raw = (identifier || '').trim();
    if (!raw) throw new Error('Please enter your Jury ID or Email');

    const candidates = [];

    // 1. Ask backend API to resolve the exact canonical email for this Jury ID / username
    try {
      const resolved = await api.post('/auth/resolve-identifier', { identifier: raw });
      if (resolved?.email) {
        const canonical = resolved.email.toLowerCase();
        if (!candidates.includes(canonical)) {
          candidates.push(canonical);
        }
      }
    } catch (err) {
      if (err.status === 403 || err.code === 'ACCOUNT_INACTIVE') {
        throw new Error(err.message || 'Your jury account has been marked inactive. Please contact the administrator.');
      }
      console.warn('Backend resolve-identifier failed, trying client candidates:', err.message);
    }

    // 2. Client-side candidate generation:
    // Alphanumeric stripped: e.g. "jury_Pharma_07" -> "jurypharma07@sih.gov.in"
    const cleanAlpha = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanAlpha) {
      const cleanEmail = `${cleanAlpha}@sih.gov.in`;
      if (!candidates.includes(cleanEmail)) candidates.push(cleanEmail);
    }

    if (raw.includes('@')) {
      const atEmail = raw.toLowerCase();
      if (!candidates.includes(atEmail)) candidates.push(atEmail);
      if (!raw.includes('.')) {
        const dotGovEmail = `${atEmail}.gov.in`;
        if (!candidates.includes(dotGovEmail)) candidates.push(dotGovEmail);
      }
    } else {
      const rawAtSih = `${raw.toLowerCase()}@sih.gov.in`;
      if (!candidates.includes(rawAtSih)) candidates.push(rawAtSih);
      const rawAtGov = `${raw.toLowerCase()}.gov.in`;
      if (!candidates.includes(rawAtGov)) candidates.push(rawAtGov);
    }

    if (!candidates.includes(raw)) {
      candidates.push(raw);
    }

    let lastError = null;
    let authData = null;

    for (const emailToTry of candidates) {
      try {
        const res = await supabase.auth.signInWithPassword({ email: emailToTry, password });
        if (res.error) {
          lastError = res.error;
          continue;
        }
        if (res.data?.session) {
          authData = res.data;
          lastError = null;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!authData?.session) {
      throw lastError || new Error('Invalid Jury ID or password');
    }

    return authData;
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {}
    setUser(null);
    setSession(null);
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('sb-')) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
    navigate('/login');
  }, [navigate]);

  const value = {
    user,
    session,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'ADMIN',
    isJury: user?.role === 'JURY',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
