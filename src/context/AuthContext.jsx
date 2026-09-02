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
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        syncUser(s);
      } else {
        setLoading(false);
      }
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
    let email = (identifier || '').trim();
    if (!email.includes('@')) {
      email = `${email}@sih.gov.in`;
    } else if (!email.includes('.')) {
      email = `${email}.gov.in`;
    }

    let authRes;
    try {
      authRes = await supabase.auth.signInWithPassword({ email, password });
      if (authRes.error) throw authRes.error;
    } catch (err) {
      if (email !== identifier.trim()) {
        authRes = await supabase.auth.signInWithPassword({ email: identifier.trim(), password });
        if (authRes.error) throw authRes.error;
      } else {
        throw err;
      }
    }
    return authRes.data;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
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
