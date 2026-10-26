// Production Supabase project. The publishable key is public by design: it is
// shipped in the browser bundle, and all data protection is enforced by Row
// Level Security in the database (supabase/migrations, tested in supabase/tests).
// Never put the secret/service_role key in the app.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://czpsosmbzmmqmdtwwuyn.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_MmfVphbflkngvB123EDGeg_V8oW88hB';
