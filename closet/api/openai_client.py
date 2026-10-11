import httpx

from api.config import OPENAI_API_KEY

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


def call_openai_json(system: str, user: str | list[dict], model: str, temperature: float = 0) -> str:
    """Call Chat Completions in JSON mode and return the raw JSON string.

    `user` is either plain text or a list of content parts (text and image_url).
    """
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 3000,
        "temperature": temperature,
    }

    try:
        resp = httpx.post(
            OPENAI_API_URL, json=payload, headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}, timeout=60.0
        )
    except Exception as exc:
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI error {resp.status_code}: {resp.text}")

    choices = resp.json().get("choices") or []
    if not choices:
        return "{}"
    return choices[0].get("message", {}).get("content") or "{}"
