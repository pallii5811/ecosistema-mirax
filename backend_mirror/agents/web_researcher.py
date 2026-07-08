"""
Phase 5.1 — WebResearcher: LLM query generation + Google search + Playwright scrape.
Isolato dal worker legacy (Strangler Fig).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("web_researcher")

DEFAULT_MAX_QUERIES = 7
DEFAULT_MAX_URLS_PER_QUERY = 25
DEFAULT_MAX_TEXT_CHARS = 5000
DEFAULT_PAGE_TIMEOUT_MS = 25_000
DEFAULT_NAV_TIMEOUT_MS = 20_000

SKIP_URL_PATTERNS = (
    r"google\.(com|it)",
    r"youtube\.com",
    r"facebook\.com/(login|share)",
    r"instagram\.com",
    r"twitter\.com",
    r"x\.com",
    r"linkedin\.com/(login|signup)",
    r"wikipedia\.org",
    r"amazon\.",
    r"ebay\.",
    r"github\.com",
    r"medium\.com",
)

# Sempre appendere alle query generate (Iron Dome — escludi code host)
QUERY_CODE_EXCLUSIONS = "-site:github.com -site:medium.com"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _plan_str(plan: Dict[str, Any], key: str, default: str = "") -> str:
    val = plan.get(key)
    if val is None:
        return default
    return str(val).strip()


def _should_skip_url(url: str) -> bool:
    if not url or not url.startswith("http"):
        return True
    low = url.lower()
    for pat in SKIP_URL_PATTERNS:
        if re.search(pat, low):
            return True
    return False


def _normalize_google_href(href: str) -> Optional[str]:
    if not href:
        return None
    if href.startswith("/url?"):
        qs = parse_qs(urlparse(href).query)
        target = qs.get("q", [None])[0]
        return unquote(target) if target else None
    if href.startswith("http"):
        return href
    return None


def extract_main_text(html: str, max_chars: int = DEFAULT_MAX_TEXT_CHARS) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    for tag_name in ("nav", "footer", "header", "aside", "form"):
        for tag in soup.find_all(tag_name):
            tag.decompose()
    for tag in soup.find_all(attrs={"role": re.compile(r"navigation|banner|contentinfo", re.I)}):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.body
    if not main:
        text = soup.get_text(separator="\n", strip=True)
    else:
        text = main.get_text(separator="\n", strip=True)

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    compact = "\n".join(lines)
    compact = re.sub(r"\n{3,}", "\n\n", compact)
    if len(compact) > max_chars:
        compact = compact[: max_chars - 3].rstrip() + "..."
    return compact


def _harden_search_query(query: str) -> str:
    """Applica esclusioni code host obbligatorie a ogni query Boolean."""
    q = re.sub(r"\s+", " ", (query or "").strip())
    if not q:
        return q
    for token in QUERY_CODE_EXCLUSIONS.split():
        q = re.sub(re.escape(token), "", q, flags=re.IGNORECASE)
    q = re.sub(r"\s+", " ", q).strip()
    suffix = f" {QUERY_CODE_EXCLUSIONS}"
    return f"{q[: 220 - len(suffix)].rstrip()}{suffix}"


def _finalize_search_queries(queries: List[str], *, max_queries: int = DEFAULT_MAX_QUERIES) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in queries:
        qn = _harden_search_query(raw)
        if not qn:
            continue
        key = qn.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(qn)
        if len(out) >= max_queries:
            break
    return out


def _queries_for_discovery_round(
    queries: List[str],
    plan: Dict[str, Any],
    *,
    max_queries: int,
) -> List[str]:
    """Make every discovery round explore a genuinely different SERP slice."""
    try:
        round_idx = max(1, int(plan.get("_discovery_round") or 1))
    except (TypeError, ValueError):
        round_idx = 1
    base = _finalize_search_queries(queries, max_queries=max_queries)
    if round_idx <= 1:
        return base

    current_year = datetime.now(timezone.utc).year
    suffixes = (
        f'({current_year} OR {current_year - 1} OR "ultimo anno")',
        '("comunicato stampa" OR newsroom OR notizie)',
        '(provincia OR regione OR Italia)',
        '(filetype:pdf OR intitle:news OR intitle:careers)',
    )
    suffix = suffixes[(round_idx - 2) % len(suffixes)]
    cycle = (round_idx - 2) // len(suffixes)
    diversified: List[str] = []
    for query in base:
        clean = query.replace(QUERY_CODE_EXCLUSIONS, "").strip()
        oldest_year = max(2010, datetime.now(timezone.utc).year - cycle * 2)
        page_hint = f" after:{oldest_year}-01-01" if cycle else ""
        diversified.append(f"{clean} {suffix}{page_hint}")
    return _finalize_search_queries(diversified, max_queries=max_queries)


def _signal_boolean_queries(plan: Dict[str, Any]) -> List[str]:
    """Query Boolean mirate al required_signal (USE)."""
    signals_raw = plan.get("required_signals") or []
    sig_set = {str(s).lower().strip().replace("-", "_") for s in signals_raw}
    sector = _plan_str(plan, "sector") or "PMI"
    location = _plan_str(plan, "location") or "Italia"
    original = _plan_str(plan, "original_query")
    orig_low = original.lower()
    hypothesis = plan.get("commercial_hypothesis") if isinstance(plan.get("commercial_hypothesis"), dict) else {}
    hypothesis_roles = [
        str(value).strip()
        for value in hypothesis.get("hiring_roles") or []
        if str(value).strip()
    ]

    role = "sviluppatore"
    if re.search(r"\b(commercialist|ragioniere|contabil)\b", orig_low):
        role = "commercialista"
    elif re.search(r"\b(marketing|seo|ads)\b", orig_low):
        role = "marketing"

    queries: List[str] = []
    if "hiring" in sig_set:
        if hypothesis_roles:
            queries.append(
                '(site:indeed.it OR site:infojobs.it) '
                '("SDR" OR "BDR" OR "Inside Sales") (outbound OR prospecting) Italia'
            )
            queries.append(
                '("Sales Development Representative" OR "Business Developer") '
                '(pipeline OR "new business" OR "sviluppo nuovi clienti") Italia'
            )
            queries.append(
                'site:.it (careers OR "lavora con noi") '
                '(SDR OR BDR OR "Business Developer")'
            )
        else:
            queries.append(f'site:indeed.it OR site:infojobs.it "{role}" Italia')
            queries.append(f'site:indeed.it OR site:infojobs.it "{sector}" assunzioni Italia')
    if sig_set & {"funding", "funding_received", "expansion", "sector_investment"}:
        queries.append(f'site:startupitalia.eu OR site:italian.tech "round di finanziamento" {sector}')
    if "tender_won" in sig_set:
        queries.append(f'site:anac.gov.it OR "comunicato stampa" "aggiudicazione appalto" {location}')
    if "new_company" in sig_set:
        queries.append(f'"nuova apertura" OR "costituzione società" {sector} {location}')
    if "tech_migration" in sig_set:
        queries.append(f'"digital transformation" OR "migrazione cloud" {sector} {location}')
    return queries


_LANE_QUERY_CONTEXT: Dict[str, str] = {
    "public_registry": '(site:registroimprese.it OR site:infocamere.it OR site:camcom.it)',
    "public_procurement": '(site:anac.gov.it OR site:ted.europa.eu OR "albo pretorio")',
    "job_market": '(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs OR "lavora con noi")',
    "funding": '(site:startupitalia.eu OR site:italian.tech OR "round di finanziamento" OR investitori)',
    "company_web": '(site:.it "chi siamo" OR site:.it newsroom OR site:.it careers)',
    "news": '("comunicato stampa" OR newsroom OR "stampa locale")',
    "technology": '("case study" OR migrazione OR implementazione OR "nuovo software")',
    "real_estate": '("nuova sede" OR trasferimento OR ampliamento OR "nuova apertura")',
    "regulatory": '(site:gazzettaufficiale.it OR site:gov.it OR site:regione.it OR autorizzazione OR obbligo)',
    "web_evidence": '(evidenza OR annuncio OR comunicato OR registro)',
}


def _source_plan_queries(plan: Dict[str, Any]) -> List[str]:
    source_plan = plan.get("source_plan")
    if not isinstance(source_plan, list):
        return []
    original = _plan_str(plan, "original_query")
    sector = _plan_str(plan, "sector")
    location = _plan_str(plan, "location") or "Italia"
    rows = [row for row in source_plan if isinstance(row, dict)]
    rows.sort(key=lambda row: float(row.get("priority") or 0), reverse=True)
    queries: List[str] = []
    for row in rows:
        lane = str(row.get("lane") or "web_evidence")
        lane_context = _LANE_QUERY_CONTEXT.get(lane, _LANE_QUERY_CONTEXT["web_evidence"])
        templates = row.get("query_templates")
        if not isinstance(templates, list) or not templates:
            templates = [original]
        for template in templates[:2]:
            query = str(template or original).strip()
            query = (
                query.replace("{query}", original)
                .replace("{sector}", sector)
                .replace("{location}", location)
            )
            if not query:
                continue
            if lane_context.lower() not in query.lower():
                query = f"{query} {lane_context}"
            queries.append(query)
            if len(queries) >= DEFAULT_MAX_QUERIES:
                return queries
    return queries


def _heuristic_search_queries(plan: Dict[str, Any]) -> List[str]:
    """Fallback offline — Boolean per signal + query B2B."""
    original = _plan_str(plan, "original_query")
    sector = _plan_str(plan, "sector")
    location = _plan_str(plan, "location") or "Italia"
    signals = plan.get("required_signals") or []
    orig_low = original.lower()

    # Interleave explicit signal queries with source-plan lanes. This guarantees
    # that a long source plan cannot crowd the user's primary constraint out of
    # the seven-query SERP budget.
    source_queries = _source_plan_queries(plan)
    signal_queries = _signal_boolean_queries(plan)
    queries: List[str] = []
    for index in range(max(len(source_queries), len(signal_queries))):
        if index < len(signal_queries):
            queries.append(signal_queries[index])
        if index < len(source_queries):
            queries.append(source_queries[index])

    if re.search(r"\b(python|programmatore|developer|sviluppat\w*|software)\b", orig_low):
        queries.extend([
            f'site:indeed.it OR site:infojobs.it "sviluppatore Python" {location}',
            f'PMI {location} lavora con noi sviluppatore backend',
        ])
    elif re.search(r"\b(commercialist|ragioniere|contabil|potenziali clienti|vendere)\b", orig_low):
        queries.extend([
            f'"nuova apertura" OR "costituzione società" {location}',
            f'site:startupitalia.eu "round di finanziamento" {location}',
        ])
    elif re.search(r"\b(sono\s+un|freelanc|clienti|potrebbero\s+aver\s+bisogno)\b", orig_low):
        queries.extend([
            f'PMI {location} in crescita assume {datetime.now(timezone.utc).year} site:.it',
            f'site:startupitalia.eu funding round {location}',
        ])
    elif not queries:
        parts = [p for p in [sector, location] if p and p.lower() not in {"agentic ai", "pmi", "aziende", "aziende in crescita"}]
        base = " ".join(dict.fromkeys(" ".join(parts).split())) or f"aziende {location}"
        queries.extend([
            f"{base} investimento espansione {datetime.now(timezone.utc).year}",
            f"{base} lavora con noi careers",
        ])

    if "hiring" in signals and not any("indeed" in q for q in queries):
        queries.append(f'site:indeed.it OR site:infojobs.it "{sector or "PMI"}" Italia')

    return _finalize_search_queries(queries)


B2B_SYSTEM_PROMPT = """Sei un Universal Web Researcher B2B evidence-first per MIRAX.

