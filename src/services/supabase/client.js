import { createClient } from '@supabase/supabase-js';
import storage from 'expo-sqlite/kv-store';
import { env } from '../../config/env';

function isConfigured() {
  try {
    const url = new URL(env.supabaseUrl);
    return url.protocol === 'https:' &&
      Boolean(url.hostname) &&
      /^sb_publishable_[\w-]+$/.test(env.supabasePublishableKey ?? '');
  } catch {
    return false;
  }
}

export const supabase = isConfigured()
  ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
