import hashlib
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx

from .config import Settings
from .contracts import EvidenceRef
from .security import SanitizedEvidence, sanitize_untrusted_content


class NormalizedEvidence:
    def __init__(self, ref: EvidenceRef, content: str, metadata: dict[str, Any]):
        self.ref, self.content, self.metadata = ref, content, metadata


class DataAdapter(ABC):
    source: str

    @abstractmethod
    async def fetch(self, market: str) -> list[NormalizedEvidence]: ...


class JsonHttpAdapter(DataAdapter):
    def __init__(self, source: str, url: str, method: str = "GET", headers: dict[str, str] | None = None):
        self.source, self.url, self.method, self.headers = source, url, method, headers or {}
        self.client = httpx.AsyncClient(timeout=15)

    async def fetch(self, market: str) -> list[NormalizedEvidence]:
        payload = {"market": market}
        response = await self.client.request(self.method, self.url, params=payload if self.method == "GET" else None, json=payload if self.method != "GET" else None, headers=self.headers)
        response.raise_for_status()
        raw = response.text
        sanitized = sanitize_untrusted_content(raw)
        now = datetime.now(timezone.utc)
        ref = EvidenceRef(
            id=str(uuid4()), source=self.source, uri=str(response.url), observed_at=now,
            quality_score=0.7, content_hash=sanitized.content_hash,
        )
        return [NormalizedEvidence(ref, sanitized.text, {"status": response.status_code})]


def default_market_adapters() -> dict[str, DataAdapter]:
    return {
        "hyperliquid": JsonHttpAdapter("hyperliquid", "https://api.hyperliquid.xyz/info", "POST"),
        "lighter": JsonHttpAdapter("lighter", "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks"),
        "orderly": JsonHttpAdapter("orderly", "https://api-evm.orderly.org/v1/public/futures"),
        "gmx": JsonHttpAdapter("gmx", "https://arbitrum-api.gmxinfra.io/markets/info"),
        "ostium": JsonHttpAdapter("ostium", "https://metadata-backend.ostium.io/PricePublish/latest-prices"),
        "uniswap": JsonHttpAdapter("uniswap", "https://interface.gateway.uniswap.org/v2/quote"),
        "gdelt": JsonHttpAdapter("gdelt", "https://api.gdeltproject.org/api/v2/doc/doc"),
    }


class PushEvidenceAdapter:
    """Normalizer for QuickNode Streams and webhook-style vendor feeds."""

    def __init__(self, source: str, quality_score: float):
        self.source, self.quality_score = source, quality_score

    def normalize(self, payload: str, reference: str) -> NormalizedEvidence:
        sanitized = sanitize_untrusted_content(payload)
        ref = EvidenceRef(
            id=str(uuid4()), source=self.source, uri=reference,
            observed_at=datetime.now(timezone.utc), quality_score=self.quality_score,
            content_hash=sanitized.content_hash,
        )
        return NormalizedEvidence(ref, sanitized.text, {"injectionMarkers": sanitized.injection_markers})


class OptionalRedditAdapter(JsonHttpAdapter):
    def __init__(self, url: str = ""):
        if not url:
            raise RuntimeError("Reddit adapter requires explicit commercial-access endpoint configuration")
        super().__init__("reddit", url)


class XFilteredStreamAdapter(DataAdapter):
    source = "x_filtered_stream"

    def __init__(self, bearer_token: str):
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30, read=20), headers={"Authorization": f"Bearer {bearer_token}"}
        )

    async def fetch(self, market: str) -> list[NormalizedEvidence]:
        items: list[NormalizedEvidence] = []
        async with self.client.stream("GET", "https://api.x.com/2/tweets/search/stream") as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line: continue
                sanitized = sanitize_untrusted_content(line)
                ref = EvidenceRef(
                    id=str(uuid4()), source=self.source, uri=str(response.url),
                    observed_at=datetime.now(timezone.utc), quality_score=0.45,
                    content_hash=sanitized.content_hash,
                )
                items.append(NormalizedEvidence(ref, sanitized.text, {"market": market}))
                if len(items) >= 20: break
        return items


def configured_content_adapters(settings: Settings) -> dict[str, DataAdapter]:
    adapters: dict[str, DataAdapter] = {
        "gdelt": JsonHttpAdapter("gdelt", "https://api.gdeltproject.org/api/v2/doc/doc"),
    }
    crypto_key = settings.cryptopanic_api_key.get_secret_value()
    if crypto_key:
        adapters["cryptopanic"] = JsonHttpAdapter(
            "cryptopanic", f"https://cryptopanic.com/api/developer/v2/posts/?auth_token={crypto_key}"
        )
    x_token = settings.x_bearer_token.get_secret_value()
    if x_token:
        adapters["x_filtered_stream"] = XFilteredStreamAdapter(x_token)
    return adapters