La query originale e il vincolo dominante. Distingui sempre il prodotto venduto
dal settore dell'acquirente. Usa commercial_hypothesis per cercare fatti, non
come prova. Ottimizza per lead caldi: intent fit, specificita del segnale,
recenza, qualita della fonte e possibilita di contatto.

Genera query di ricerca Boolean mirate alle FONTI GIUSTE in base a required_signals nel MiraxQueryPlan:

- hiring → OBBLIGATORIO: site:indeed.it OR site:infojobs.it "[ruolo]" Italia
- funding_received / expansion → site:startupitalia.eu OR site:italian.tech "round di finanziamento" [settore]
- tender_won → site:anac.gov.it OR "comunicato stampa" "aggiudicazione appalto" [città]
- new_company → "nuova apertura" OR "costituzione società" [settore] [città]
- tech_migration → "digital transformation" OR "migrazione cloud" [settore]

REGOLE IRON DOME:
- Ogni query DEVE includere: -site:github.com -site:medium.com
- NON cercare la professione dell'utente letteralmente — cerca aziende con SEGNALI DI BISOGNO.
- NON query generiche ("aziende informatica Italia").
- 5-7 query diverse, operatori Boolean (site:, OR, virgolette).
- Segui source_plan, research_questions ed evidence_policy quando presenti.
- Per seller intent usa buying_signals e hiring_roles della commercial_hypothesis.
- Le query devono cercare il FATTO osservabile, non il nome del software venduto.
- Scegli fonti verticali, registri e fonti primarie prima del web generico.
- Non imporre paese, dimensione o forma giuridica se l'utente non li richiede."""



