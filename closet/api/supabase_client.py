import os
from typing import Optional

from supabase import Client, create_client

# Try to load .env for local development if python-dotenv is available
try:
    from dotenv import load_dotenv

    # load variables from the repository root .env (closet/.env)
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    # dotenv is optional at runtime; environment variables may already be set by the host
    pass

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")

supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
else:
    # Provide a clearer runtime message for misconfiguration (keeps app importable)
    # The API endpoints should check `supabase is None` and return a meaningful HTTP error.
    print(
        "[closet/api] Supabase not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in the environment or .env"
    )
