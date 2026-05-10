"""Supabase client singleton. Reads SUPABASE_URL / SUPABASE_KEY from env."""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

logger = logging.getLogger(__name__)

@lru_cache(maxsize=1)
def get_client() -> Client:
    """Return a cached Supabase client."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url:
        raise RuntimeError(
            "Missing SUPABASE_URL environment variable. "
            "Set it in .env before calling get_client()."
        )
    if not key:
        raise RuntimeError(
            "Missing SUPABASE_KEY environment variable. "
            "Set it in .env before calling get_client()."
        )
    return create_client(url, key)

def get_supabase() -> Client:
    """Backward-compatible alias used by Persona 2 modules."""
    return get_client()


def clear_client_cache() -> None:
    """Clear cached client (e.g. after tests)."""
    get_client.cache_clear()
