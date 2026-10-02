from __future__ import annotations

from datetime import timedelta

from temporalio import workflow


@workflow.defn
class DependencyIncidentWorkflow:
    def __init__(self) -> None:
        self.state = "open"
        self.healthy_observations = 0
        self.recovery_started_ms: int | None = None
        self.queue: list[dict] = []
        self.latest_receipt_hash = ""

    @workflow.signal
    async def observe(self, receipt: dict) -> None:
        self.queue.append(receipt)

    @workflow.query
    def current_state(self) -> dict:
        return {
            "state": self.state,
            "healthyObservations": self.healthy_observations,
            "recoveryStartedAt": self.recovery_started_ms,
            "latestReceiptHash": self.latest_receipt_hash,
        }

    @workflow.run
    async def run(self, initial_receipt: dict) -> dict:
        self._apply(initial_receipt)
        while self.state != "resolved":
            if self.state == "recovering" and self.recovery_started_ms is not None:
                ready_at = self.recovery_started_ms + int(
                    initial_receipt.get("recoveryIntervalMs", 5_000)
                )
                remaining = max(0, ready_at - int(workflow.now().timestamp() * 1_000))
                if remaining:
                    try:
                        await workflow.wait_condition(
                            lambda: bool(self.queue), timeout=timedelta(milliseconds=remaining),
                        )
                    except TimeoutError:
                        self.state = "half_open"
                else:
                    self.state = "half_open"
            else:
                await workflow.wait_condition(lambda: bool(self.queue))
            while self.queue:
                self._apply(self.queue.pop(0))
        return self.current_state()

    def _apply(self, receipt: dict) -> None:
        self.latest_receipt_hash = str(receipt["receiptHash"])
        unhealthy = receipt["status"] != "healthy"
        if unhealthy:
            self.state = "open"
            self.healthy_observations = 0
            self.recovery_started_ms = None
            return
        observed_at = int(receipt["observedAt"])
        interval = int(receipt.get("recoveryIntervalMs", 5_000))
        if self.recovery_started_ms is None:
            self.recovery_started_ms = observed_at
            self.healthy_observations = 1
            self.state = "recovering"
            return
        if observed_at - self.recovery_started_ms >= interval:
            self.healthy_observations += 1
            if self.healthy_observations >= int(receipt.get("requiredHealthyObservations", 2)):
                self.state = "resolved"
            else:
                self.recovery_started_ms = observed_at
                self.state = "recovering"
