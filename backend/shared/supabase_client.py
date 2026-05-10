"""Supabase client singleton. Reads SUPABASE_URL / SUPABASE_KEY from env."""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_supabase() -> Client:
    """Return a process-wide singleton Supabase client.

    Raises RuntimeError naming the missing env var if config is incomplete.
    """
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url:
            raise RuntimeError(
                "Missing SUPABASE_URL environment variable. "
                "Set it in .env before calling get_supabase()."
            )
        if not key:
            raise RuntimeError(
                "Missing SUPABASE_KEY environment variable. "
                "Set it in .env before calling get_supabase()."
            )
        _client = create_client(url, key)
    return _client
