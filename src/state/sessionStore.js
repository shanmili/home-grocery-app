import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { DEFAULT_FAMILY_USERS, ROLES } from '../constants/roles';
import { supabase } from '../services/supabase/client';
import { fromLoginAlias, toLoginAlias } from '../services/supabase/loginAlias';

const SessionContext = createContext(null);
const legacyNames = Object.fromEntries(
  DEFAULT_FAMILY_USERS.map((user, index) => [`family-user-${index + 1}`, user.displayName])
);

function getFamilyUser(user) {
  if (!user) return null;
  const { grocery_role: role } = user.app_metadata ?? {};
  if (role !== ROLES.ADMIN && role !== ROLES.MEMBER) return null;
  const username = fromLoginAlias(user.email);
  if (!username) return null;
  const displayName = username[0].toUpperCase() + username.slice(1);
  return { id: user.id, username, role, displayName };
}

export function SessionProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [restoringSession, setRestoringSession] = useState(Boolean(supabase));
  const [userNamesById, setUserNamesById] = useState(legacyNames);

  useEffect(() => {
    if (!supabase) return undefined;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = getFamilyUser(session?.user);
      setCurrentUser(user);
      if (user) {
        setUserNamesById((names) => ({ ...names, [user.id]: user.displayName }));
      }
      setRestoringSession(false);
    });

    const updateAutoRefresh = (state) => {
      if (state === 'active') {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };

    const appState = AppState.addEventListener('change', updateAutoRefresh);
    updateAutoRefresh(AppState.currentState);
    return () => {
      subscription.unsubscribe();
      appState.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  async function signIn(username, password) {
    if (!supabase) throw new Error('Supabase is not configured.');

    const email = toLoginAlias(username);
    if (!email) throw new Error('Incorrect username or password.');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error?.code === 'invalid_credentials') {
      throw new Error('Incorrect username or password.');
    }
    if (error) throw error;

    if (!getFamilyUser(data.user)) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('This account needs a family role before it can open the app.');
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }

  return (
    <SessionContext.Provider value={{
      currentUser,
      userNamesById,
      isAuthenticated: Boolean(currentUser),
      restoringSession,
      isConfigured: Boolean(supabase),
      signIn,
      signOut,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
