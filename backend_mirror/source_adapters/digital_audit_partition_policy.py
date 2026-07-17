"""Frozen query-expansion policy for the legacy Digital Audit acquisition.

These values are acquisition hints, not a geography resolver or municipality
whitelist.  Unknown and exact localities always fall back to the unchanged
user value.  Keeping the existing expansions here preserves active v3 cursor
partition indexes while preventing lifecycle validation from treating this
policy as geographic authority.
"""

from __future__ import annotations

from typing import Tuple


_CONTROLLED_QUERY_EXPANSIONS = {
    "milano": (
        "Milano", "Milano Centro", "Milano Nord", "Milano Sud", "Milano Est", "Milano Ovest",
        "Milano Niguarda", "Milano Lambrate", "Milano Baggio",
    ),
    "lombardia": (
        "Milano", "Bergamo", "Brescia", "Monza", "Como", "Varese", "Pavia", "Cremona",
        "Lecco", "Lodi", "Mantova", "Sondrio",
    ),
}


def controlled_geography_partitions(location: str) -> Tuple[str, ...]:
    normalized = " ".join(str(location or "").casefold().split())
    return _CONTROLLED_QUERY_EXPANSIONS.get(normalized, (location,))
