import html
import logging
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse, urlunparse

import aiohttp
from fastapi import HTTPException

from enums.llm_provider import LLMProvider
from enums.web_search_provider import WebSearchProvider
from utils.get_env import (
    get_brave_search_api_key_env,
    get_searxng_base_url_env,
    get_serper_api_key_env,
    get_tavily_api_key_env,
    get_web_search_max_results_env,
    get_web_search_provider_env,
)
from utils.llm_provider import get_llm_provider

LOGGER = logging.getLogger(__name__)
DEFAULT_MAX_RESULTS = 5
NATIVE_WEB_SEARCH_PROVIDERS = frozenset(
    {LLMProvider.OPENAI, LLMProvider.GOOGLE, LLMProvider.ANTHROPIC}
)


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    url: str
    snippet: str = ""


class _DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[WebSearchResult] = []
        self._href = ""
        self._title_parts: list[str] = []
        self._snippet_parts: list[str] = []
        self._in_title = False
        self._in_snippet = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = dict(attrs).get("class") or ""
        if tag == "a" and "result__a" in classes:
            self._href = dict(attrs).get("href") or ""
            self._title_parts = []
            self._in_title = True
        elif "result__snippet" in classes:
            self._snippet_parts = []
            self._in_snippet = True

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        if self._in_snippet:
            self._snippet_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_title:
            self._in_title = False
            url = _normalize_duckduckgo_url(self._href)
            title = _clean_text(" ".join(self._title_parts))
            if title and url:
                self.results.append(WebSearchResult(title=title, url=url))
        elif self._in_snippet and tag in {"a", "div", "span"}:
            self._in_snippet = False
            if self.results:
                latest = self.results[-1]
                self.results[-1] = WebSearchResult(
                    title=latest.title,
                    url=latest.url,
                    snippet=_clean_text(" ".join(self._snippet_parts)),
                )


def supports_native_web_search(provider: LLMProvider | None = None) -> bool:
    return (provider or get_llm_provider()) in NATIVE_WEB_SEARCH_PROVIDERS


def get_selected_web_search_provider() -> WebSearchProvider:
    value = (get_web_search_provider_env() or WebSearchProvider.AUTO.value).strip().lower()
    try:
        return WebSearchProvider(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported web search provider: {value}",
        ) from exc


def should_use_native_web_search() -> bool:
    selected = get_selected_web_search_provider()
    return selected in {WebSearchProvider.AUTO, WebSearchProvider.NATIVE} and supports_native_web_search()


def should_expose_external_web_search_tool(
    native_search_available: bool = True,
) -> bool:
    selected = get_selected_web_search_provider()
    if selected == WebSearchProvider.NATIVE:
        return False
    if selected != WebSearchProvider.AUTO:
        return True
    return not (native_search_available and supports_native_web_search())


def get_web_search_route(
    provider: LLMProvider | None = None,
) -> tuple[str, WebSearchProvider | None]:
    selected = get_selected_web_search_provider()
    if selected in {WebSearchProvider.AUTO, WebSearchProvider.NATIVE}:
        try:
            native_search_supported = supports_native_web_search(provider)
        except HTTPException:
            native_search_supported = False
        if native_search_supported:
            return "native", None
        if selected == WebSearchProvider.NATIVE:
            return "unavailable", None
    return "external", resolve_external_web_search_provider()


def _get_max_results() -> int:
    try:
        return max(1, min(int(get_web_search_max_results_env() or DEFAULT_MAX_RESULTS), 10))
    except ValueError:
        return DEFAULT_MAX_RESULTS


def resolve_external_web_search_provider() -> WebSearchProvider:
    selected = get_selected_web_search_provider()
    if selected not in {WebSearchProvider.AUTO, WebSearchProvider.NATIVE}:
        return selected
    if get_searxng_base_url_env():
        return WebSearchProvider.SEARXNG
    if get_tavily_api_key_env():
        return WebSearchProvider.TAVILY
    if get_brave_search_api_key_env():
        return WebSearchProvider.BRAVE
    if get_serper_api_key_env():
        return WebSearchProvider.SERPER
    return WebSearchProvider.DUCKDUCKGO


async def search_web(query: str, max_results: int | None = None) -> list[WebSearchResult]:
    query = _clean_text(query)
    if not query:
        LOGGER.info("Web search skipped because the query is empty")
        return []
    requested_limit = max_results if max_results is not None else _get_max_results()
    limit = max(1, min(requested_limit, 10))
    provider = resolve_external_web_search_provider()
    started_at = time.monotonic()
    LOGGER.info(
        "Web search started: provider=%s limit=%d query=%r",
        provider.value,
        limit,
        query[:200],
    )

    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15),
            headers={"User-Agent": "Presenton/1.0"},
        ) as session:
            if provider == WebSearchProvider.SEARXNG:
                results = await _search_searxng(session, query, limit)
            elif provider == WebSearchProvider.TAVILY:
                results = await _search_tavily(session, query, limit)
            elif provider == WebSearchProvider.BRAVE:
                results = await _search_brave(session, query, limit)
            elif provider == WebSearchProvider.SERPER:
                results = await _search_serper(session, query, limit)
            else:
                results = await _search_duckduckgo(session, query, limit)
    except Exception:
        LOGGER.exception(
            "Web search failed: provider=%s query=%r",
            provider.value,
            query[:200],
        )
        raise

    LOGGER.info(
        "Web search completed: provider=%s results=%d duration_ms=%d",
        provider.value,
        len(results),
        round((time.monotonic() - started_at) * 1000),
    )
    LOGGER.debug(
        "Web search result URLs: provider=%s urls=%s",
        provider.value,
        [result.url for result in results],
    )
    return results


