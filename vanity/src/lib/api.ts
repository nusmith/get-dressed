const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000' 



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

  const imageData = await blobUrlToBase64(imageUri);
  const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const contentType = match?.[1] ?? 'image/jpeg';
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : 'jpg';
  const formatted_filename = `upload-${Date.now()}.${extension}`;

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: formatted_filename,
      name,
      content_type: 'image/jpeg',
      image_data: imageData,
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

async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = reader.result;

      if (typeof result !== 'string') {
        reject(new Error('Failed to convert image to base64'));
        return;
      }

      resolve(result);
    };

    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
