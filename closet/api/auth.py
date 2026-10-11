import os

import httpx
from fastapi import HTTPException, Request


def get_user_id_from_request(request: Request) -> str:
    """Validate Supabase JWT from the Authorization header and return the user id.

    This calls the Supabase Auth user endpoint which returns the user for a valid token.
    """
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth.split(" ", 1)[1].strip()
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
    anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")
    if not supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL not configured on server")
    if not anon_key:
        raise HTTPException(status_code=500, detail="SUPABASE_ANON_KEY not configured on server")

    user_endpoint = f"{supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": anon_key,
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.get(user_endpoint, headers=headers, timeout=5.0)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auth lookup failed: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {resp.text}")

    data = resp.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Failed to resolve user id from token")

    return user_id
