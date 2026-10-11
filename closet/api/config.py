"""Everything the server reads from its environment, in one place.

Locally these come from closet/.env; in production the host sets them.
"""

import os

try:
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    # dotenv is optional at runtime; the host may set the variables itself
    pass


def _env(*names: str, default: str = "") -> str:
    """The first of `names` that is set, else `default`."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


SUPABASE_URL = _env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL")
SUPABASE_ANON_KEY = _env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SUPABASE_SECRET_KEY = _env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY")

OPENAI_API_KEY = _env("OPENAI_API_KEY")
# Describing photos and picking outfits: gpt-4o-mini doubled up pieces (two pairs of shoes, a dress
# with slacks) and ignored the season.
STYLE_MODEL = _env("STYLE_MODEL", default="gpt-4o")
OUTFIT_MODEL = _env("OUTFIT_MODEL", default="gpt-4o")
# Reading receipt emails, which is mostly copying text out.
RECEIPT_MODEL = _env("RECEIPT_MODEL", default="gpt-4o-mini")

GOOGLE_CLIENT_ID = _env("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = _env("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = _env("GOOGLE_REDIRECT_URI", default="http://localhost:8081/upload")
EMAIL_SECRET_KEY = _env("EMAIL_SECRET_KEY")

# Comma-separated. Any localhost port is also allowed (see main.py).
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in _env(
        "ALLOWED_ORIGINS",
        default="http://localhost:19006,http://127.0.0.1:19006,http://localhost:8081,http://127.0.0.1:8081",
    ).split(",")
    if origin.strip()
]
