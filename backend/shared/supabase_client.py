"""Supabase client singleton (service role for seeding)."""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Return a cached Supabase client. Uses SUPABASE_URL + SUPABASE_KEY from env."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in the environment (use service role for seeding)."
        )
    return create_client(url, key)


def clear_client_cache() -> None:
    """Clear cached client (e.g. after tests)."""
    get_client.cache_clear()
