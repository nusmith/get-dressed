import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getAccessToken(): Promise<string | null> {
  try {
    const res = await supabase.auth.getSession();
    // supabase.auth.getSession() returns { data: { session } }
    // session may be null if not signed in
    // @ts-ignore
    return res?.data?.session?.access_token ?? null;
  } catch (err) {
    return null;
  }
}