class WebResearcher:
    """
    Agente ricercatore web autonomo.
    Input: MiraxQueryPlan (dict).
    Output: [{ url, raw_text, query_source }, ...]
    """

    def __init__(
        self,
        plan: Dict[str, Any],
        *,
        max_queries: int = DEFAULT_MAX_QUERIES,
        max_urls_per_query: int = DEFAULT_MAX_URLS_PER_QUERY,
        max_text_chars: int = DEFAULT_MAX_TEXT_CHARS,
        page_timeout_ms: int = DEFAULT_PAGE_TIMEOUT_MS,
        seen_urls: Optional[Set[str]] = None,
    ) -> None:
        if not isinstance(plan, dict):
            raise ValueError("plan must be a dict (MiraxQueryPlan)")
        self.plan = plan
        self.max_queries = max(5, min(max_queries, 7))
        self.max_urls_per_query = max(15, min(max_urls_per_query, 30))
        self.max_text_chars = max_text_chars
        self.page_timeout_ms = page_timeout_ms
        self.seen_urls = seen_urls if seen_urls is not None else set()
        self.generated_base_queries: List[str] = []
        try:
            self.scrape_workers = max(1, min(8, int(os.getenv("AGENTIC_SCRAPE_WORKERS", "4") or "4")))
        except ValueError:
            self.scrape_workers = 4

    async def generate_search_queries(self) -> List[str]:
        override = self.plan.get("_search_queries_override")
        if isinstance(override, list):
            self.generated_base_queries = _finalize_search_queries(
                [str(value) for value in override if str(value).strip()],
                max_queries=self.max_queries,
            )
            return _queries_for_discovery_round(
                self.generated_base_queries,
                self.plan,
                max_queries=self.max_queries,
            )
        deterministic = _heuristic_search_queries(self.plan)
        llm_queries = (
            []
            if len(deterministic) >= self.max_queries
            else await _llm_search_queries(self.plan, self.max_queries)
        )
        self.generated_base_queries = _finalize_search_queries(
            [*deterministic, *llm_queries],
            max_queries=self.max_queries,
        )
        return _queries_for_discovery_round(
            self.generated_base_queries,
            self.plan,
            max_queries=self.max_queries,
        )

    async def _discover_urls_for_query(self, query: str) -> List[str]:
        """HTTP SERP (Bing/DDG) first, Playwright Google as fallback."""
        try:
            from .search_serp import search_urls_http, DEFAULT_SERP_TARGET

            serp_target = max(self.max_urls_per_query, DEFAULT_SERP_TARGET)
            urls = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: search_urls_http(query, serp_target),
            )
            if urls:
                logger.info("HTTP SERP: %s urls for query=%r", len(urls), query[:70])
                return urls
        except Exception as exc:
            logger.warning("HTTP SERP failed query=%r: %s", query[:70], exc)
        return await self._search_google_playwright(query)

    async def _search_google_playwright(self, query: str) -> List[str]:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright not installed")
            return await _search_google_optional_lib(query, self.max_urls_per_query)

        urls: List[str] = []
        seen: Set[str] = set()

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled",
                    ],
                )
                context = await browser.new_context(
                    user_agent=USER_AGENT,
                    locale="it-IT",
                    viewport={"width": 1280, "height": 720},
                )
                page = await context.new_page()
                search_url = f"https://www.google.com/search?q={quote_plus(query)}&hl=it&num=15"
                try:
                    await page.goto(search_url, timeout=DEFAULT_NAV_TIMEOUT_MS, wait_until="domcontentloaded")
                    await page.wait_for_timeout(1500)
                except Exception as exc:
                    logger.warning("google SERP navigation failed query=%r: %s", query[:80], exc)
                    await browser.close()
                    return await _search_google_optional_lib(query, self.max_urls_per_query)

                anchors = await page.query_selector_all("a[href]")
                for a in anchors:
                    if len(urls) >= self.max_urls_per_query:
                        break
                    try:
                        href = await a.get_attribute("href")
                    except Exception:
                        continue
                    normalized = _normalize_google_href(href or "")
                    if not normalized or _should_skip_url(normalized):
                        continue
                    key = normalized.lower().rstrip("/")
                    if key in seen:
                        continue
                    seen.add(key)
                    urls.append(normalized)

                await browser.close()
        except Exception as exc:
            logger.warning("playwright google search failed: %s", exc)
            return await _search_google_optional_lib(query, self.max_urls_per_query)

        return urls

    async def _scrape_url(self, page: Any, url: str) -> Optional[str]:
        try:
            await page.goto(url, timeout=self.page_timeout_ms, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            await page.wait_for_timeout(600)
            html = await page.content()
            text = extract_main_text(html, self.max_text_chars)
            return text if len(text) >= 80 else None
        except Exception as exc:
            logger.warning("scrape skipped url=%s: %s", url[:120], exc)
            return None

    async def run(self) -> List[Dict[str, str]]:
        """
        Pipeline completa: genera query → cerca → scrape.
        Non solleva eccezioni fatali — ritorna lista (anche vuota).
        """
        results: List[Dict[str, str]] = []
        seen_urls = self.seen_urls

        try:
            queries = await self.generate_search_queries()
        except Exception as exc:
            logger.warning("generate_search_queries failed: %s", exc)
            queries = _heuristic_search_queries(self.plan)

        if not queries:
            logger.info("no search queries generated")
            return results

        url_jobs: List[tuple[str, str]] = []
        for q in queries:
            try:
                found = await self._discover_urls_for_query(q)
                for u in found:
                    key = u.lower().rstrip("/")
                    if key in seen_urls:
                        continue
                    seen_urls.add(key)
                    url_jobs.append((u, q))
            except Exception as exc:
                logger.warning("search failed query=%r: %s", q[:80], exc)

        if not url_jobs:
            logger.info("no URLs discovered from search")
            return results

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright missing — cannot scrape pages")
            return [{"url": u, "raw_text": "", "query_source": q} for u, q in url_jobs[:15]]

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                    ],
                )
                context = await browser.new_context(user_agent=USER_AGENT, locale="it-IT")
                page = await context.new_page()

                for url, query_source in url_jobs:
                    text = await self._scrape_url(page, url)
                    if text:
                        results.append(
                            {
                                "url": url,
                                "raw_text": text,
                                "query_source": query_source,
                            }
                        )
                await browser.close()
        except Exception as exc:
            logger.warning("playwright scrape batch failed: %s", exc)

        return results

    async def iter_scraped_pages(self):
        """
        Async generator: genera query → cerca URL → scrape una pagina alla volta.
        Usato dal gap-fill streaming (publish incrementale).
        """
        seen_urls = self.seen_urls

        try:
            queries = await self.generate_search_queries()
        except Exception as exc:
            logger.warning("generate_search_queries failed: %s", exc)
            queries = _heuristic_search_queries(self.plan)

        if not queries:
            logger.info("no search queries generated")
            return

        url_jobs: List[tuple[str, str]] = []
        for q in queries:
            try:
                found = await self._discover_urls_for_query(q)
                for u in found:
                    key = u.lower().rstrip("/")
                    if key in seen_urls:
                        continue
                    seen_urls.add(key)
                    url_jobs.append((u, q))
                    if len(url_jobs) >= self.max_urls_per_query * self.max_queries:
                        break
            except Exception as exc:
                logger.warning("search failed query=%r: %s", q[:80], exc)
            if len(url_jobs) >= self.max_urls_per_query * self.max_queries:
                break

        if not url_jobs:
            logger.info("no URLs discovered from search")
            return

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright missing — cannot scrape pages")
            for u, q in url_jobs[:15]:
                yield {"url": u, "raw_text": "", "query_source": q}
            return

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                    ],
                )
                context = await browser.new_context(user_agent=USER_AGENT, locale="it-IT")
                sem = asyncio.Semaphore(self.scrape_workers)

                async def _scrape_job(url: str, query_source: str) -> Optional[Dict[str, str]]:
                    async with sem:
                        page = await context.new_page()
                        try:
                            text = await self._scrape_url(page, url)
                            if not text:
                                return None
                            return {"url": url, "raw_text": text, "query_source": query_source}
                        finally:
                            await page.close()

                tasks = [asyncio.create_task(_scrape_job(url, source)) for url, source in url_jobs]
                for task in asyncio.as_completed(tasks):
                    item = await task
                    if item:
                        yield item
                await browser.close()
        except Exception as exc:
            logger.warning("playwright scrape stream failed: %s", exc)


