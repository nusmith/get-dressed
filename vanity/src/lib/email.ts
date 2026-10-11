import { getAccessToken } from './supabase';
import type { ItemDetails } from './taxonomy';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export type EmailStatus = {
  connected: boolean;
  provider?: 'gmail';
  email?: string | null;
  last_scanned_at?: string | null;
};

export type EmailProposal = ItemDetails & {
  key: string;
  name: string;
  image_url: string | null;
  retailer: string;
  subject: string;
  date: string;
  already_added: boolean;
  token: string;
};

export type ImportResult = {
  key: string;
  status: 'added' | 'already_added';
  image_error?: string | null;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).detail ?? text;
    } catch {}
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.json();
}

export function fetchEmailStatus() {
  return request<EmailStatus>('/email/status');
}

export async function getGmailAuthUrl() {
  const { url } = await request<{ url: string }>('/email/google/auth_url', { method: 'POST' });
  return url;
}

export function connectGmail(code: string, state: string) {
  return request<EmailStatus>('/email/google/connect', {
    method: 'POST',
    body: JSON.stringify({ code, state }),
  });
}

export function disconnectEmail() {
  return request<EmailStatus>('/email/connection', { method: 'DELETE' });
}

export function scanEmailReceipts() {
  return request<{ scanned_messages: number; proposals: EmailProposal[] }>('/email/scan', { method: 'POST' });
}

// Omit name/details to keep what the scan inferred (used by "Add all").
export type ImportRequest = { token: string; name?: string; details?: ItemDetails };

export async function importProposals(proposals: ImportRequest[]) {
  const { results } = await request<{ results: ImportResult[] }>('/email/import', {
    method: 'POST',
    body: JSON.stringify({ proposals }),
  });
  return results;
}
