"""ANAC local SQLite index.

ANAC Open Data no longer exposes datastore-active resources.  The monthly
"aggiudicazioni" and "aggiudicatari" CSV/ZIP archives contain tender outcomes
and the winning companies (by CIG).  This module downloads the latest monthly
archives once, loads them into a local SQLite database, and answers
company-name queries with real evidence.
"""
from __future__ import annotations

import csv
import difflib
import io
import os
import re
import sqlite3
import threading
import zipfile
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

BASE_URL = "https://dati.anticorruzione.it/opendata"
API_URL = f"{BASE_URL}/api/3/action"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DATA_DIR = os.environ.get("ANAC_DATA_DIR", "/home/worker/app/data/anac")
DEFAULT_DB_PATH = os.path.join(DATA_DIR, "anac_tenders.db")
CUTOFF_DAYS = 365 * 2
REFRESH_HOURS = 24

_REFRESH_LOCK = threading.Lock()


def _headers() -> Dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": BASE_URL + "/",
    }


def _api_url(action: str) -> str:
    return f"{API_URL}/{action}"


def _parse_resource_date(name: str) -> Optional[str]:
    m = re.match(r"^(\d{8})-(aggiudicazioni|aggiudicatari)_csv$", name)
    if not m:
        return None
    return m.group(1)


def _normalize_company(name: str) -> str:
    s = re.sub(r"[^a-z0-9&\s]", " ", name.lower())
    return " ".join(s.split())