async def _search_google_optional_lib(query: str, limit: int) -> List[str]:
    """Fallback opzionale googlesearch-python se installato."""
    try:
        from googlesearch import search as gsearch  # type: ignore
    except ImportError:
        return []

    urls: List[str] = []
    try:
        for url in gsearch(query, num_results=limit, lang="it"):
            if not url or _should_skip_url(url):
                continue
            urls.append(url)
            if len(urls) >= limit:
                break
    except Exception as exc:
        logger.warning("googlesearch-python failed: %s", exc)
    return urls


async def _llm_search_queries(plan: Dict[str, Any], max_queries: int) -> List[str]:
    raw = await _call_openai_search_queries(plan, max_queries)
    if raw:
        return raw
    return await _call_anthropic_search_queries(plan, max_queries)


def _llm_prompt(plan: Dict[str, Any], max_queries: int) -> str:
    payload = {
        "original_query": plan.get("original_query"),
        "sector": plan.get("sector"),
        "location": plan.get("location"),
        "required_signals": plan.get("required_signals"),
        "technical_filters": plan.get("technical_filters"),
        "extraction_schema": plan.get("extraction_schema"),
        "intent_summary": plan.get("intent_summary"),
        "discovery_round": plan.get("_discovery_round", 1),
        "research_questions": plan.get("research_questions"),
        "source_plan": plan.get("source_plan"),
        "evidence_policy": plan.get("evidence_policy"),
        "commercial_hypothesis": plan.get("commercial_hypothesis"),
        "ranking_policy": plan.get("ranking_policy"),
    }
    source_queries = _source_plan_queries(plan)
    return f"""Genera esattamente {max_queries} query Boolean diverse per trovare organizzazioni con segnali di bisogno.

Questo e il discovery round {plan.get('_discovery_round', 1)}: amplia fonti, sinonimi e formulazioni; non limitarti alle template del primo round.

Query suggerite dal source plan (migliorale e diversificale):
{json.dumps(source_queries, ensure_ascii=False)}

Usa le template per required_signals:
- hiring → OBBLIGATORIO: site:indeed.it OR site:infojobs.it "[ruolo]" Italia
- funding/expansion → site:startupitalia.eu OR site:italian.tech "round di finanziamento" [settore]
- tender_won → site:anac.gov.it OR "aggiudicazione appalto" [città]
- new_company → "nuova apertura" OR "costituzione società" [settore]
- tech_migration → "digital transformation" [settore]

Ogni query DEVE terminare con: -site:github.com -site:medium.com

MiraxQueryPlan:
{json.dumps(payload, ensure_ascii=False, indent=2)}"""


