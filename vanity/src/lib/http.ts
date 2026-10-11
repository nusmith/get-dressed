import { getAccessToken } from './supabase';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Call the closet API as the signed-in user and return its JSON.
 * Errors carry the server's `detail` when it sends one, else `fallbackMessage`.
 */
export async function request<T>(path: string, init: RequestInit = {}, fallbackMessage?: string): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let detail: unknown;
    try {
      detail = JSON.parse(text).detail;
    } catch {}
    throw new Error(
      (typeof detail === 'string' && detail) || fallbackMessage || text || `Request failed (${response.status})`
    );
  }
  return response.json();
}