def _api_get_sync(client: httpx.Client, action: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    try:
        resp = client.get(_api_url(action), params=params or {}, headers=_headers(), timeout=30.0)
        if resp.status_code != 200:
            return None
        ctype = (resp.headers.get("content-type") or "").lower()
        if "json" not in ctype:
            return None
        data = resp.json()
        if not data.get("success"):
            return None
        return data.get("result")
    except Exception:
        return None


def _discover_latest_resources(client: httpx.Client) -> Tuple[Optional[str], Optional[str]]:
    """Return (tenders_download_url, winners_download_url) for the latest monthly CSV archives."""
    tenders_url: Optional[str] = None
    winners_url: Optional[str] = None
    tenders_date = ""
    winners_date = ""

    for pkg_name, kind in [("aggiudicazioni", "tenders"), ("aggiudicatari", "winners")]:
        pkg = _api_get_sync(client, "package_show", {"id": pkg_name})
        if pkg:
            for res in pkg.get("resources", []) or []:
                if not isinstance(res, dict):
                    continue
                name = str(res.get("name") or "")
                url = str(res.get("url") or "")
                date = _parse_resource_date(name)
                if not date:
                    continue
                if not url.endswith(".zip"):
                    continue
                if kind == "tenders" and date > tenders_date:
                    tenders_date = date
                    tenders_url = url
                elif kind == "winners" and date > winners_date:
                    winners_date = date
                    winners_url = url

    # CKAN HTML WAF intermittently blocks package_show. Fall back to the known
    # monthly filesystem naming used by ANAC Open Data.
    if not tenders_url or not winners_url:
        for yyyymmdd in (
            datetime.now().strftime("%Y%m01"),
            (datetime.now().replace(day=1) - timedelta(days=1)).strftime("%Y%m01"),
        ):
            t_url = f"{BASE_URL}/download/dataset/aggiudicazioni/filesystem/{yyyymmdd}-aggiudicazioni_csv.zip"
            w_url = f"{BASE_URL}/download/dataset/aggiudicatari/filesystem/{yyyymmdd}-aggiudicatari_csv.zip"
            try:
                t_ok = client.head(t_url, headers=_headers(), timeout=20.0).status_code == 200
                w_ok = client.head(w_url, headers=_headers(), timeout=20.0).status_code == 200
            except Exception:
                t_ok = w_ok = False
            if t_ok and w_ok:
                tenders_url = tenders_url or t_url
                winners_url = winners_url or w_url
                break

    return tenders_url, winners_url


def _download_zip(client: httpx.Client, url: str) -> bytes:
    resp = client.get(url, headers=_headers(), timeout=120.0)
    resp.raise_for_status()
    return resp.content


def _extract_csv_name(zf: zipfile.ZipFile) -> Optional[str]:
    for n in zf.namelist():
        if n.lower().endswith(".csv"):
            return n
    return None


def _open_csv_text(zf: zipfile.ZipFile, name: str) -> csv.DictReader:
    raw = zf.read(name)
    # Try utf-8 first, fallback to latin-1 for older files.
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    return csv.DictReader(text.splitlines(), delimiter=";", quotechar='"')


def _parse_amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    text = str(value).replace(".", "").replace(",", ".").strip()
    try:
        n = float(text)
        return n if n > 0 else None
    except ValueError:
        return None


def _parse_date(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()[:10]
    parsed: Optional[str] = None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        parsed = text
    else:
        for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
            try:
                parsed = datetime.strptime(text, fmt).date().isoformat()
                break
            except ValueError:
                continue
    if not parsed:
        return None
    try:
        day = date.fromisoformat(parsed)
    except ValueError:
        return None
    # Reject corrupted years from source dumps (e.g. 6202-01-16).
    if day.year < 1990 or day > datetime.now().date() + timedelta(days=1):
        return None
    return parsed


def _db_meta_value(conn: sqlite3.Connection, key: str) -> Optional[str]:
    cur = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
    row = cur.fetchone()
    return row[0] if row else None


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS tenders (
            cig TEXT PRIMARY KEY,
            date TEXT,
            amount REAL,
            object TEXT,
            authority TEXT,
            province TEXT,
            region TEXT,
            status TEXT,
            resource_date TEXT
        );
        CREATE TABLE IF NOT EXISTS winners (
            cig TEXT,
            company_name TEXT,
            cf TEXT,
            role TEXT,
            resource_date TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_winners_company ON winners(company_name);
        CREATE INDEX IF NOT EXISTS idx_winners_cig ON winners(cig);
        CREATE INDEX IF NOT EXISTS idx_tenders_date ON tenders(date);
        CREATE INDEX IF NOT EXISTS idx_winners_company_lower ON winners(LOWER(company_name));
        """
    )
    conn.commit()


def _load_tenders(conn: sqlite3.Connection, reader: csv.DictReader, resource_date: str) -> int:
    rows: List[Tuple[Any, ...]] = []
    for r in reader:
        cig = str(r.get("cig") or "").strip().upper()
        if not cig:
            continue
        date = _parse_date(r.get("data_aggiudicazione_definitiva") or r.get("data_comunicazione_esito"))
        amount = _parse_amount(r.get("importo_aggiudicazione"))
        obj = str(r.get("oggetto") or r.get("oggetto_gara") or "")[:500]
        authority = str(r.get("denominazione_amministrazione") or r.get("stazione_appaltante") or "")[:200]
        province = str(r.get("provincia") or "")[:50]
        region = str(r.get("regione") or "")[:50]
        status = str(r.get("esito") or "").strip().lower()[:50]
        rows.append((cig, date, amount, obj, authority, province, region, status, resource_date))
    conn.executemany(
        """
        INSERT OR REPLACE INTO tenders(cig, date, amount, object, authority, province, region, status, resource_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def _load_winners(conn: sqlite3.Connection, reader: csv.DictReader, resource_date: str) -> int:
    rows: List[Tuple[Any, ...]] = []
    for r in reader:
        cig = str(r.get("cig") or "").strip().upper()
        if not cig:
            continue
        name = str(r.get("denominazione") or "").strip()[:300]
        if not name:
            continue
        cf = str(r.get("codice_fiscale") or "").strip()[:30]
        role = str(r.get("ruolo") or "").strip()[:100]
        rows.append((cig, name, cf, role, resource_date))
    conn.executemany(
        """
        INSERT OR REPLACE INTO winners(cig, company_name, cf, role, resource_date)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def _should_refresh(conn: sqlite3.Connection) -> bool:
    updated = _db_meta_value(conn, "last_updated")
    if not updated:
        return True
    try:
        last = datetime.fromisoformat(updated)
    except ValueError:
        return True
    return datetime.now(timezone.utc) - last > timedelta(hours=REFRESH_HOURS)


def ensure_index(db_path: Optional[str] = None) -> str:
    """Ensure a fresh local SQLite index exists.  Returns the DB path."""
    path = db_path or DEFAULT_DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with closing(sqlite3.connect(path)) as conn:
        _init_db(conn)
        if not _should_refresh(conn):
            return path

    # Serialize refresh to avoid duplicate downloads from concurrent workers.
    acquired = _REFRESH_LOCK.acquire(blocking=False)
    if not acquired:
        # Another thread is refreshing; wait for it and then return.
        with _REFRESH_LOCK:
            return path

    try:
        # Re-check after acquiring the lock in case another thread already refreshed.
        with closing(sqlite3.connect(path)) as conn:
            _init_db(conn)
            if not _should_refresh(conn):
                return path

        # Download and rebuild outside the long-lived write transaction where possible.
        with httpx.Client(follow_redirects=True) as client:
            tenders_url, winners_url = _discover_latest_resources(client)
            if not tenders_url or not winners_url:
                # Keep existing data if API is unreachable.
                return path

            tenders_zip = _download_zip(client, tenders_url)
            winners_zip = _download_zip(client, winners_url)

        resource_date = os.path.basename(tenders_url).replace("-aggiudicazioni_csv.zip", "")

        with closing(sqlite3.connect(path)) as conn:
            _init_db(conn)
            # Clear previous monthly data so the DB does not grow unbounded.
            conn.execute("DELETE FROM tenders")
            conn.execute("DELETE FROM winners")

            with zipfile.ZipFile(io.BytesIO(tenders_zip)) as zf:
                name = _extract_csv_name(zf)
                if name:
                    reader = _open_csv_text(zf, name)
                    n_t = _load_tenders(conn, reader, resource_date)
                else:
                    n_t = 0
            with zipfile.ZipFile(io.BytesIO(winners_zip)) as zf:
                name = _extract_csv_name(zf)
                if name:
                    reader = _open_csv_text(zf, name)
                    n_w = _load_winners(conn, reader, resource_date)
                else:
                    n_w = 0

            _set_meta(conn, "last_updated", datetime.now(timezone.utc).isoformat())
            _set_meta(conn, "resource_date", resource_date)
            conn.commit()
            print(f"[anac_index] refreshed {resource_date}: {n_t} tenders, {n_w} winners", flush=True)
    finally:
        _REFRESH_LOCK.release()

    return path


def _name_tokens(name: str) -> List[str]:
    norm = _normalize_company(name)
    return [t for t in norm.split() if len(t) >= 3]


def _search_by_tokens(conn: sqlite3.Connection, tokens: List[str], cutoff: str, limit: int) -> List[sqlite3.Row]:
    """Find winners whose company name matches query tokens, then filter recent tenders."""
    if not tokens:
        return []

    token_patterns = [f"%{t}%" for t in tokens]

    # First try strict AND: company name must contain every token.
    and_clause = " AND ".join("LOWER(company_name) LIKE ?" for _ in tokens)
    sql_and = f"""
    SELECT t.cig, t.date, t.amount, t.object, t.authority, t.province, t.region, t.status,
           w.company_name, w.role
    FROM winners w
    JOIN tenders t ON t.cig = w.cig
    WHERE ({and_clause}) AND t.date >= ?
    ORDER BY t.date DESC
    LIMIT ?
    """
    cur = conn.execute(sql_and, token_patterns + [cutoff, limit * 4])
    rows = cur.fetchall()
    if len(rows) >= limit:
        return rows

    # Fallback: OR matching with a larger window so exact matches are not lost.
    or_clause = " OR ".join("LOWER(company_name) LIKE ?" for _ in tokens)
    sql_or = f"""
    SELECT t.cig, t.date, t.amount, t.object, t.authority, t.province, t.region, t.status,
           w.company_name, w.role
    FROM winners w
    JOIN tenders t ON t.cig = w.cig
    WHERE ({or_clause}) AND t.date >= ?
    ORDER BY t.date DESC
    LIMIT ?
    """
    cur = conn.execute(sql_or, token_patterns + [cutoff, max(limit * 20, 200)])
    return rows + cur.fetchall()


def search_company(
    company_name: str,
    *,
    cf: Optional[str] = None,
    max_records: int = 5,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Search the local ANAC index for tenders won by a company."""
    path = db_path or ensure_index()
    cutoff = (datetime.now() - timedelta(days=CUTOFF_DAYS)).date().isoformat()

    # Exact CF/P.IVA match is the strongest evidence when available.
    cf_clean = (cf or "").strip().upper()
    if cf_clean:
        with closing(sqlite3.connect(path)) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.execute(
                """
                SELECT t.cig, t.date, t.amount, t.object, t.authority, t.province, t.region, t.status,
                       w.company_name, w.role
                FROM winners w
                JOIN tenders t ON t.cig = w.cig
                WHERE w.cf = ? AND t.date >= ?
                ORDER BY t.date DESC
                LIMIT ?
                """,
                (cf_clean, cutoff, max_records),
            )
            rows = cur.fetchall()
            if rows:
                return [dict(r) for r in rows]

    tokens = _name_tokens(company_name)
    if not tokens:
        return []

    with closing(sqlite3.connect(path)) as conn:
        conn.row_factory = sqlite3.Row
        rows = _search_by_tokens(conn, tokens, cutoff, max_records)

    # Score and dedupe by CIG, keeping the best matching company name per CIG.
    query_norm = _normalize_company(company_name)
    scored: List[Tuple[float, Dict[str, Any]]] = []
    seen_cig: set = set()
    for row in rows:
        cig = str(row["cig"])
        if cig in seen_cig:
            continue
        anac_name = str(row["company_name"])
        anac_norm = _normalize_company(anac_name)
        ratio = difflib.SequenceMatcher(None, query_norm, anac_norm).ratio()
        anac_tokens = set(_name_tokens(anac_name))
        matched = sum(1 for t in tokens if t in anac_tokens)

        # Quality gate: require whole-word token matches; do not trust substrings.
        if matched < len(tokens):
            continue

        score = ratio + matched * 0.1
        record = dict(row)
        record["_score"] = score
        scored.append((score, record))
        seen_cig.add(cig)

    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:max_records]]


_DISCOVERY_STOPWORDS = {
    "azienda", "aziende", "impresa", "imprese", "italia", "italiane", "italiani",
    "gara", "gare", "appalto", "appalti", "vinto", "vinta", "vinte", "vinti",
    "ultimi", "ultimo", "recente", "recenti", "recentemente",
    "pubblico", "pubblica", "pubbliche", "pubblici",
    "anno", "anni", "trova", "trovami", "cerca", "settore", "servizi", "lavori",
    "che", "hanno", "nella", "nelle", "degli", "delle",
}


def discover_companies(
    keywords: List[str],
    *,
    location: str = "",
    max_records: int = 100,
    days: int = CUTOFF_DAYS,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Discover tender winners by contract subject and geography.

    Unlike ``search_company`` this is a source lane: it starts from the user's
    market intent and returns candidate companies, without an LLM call.
    """
    path = db_path or ensure_index()
    tokens: List[str] = []
    for value in keywords:
        for token in _normalize_company(str(value)).split():
            if len(token) >= 4 and token not in _DISCOVERY_STOPWORDS and token not in tokens:
                tokens.append(token)

    cutoff = (datetime.now() - timedelta(days=max(1, days))).date().isoformat()
    today = datetime.now().date().isoformat()
    # Date-first discovery: when the query has no sector tokens left after
    # stopword filtering (e.g. country-wide "recent public contract winners"),
    # return recent winners without inventing a municipality/sector dictionary.
    where = ["t.date >= ?", "t.date <= ?", "w.company_name IS NOT NULL", "LENGTH(TRIM(w.company_name)) > 2"]
    params: List[Any] = [cutoff, today]
    if tokens:
        object_clause = " OR ".join("LOWER(t.object) LIKE ?" for _ in tokens)
        # Current ANAC award CSVs often omit object text; keep token filter only
        # when object is present, otherwise fall through on date+winner.
        where.insert(0, f"((LENGTH(COALESCE(t.object,'')) = 0) OR ({object_clause}))")
        params = [f"%{token}%" for token in tokens] + params

    geo = _normalize_company(location)
    if geo and geo != "italia":
        where.append("(LOWER(t.province) LIKE ? OR LOWER(t.region) LIKE ?)")
        params.extend([f"%{geo}%", f"%{geo}%"])

    params.append(max(1, min(max_records * 6, 10_000)))
    sql = f"""
        SELECT t.cig, t.date, t.amount, t.object, t.authority, t.province,
               t.region, t.status, w.company_name, w.cf, w.role
        FROM tenders t
        JOIN winners w ON w.cig = t.cig
        WHERE {' AND '.join(where)}
        ORDER BY t.date DESC, t.amount DESC
        LIMIT ?
    """

    with closing(sqlite3.connect(path)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()

    # One candidate per fiscal identity (or normalized name), preserving the
    # most recent/highest-value evidence selected by SQL ordering.
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        record = dict(row)
        key = str(record.get("cf") or "").strip() or _normalize_company(str(record.get("company_name") or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(record)
        if len(out) >= max_records:
            break
    return out
