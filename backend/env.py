from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

# Keep local developer flow working while production reads platform env vars.
for candidate in (
    ROOT_DIR / ".env.local",
    ROOT_DIR / ".env",
    BASE_DIR / ".env.local",
    BASE_DIR / ".env",
):
    if candidate.exists():
        load_dotenv(candidate, override=False)


_ALIASES: dict[str, tuple[str, ...]] = {
    "gemini": (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
    ),
    "tavily": (
        "TAVILY_API_KEY",
        "TAVILY_KEY",
    ),
    "newsdata": (
        "NEWSDATA_API_KEY",
        "NEWSDATAIO_API_KEY",
    ),
    "gnews": (
        "GNEWS_API_KEY",
        "GNEWS_TOKEN",
    ),
}


def first_non_empty_env(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return None


def get_backend_key(name: str) -> str | None:
    aliases = _ALIASES.get(name.lower())
    if not aliases:
        return None
    return first_non_empty_env(*aliases)


def has_backend_key(name: str) -> bool:
    return bool(get_backend_key(name))
