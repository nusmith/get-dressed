const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

import { getAccessToken } from './supabase';

export type ClosetItem = {
  id: string;
  name: string;
  image_path: string;
  image_url: string | null;
  created_at?: string;
};

export async function uploadImage(imageUri: string, filename: string, name: string) {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename,
      name,
      content_type: 'image/jpeg',
      image_data: imageUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Upload failed');
  }

  return response.json();
}

export async function fetchUserClosetItems(): Promise<ClosetItem[]> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}/closet`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to load closet');
  }

  const data = await response.json();
  return data.items ?? [];
}
