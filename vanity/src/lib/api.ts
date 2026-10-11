import { request } from './http';
import type { ItemDetails } from './taxonomy';

export type ClosetItem = ItemDetails & {
  id: string;
  name: string;
  image_path: string;
  image_url: string | null;
  created_at?: string;
  source?: 'gmail' | 'manual' | null;
};

export async function uploadImage(imageUri: string, name: string, details?: ItemDetails) {
  const imageData = await blobUrlToBase64(imageUri);
  const contentType = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] ?? 'image/jpeg';
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';

  return request<{ closet: { id: string; name: string; image_path: string } }>(
    '/upload',
    {
      method: 'POST',
      body: JSON.stringify({
        filename: `upload-${Date.now()}.${extension}`,
        name,
        content_type: contentType,
        image_data: imageData,
        details,
      }),
    },
    'Upload failed'
  );
}

export async function fetchUserClosetItems(): Promise<ClosetItem[]> {
  const data = await request<{ items?: ClosetItem[] }>('/closet', {}, 'Failed to load closet');
  return data.items ?? [];
}

/** Brand, category, subcategory and size guessed from a photo (and name), to pre-fill the upload form. */
export async function suggestItemDetails(imageUri: string, name: string): Promise<ItemDetails> {
  return request<ItemDetails>(
    '/closet/suggest_details',
    { method: 'POST', body: JSON.stringify({ image_data: await blobUrlToBase64(imageUri), name }) },
    'Could not fill in details'
  );
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

export function updateClosetItemDetails(id: string, details: ItemDetails): Promise<ItemDetails> {
  return request<ItemDetails>(
    `/closet/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ details }) },
    'Could not save changes'
  );
}

/** Brands already used in the signed-in user's closet. */
export async function fetchUserBrands(): Promise<string[]> {
  const data = await request<{ brands?: string[] }>('/closet/brands', {}, 'Could not load your brands');
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

export function suggestOutfit(options: SuggestOutfitOptions = {}): Promise<OutfitSuggestion> {
  return request<OutfitSuggestion>(
    '/outfits/suggest',
    {
      method: 'POST',
      body: JSON.stringify({
        occasion: options.occasion,
        note: options.note,
        keep_item_ids: options.keepItemIds ?? [],
        swap_item_id: options.swapItemId,
        previous_item_ids: options.previousItemIds ?? [],
        today: localDate(),
      }),
    },
    "Couldn't put an outfit together"
  );
}

export type NamedCount = { name: string; count: number };

export type ClosetAnalysis = {
  item_count: number;
  /** Items whose photo has been described; colors, dressiness and seasons only count these. */
  described_count: number;
  /** Main color of each item, most common first. */
  colors: (NamedCount & { hex: string })[];
  /** Every dressiness level, loungewear to formal, including ones with no items. */
  formality: NamedCount[];
  /** Every season, spring to winter. */
  seasons: NamedCount[];
  categories: NamedCount[];
  brands: NamedCount[];
  /** Plain statements about what the closet is missing. */
  gaps: string[];
};

export function fetchClosetAnalysis(): Promise<ClosetAnalysis> {
  return request<ClosetAnalysis>('/closet/analysis', {}, 'Could not load your style');
}
