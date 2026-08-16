const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export type GenerateLookResponse = { result: string };

export async function callGenerateLook(prompt: string, model?: string): Promise<GenerateLookResponse> {
  const res = await fetch(`${API_BASE_URL}/generate_look`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'GenerateLook request failed');
  }

  return res.json();
}