def _parse_queries_json(text: str) -> List[str]:
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if isinstance(data, dict) and isinstance(data.get("queries"), list):
        return [str(q).strip() for q in data["queries"] if str(q).strip()]
    if isinstance(data, list):
        return [str(q).strip() for q in data if str(q).strip()]
    return []


async def _call_openai_search_queries(plan: Dict[str, Any], max_queries: int) -> List[str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return []
    model = os.getenv("UQE_OPENAI_MODEL") or os.getenv("SEMANTIC_OPENAI_MODEL") or "gpt-4o-mini"
    tool_schema = {
        "type": "function",
        "function": {
            "name": "submit_search_queries",
            "description": "Invia 5-7 query B2B mirate su PMI italiane.",
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 5,
                        "maxItems": max_queries,
                    }
                },
                "required": ["queries"],
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=28.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": 600,
                    "messages": [
                        {"role": "system", "content": B2B_SYSTEM_PROMPT},
                        {"role": "user", "content": _llm_prompt(plan, max_queries)},
                    ],
                    "tools": [tool_schema],
                    "tool_choice": {"type": "function", "function": {"name": "submit_search_queries"}},
                },
            )
        if res.status_code != 200:
            logger.warning("OpenAI search queries HTTP %s", res.status_code)
            return []
        data = res.json()
        tool_calls = (data.get("choices") or [{}])[0].get("message", {}).get("tool_calls") or []
        for tc in tool_calls:
            fn = tc.get("function") or {}
            if fn.get("name") != "submit_search_queries":
                continue
            args = json.loads(fn.get("arguments") or "{}")
            return _finalize_search_queries(_parse_queries_json(json.dumps(args)), max_queries=max_queries)
    except Exception as exc:
        logger.warning("OpenAI search queries failed: %s", exc)
    return []


