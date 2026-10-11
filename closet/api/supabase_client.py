from typing import Optional

from fastapi import HTTPException
from supabase import Client, create_client

from api.config import SUPABASE_SECRET_KEY, SUPABASE_URL

supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_SECRET_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
else:
    print("[closet/api] Supabase not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY")


def db() -> Client:
    """The Supabase client, or a 500 when the server isn't configured with one."""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")
    return supabase
