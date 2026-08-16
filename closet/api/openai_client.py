import os
import httpx
from typing import Optional

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


def call_openai(prompt: str, model: str = "gpt-4o-mini", api_key: Optional[str] = None) -> str:
    """Call OpenAI Chat Completions API (sync) and return the assistant text.

    Requires `api_key` or the OPENAI_API_KEY env var to be set.
    """
    key = api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 512,
        "temperature": 0.2,
    }

    try:
        resp = httpx.post(OPENAI_API_URL, json=payload, headers=headers, timeout=15.0)
    except Exception as exc:
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI error {resp.status_code}: {resp.text}")

    data = resp.json()
    # Chat completion response structure — extract choice message text
    choices = data.get("choices") or []
    if not choices:
        return ""

    first = choices[0]
    message = first.get("message", {})
    return message.get("content", "")