async def _call_anthropic_search_queries(plan: Dict[str, Any], max_queries: int) -> List[str]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return []
    model = os.getenv("UQE_ANTHROPIC_MODEL") or os.getenv("SEMANTIC_MODEL") or "claude-sonnet-4-20250514"
    tool = {
        "name": "submit_search_queries",
        "description": "Invia 5-7 query B2B mirate su PMI italiane.",
        "input_schema": {
            "type": "object",
            "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 5,
                        "maxItems": max_queries,
                    }
            },
            "required": ["queries"],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=28.0) as client:
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 600,
                    "temperature": 0,
                    "system": B2B_SYSTEM_PROMPT,
                    "tools": [tool],
                    "tool_choice": {"type": "tool", "name": "submit_search_queries"},
                    "messages": [{"role": "user", "content": _llm_prompt(plan, max_queries)}],
                },
            )
        if res.status_code != 200:
            logger.warning("Anthropic search queries HTTP %s", res.status_code)
            return []
        data = res.json()
        for block in data.get("content") or []:
            if block.get("type") == "tool_use" and block.get("name") == "submit_search_queries":
                inp = block.get("input") or {}
                return _finalize_search_queries(_parse_queries_json(json.dumps(inp)), max_queries=max_queries)
    except Exception as exc:
        logger.warning("Anthropic search queries failed: %s", exc)
    return []


def run_web_research(plan: Dict[str, Any], **kwargs: Any) -> List[Dict[str, str]]:
    """Entrypoint sync per script/worker."""
    return asyncio.run(WebResearcher(plan, **kwargs).run())


if __name__ == "__main__":
    sample_plan = {
        "original_query": "aziende lombarde bioplastica fondi UE",
        "search_strategy": "hybrid",
        "sector": "bioplastica",
        "location": "Lombardia",
        "required_signals": ["sector_investment", "hiring"],
        "technical_filters": {},
        "extraction_schema": ["email", "fatturato"],
        "confidence": 0.8,
        "intent_summary": "Produttori bioplastica in Lombardia con fondi UE",
    }
    assert extract_main_text("<html><body><main><p>Test azienda bioplastica</p></main></body></html>")[:20]
    hq = _heuristic_search_queries(sample_plan)
    assert len(hq) >= 2
    assert all("-site:github.com" in q and "-site:medium.com" in q for q in hq)
    hardened = _harden_search_query('site:indeed.it OR site:infojobs.it "sviluppatore" Italia')
    assert "-site:github.com" in hardened
    print("web_researcher self-check OK", f"heuristic_queries={len(hq)}")
