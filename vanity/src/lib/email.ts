import { request } from './http';
import type { ItemDetails } from './taxonomy';

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
