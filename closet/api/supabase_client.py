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
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = (
    os.getenv("SUPABASE_SECRET_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_SECRET_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
else:
    print(
        "[closet/api] Supabase not configured: "
        "set SUPABASE_URL and SUPABASE_SECRET_KEY"
    )