import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import type { Database } from './database.types';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // PKCE puts the auth code in the query string (?code=...), which does not
    // collide with the hash-based router used for GitHub Pages.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** URL the password-reset email links back to: the app root, without any hash route. */
export function appRootUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}
