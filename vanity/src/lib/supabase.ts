import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Supabase session error', error.message);
      return null;
    }

    const session = data?.session;
    return session?.access_token ?? null;
  } catch (err) {
    console.warn('Failed to read Supabase access token', err);
    return null;
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn('Supabase user lookup failed', error.message);
      return null;
    }

    return data?.user?.id ?? null;
  } catch (err) {
    console.warn('Failed to read Supabase user', err);
    return null;
  }
}