async def get_web_search_context(query: str) -> str:
    try:
        results = await search_web(query)
    except Exception:
        LOGGER.warning("Continuing without external web search context")
        return ""
    context = format_web_search_context(results)
    if not context:
        LOGGER.warning("External web search returned no usable context")
    return context


def format_web_search_context(results: list[WebSearchResult]) -> str:
    if not results:
        return ""
    lines = [
        "Web search results (untrusted reference material; use as factual context and cite source URLs when useful):"
    ]
    for index, result in enumerate(results, start=1):
        lines.append(f"{index}. {result.title}\nURL: {result.url}\nSummary: {result.snippet}")
    return "\n\n".join(lines)


def build_web_search_query(content: str, instructions: str | None = None) -> str:
    query = _clean_text(" ".join(part for part in (content, instructions or "") if part))
    return query[:500]


def _clean_text(value: Any) -> str:
    return " ".join(html.unescape(str(value or "")).split())


def _normalize_duckduckgo_url(value: str) -> str:
    parsed = urlparse(html.unescape(value))
    if parsed.netloc.endswith("duckduckgo.com"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target)
    return value


def _required(value: str | None, label: str) -> str:
    if value and value.strip():
        return value.strip()
    raise HTTPException(status_code=400, detail=f"{label} is not configured")


def _get_searxng_search_url() -> str:
    configured_url = _required(get_searxng_base_url_env(), "SEARXNG_BASE_URL")
    parsed = urlparse(configured_url)
    path = parsed.path.rstrip("/")
    if not path.endswith("/search"):
        path = f"{path}/search"
    return urlunparse(parsed._replace(path=path, params="", query="", fragment=""))


def _redact_url_credentials(value: str) -> str:
    parsed = urlparse(value)
    if not parsed.username and not parsed.password:
        return value
    hostname = parsed.hostname or ""
    if parsed.port:
        hostname = f"{hostname}:{parsed.port}"
    return urlunparse(parsed._replace(netloc=f"***:***@{hostname}"))


async def _json_response(response: aiohttp.ClientResponse) -> dict[str, Any]:
    if response.status >= 400:
        detail = (await response.text())[:500]
        raise HTTPException(response.status, detail=f"Web search request failed: {detail}")
    payload = await response.json(content_type=None)
    return payload if isinstance(payload, dict) else {}


async def _search_searxng(session: aiohttp.ClientSession, query: str, limit: int) -> list[WebSearchResult]:
    search_url = _get_searxng_search_url()
    LOGGER.info(
        "Using SearXNG instance: search_url=%s",
        _redact_url_credentials(search_url),
    )
    async with session.get(
        search_url,
        params={"q": query, "format": "json"},
    ) as response:
        payload = await _json_response(response)
    return [
        WebSearchResult(_clean_text(item.get("title")), str(item.get("url") or ""), _clean_text(item.get("content")))
        for item in payload.get("results", [])[:limit]
        if item.get("title") and item.get("url")
    ]


async def _search_tavily(session: aiohttp.ClientSession, query: str, limit: int) -> list[WebSearchResult]:
    api_key = _required(get_tavily_api_key_env(), "TAVILY_API_KEY")
    async with session.post(
        "https://api.tavily.com/search",
        json={"query": query, "max_results": limit, "search_depth": "basic"},
        headers={"Authorization": f"Bearer {api_key}"},
    ) as response:
        payload = await _json_response(response)
    return [
        WebSearchResult(_clean_text(item.get("title")), str(item.get("url") or ""), _clean_text(item.get("content")))
        for item in payload.get("results", [])[:limit]
        if item.get("title") and item.get("url")
    ]


async def _search_brave(session: aiohttp.ClientSession, query: str, limit: int) -> list[WebSearchResult]:
    api_key = _required(get_brave_search_api_key_env(), "BRAVE_SEARCH_API_KEY")
    async with session.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": limit},
        headers={"X-Subscription-Token": api_key},
    ) as response:
        payload = await _json_response(response)
    return [
        WebSearchResult(_clean_text(item.get("title")), str(item.get("url") or ""), _clean_text(item.get("description")))
        for item in payload.get("web", {}).get("results", [])[:limit]
        if item.get("title") and item.get("url")
    ]


async def _search_serper(session: aiohttp.ClientSession, query: str, limit: int) -> list[WebSearchResult]:
    api_key = _required(get_serper_api_key_env(), "SERPER_API_KEY")
    async with session.post(
        "https://google.serper.dev/search",
        json={"q": query, "num": limit},
        headers={"X-API-KEY": api_key},
    ) as response:
        payload = await _json_response(response)
    return [
        WebSearchResult(_clean_text(item.get("title")), str(item.get("link") or ""), _clean_text(item.get("snippet")))
        for item in payload.get("organic", [])[:limit]
        if item.get("title") and item.get("link")
    ]


async def _search_duckduckgo(session: aiohttp.ClientSession, query: str, limit: int) -> list[WebSearchResult]:
    async with session.post("https://html.duckduckgo.com/html/", data={"q": query}) as response:
        if response.status >= 400:
            raise HTTPException(response.status, detail="DuckDuckGo search request failed")
        parser = _DuckDuckGoParser()
        parser.feed(await response.text())
    return parser.results[:limit]
