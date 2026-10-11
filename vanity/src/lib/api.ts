const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000' 



import { getAccessToken } from './supabase';
import type { ItemDetails } from './taxonomy';

export type ClosetItem = ItemDetails & {
  id: string;
  name: string;
  image_path: string;
  image_url: string | null;
  created_at?: string;
  source?: 'gmail' | 'manual' | null;
};

export async function uploadImage(imageUri: string, filename: string, name: string, details?: ItemDetails) {
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
      details,
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

/** Brand, category, subcategory and size guessed from a photo (and name), to pre-fill the upload form. */
export async function suggestItemDetails(imageUri: string, name: string): Promise<ItemDetails> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/closet/suggest_details`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_data: await blobUrlToBase64(imageUri), name }),
  });
  if (!response.ok) throw new Error('Could not fill in details');
  return response.json();
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

export async function updateClosetItemDetails(id: string, details: ItemDetails): Promise<ItemDetails> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/closet/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ details }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      message = JSON.parse(errorText).detail ?? errorText;
    } catch {}
    throw new Error(message || 'Could not save changes');
  }

  return response.json();
}

/** Brands already used in the signed-in user's closet. */
export async function fetchUserBrands(): Promise<string[]> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/closet/brands`, { headers });
  if (!response.ok) throw new Error('Could not load your brands');
  const data = await response.json();
  return data.brands ?? [];
}

export type OutfitSuggestion = {
  items: ClosetItem[];
  /** Items that can go into outfits. Below a few, `items` is empty and the app asks for more. */
  closet_count: number;
};

export type SuggestOutfitOptions = {
  occasion?: string;
  note?: string;
  /** Pieces that must stay in the outfit. */
  keepItemIds?: string[];
  /** The piece to replace with a different one that does the same job. */
  swapItemId?: string;
  /** The outfit being shuffled away from. */
  previousItemIds?: string[];
};

/** Today as YYYY-MM-DD in the user's timezone, so outfits suit the season where they are. */
function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function suggestOutfit(options: SuggestOutfitOptions = {}): Promise<OutfitSuggestion> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/outfits/suggest`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      occasion: options.occasion,
      note: options.note,
      keep_item_ids: options.keepItemIds ?? [],
      swap_item_id: options.swapItemId,
      previous_item_ids: options.previousItemIds ?? [],
      today: localDate(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      message = JSON.parse(errorText).detail ?? errorText;
    } catch {}
    throw new Error(message || "Couldn't put an outfit together");
  }

  return response.json();
}
