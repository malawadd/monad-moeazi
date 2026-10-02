from typing import Any

import httpx

from .config import Settings


class ConvexCommandError(RuntimeError):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


def _response_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    detail = payload.get("error") or payload.get("detail") if isinstance(payload, dict) else None
    if isinstance(detail, list):
        detail = " ".join(
            str(item.get("msg", item)) if isinstance(item, dict) else str(item)
            for item in detail
        )
    message = str(detail or f"Convex worker returned HTTP {response.status_code}.")
    return message.splitlines()[0].removeprefix("Uncaught Error: ").strip()


class ConvexWorkerClient:
    def __init__(self, settings: Settings):
        self.client = httpx.AsyncClient(
            timeout=20,
            headers={"Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}"},
        )
        self.url = settings.convex_worker_url

    async def command(self, command: str, **payload: Any) -> Any:
        response = await self.client.post(self.url, json={"command": command, "payload": payload})
        if response.is_error:
            raise ConvexCommandError(_response_error(response), response.status_code)
        data = response.json()
        if isinstance(data, dict) and data.get("error"):
            raise ConvexCommandError(str(data["error"]), response.status_code)
        return data

    async def claim(self, holder_id: str) -> dict | None:
        return await self.command("claimNextAnalysisJob", holderId=holder_id, leaseMs=120_000)

    async def claim_job(self, job_id: str, holder_id: str) -> dict:
        return await self.command(
            "claimAnalysisJob", jobId=job_id, holderId=holder_id, leaseMs=900_000,
        )

    async def heartbeat(self, job_id: str, holder_id: str) -> None:
        await self.command("heartbeatAnalysisJob", jobId=job_id, holderId=holder_id, leaseMs=120_000)

    async def complete(self, job_id: str, holder_id: str, synthesis: dict, providers: list[dict],
                       lifecycle_decision_hash: str, payload_json: str | None = None) -> None:
        payload_json = payload_json or _json(analysis_snapshot_payload(synthesis))
        await self.command(
            "completeAnalysisJob", jobId=job_id, holderId=holder_id,
            analysisId=synthesis["analysis_id"], status="fresh", payloadJson=payload_json,
            providersJson=_json(providers), sourceFreshnessMs=synthesis["freshness_ms"],
            validUntil=_epoch_ms(synthesis["valid_until"]),
            lifecycleDecisionHash=lifecycle_decision_hash,
        )

    async def fail(self, job_id: str, holder_id: str, error: str, retryable: bool = True) -> None:
        await self.command("failAnalysisJob", jobId=job_id, holderId=holder_id, error=error[:2000], retryable=retryable)


def _json(value: Any) -> str:
    import orjson
    return orjson.dumps(value, option=orjson.OPT_NON_STR_KEYS).decode()


def analysis_snapshot_payload(synthesis: dict) -> dict:
    return {**synthesis["visualization"], "consensus": synthesis["consensus"],
        "confidence": synthesis["confidence"], "disagreement": synthesis["disagreement"],
        "conflicts": synthesis["conflicts"]}


def _epoch_ms(value: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
