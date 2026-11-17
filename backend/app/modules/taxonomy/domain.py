import hashlib
import re
import unicodedata

LEVELS = ("industry", "department", "category", "role")
PROFILE_KEYS = dict(
    zip(LEVELS, ("industry", "department", "role_category", "job_role"), strict=True)
)
PARENTS = {"category": "department", "role": "category"}


def clean_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = " ".join(value.split())
    if not 1 <= len(value) <= 160 or any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError("Enter between 1 and 160 characters without control characters.")
    if any(c in value for c in "<>"):
        raise ValueError("Use plain text without markup.")
    return value


def normalize(value: str) -> str:
    return clean_name(value).casefold()


def slug_for(value: str) -> str:
    normalized = normalize(value)
    stem = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:100] or "option"
    return stem + "-" + hashlib.sha256(normalized.encode()).hexdigest()[:10]
