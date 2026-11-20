
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSession } from './sessionStore';
import { publishLocalInventory, runSyncCycle } from '../services/sync/syncEngine';

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const { currentUser } = useSession();
  if (!currentUser) return children;
  return <AccountSync key={currentUser.id} user={currentUser}>{children}</AccountSync>;
}

function AccountSync({ user, children }) {
  const [result, setResult] = useState({ state: 'checking' });
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const active = useRef(null);
  const online = useRef(true);

  const syncNow = useCallback((publish = false) => {
    if (active.current) return publish ? active.current.then(() => syncNow(true)) : active.current;
    if (!online.current) {
      setResult((previous) => ({ ...previous, state: 'offline' }));
      return Promise.resolve();
    }

    setSyncing(true);
    active.current = (publish ? publishLocalInventory(user) : runSyncCycle(user))
      .then((next) => {
        setResult(next);
        if (next.changed) setRevision((value) => value + 1);
      })
      .catch((error) => {
        setResult((previous) => ({
          ...previous, state: 'error',
          message: error.code === 'PGRST202' || error.code === '42883'
            ? 'The Supabase sync migrations have not been applied.'
            : error.message || 'Sync failed. Local changes are still saved.',
        }));
      })
      .finally(() => {
        active.current = null;
        setSyncing(false);
      });
    return active.current;
  }, [user.id, user.role]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((network) => {
      online.current = network.isConnected !== false && network.isInternetReachable !== false;
      if (AppState.currentState === 'active') void syncNow();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void syncNow();
    }, 15000);
    return () => {
      unsubscribe();
      appState.remove();
      clearInterval(timer);
    };
  }, [syncNow]);

  return (
    <SyncContext.Provider value={{ ...result, revision, syncing, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useGrocerySync() {
  return useContext(SyncContext);
}

