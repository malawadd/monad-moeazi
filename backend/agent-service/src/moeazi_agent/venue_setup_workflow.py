from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from moeazi_agent.config import get_settings
    from moeazi_agent.convex import ConvexWorkerClient


@activity.defn
async def finalize_venue_setup_activity(payload: dict) -> dict:
    settings = get_settings()
    if not settings.mainnet_venue_setup_enabled:
        raise RuntimeError("Mainnet venue setup environment gate is closed")
    return await ConvexWorkerClient(settings).command("finalizeVenueSetup", **payload)


@activity.defn
async def fail_venue_setup_activity(payload: dict) -> dict | None:
    return await ConvexWorkerClient(get_settings()).command("failVenueSetup", **payload)


@workflow.defn
class VenueSetupWorkflow:
    def __init__(self):
        self.user_reference: str | None = None
        self.verification: dict | None = None
        self.state = "waiting_for_user"

    @workflow.signal
    async def submit_user_proof(self, reference: str) -> None:
        self.user_reference = reference
        self.state = "verifying"

    @workflow.signal
    async def verification_completed(self, result: dict) -> None:
        self.verification = result

    @workflow.query
    def current_state(self) -> dict:
        return {"state": self.state, "userReference": self.user_reference}

    @workflow.run
    async def run(self, payload: dict) -> dict:
        try:
            await workflow.wait_condition(lambda: self.user_reference is not None, timeout=timedelta(days=7))
            await workflow.wait_condition(lambda: self.verification is not None, timeout=timedelta(hours=24))
            if not self.verification.get("verified"):
                self.state = "failed"
                await workflow.execute_activity(
                    fail_venue_setup_activity,
                    {"attemptId": payload["attempt_id"], "error": self.verification.get("error", "Verification failed")},
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                return {"state": self.state}
            self.state = "finalizing"
            result = await workflow.execute_activity(
                finalize_venue_setup_activity,
                {**self.verification["finalization"], "attemptId": payload["attempt_id"]},
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            self.state = "ready"
            return {"state": self.state, "result": result}
        except TimeoutError:
            self.state = "failed"
            await workflow.execute_activity(
                fail_venue_setup_activity,
                {"attemptId": payload["attempt_id"], "error": "Venue setup expired"},
                start_to_close_timeout=timedelta(seconds=30),
            )
            return {"state": self.state}
