"""A live submit marker is consumed once before the venue call."""
import pytest

from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_repository import FinanceRepository


SCOPE = FinanceScope(environment="live", scope_id="live",
                     strategy_account_id="account-a")
HASH = "a" * 64
POLICY = "b" * 64


class Result:
    def __init__(self, row): self.row = row
    def first(self): return self.row


class Connection:
    def __init__(self): self.claimed = False; self.statement = ""
    async def __aenter__(self): return self
    async def __aexit__(self, *_): return None
    async def execute(self, statement, params):
        self.statement = str(statement)
        assert params["strategy_account_id"] == "account-a"
        if self.claimed:
            return Result(None)
        self.claimed = True
        return Result(("attempt-a",))


class Engine:
    def __init__(self): self.connection = Connection(); self.begins = 0
    def begin(self): self.begins += 1; return self.connection


def _args():
    return dict(attempt_id="attempt-a", reservation_id="reservation-a",
                client_id="client-a", normalized_payload_hash=HASH,
                snapshot_hash=HASH, policy_hash=POLICY, authority_epoch=1)


@pytest.mark.asyncio
async def test_dispatch_claim_is_one_shot_and_exactly_scoped(monkeypatch):
    engine = Engine()
    repo = FinanceRepository(engine)
    async def lock(_conn, _scope):
        return {"admission_state": "open", "reconciliation_state": "clean",
                "observation_snapshot_hash": HASH, "policy_hash": POLICY,
                "authority_epoch": 1}
    monkeypatch.setattr(repo, "_lock", lock)
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is True
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is False
    assert "a.status='possible'" in engine.connection.statement
    assert "r.status='submitted'" in engine.connection.statement
    assert "r.expires_at > clock_timestamp()" in engine.connection.statement


@pytest.mark.asyncio
async def test_changed_authority_or_experiment_never_consumes_claim(monkeypatch):
    engine = Engine()
    repo = FinanceRepository(engine)
    async def lock(_conn, _scope):
        return {"admission_state": "open", "reconciliation_state": "clean",
                "observation_snapshot_hash": HASH, "policy_hash": POLICY,
                "authority_epoch": 2}
    monkeypatch.setattr(repo, "_lock", lock)
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is False
    assert engine.connection.claimed is False
    experiment = FinanceScope(environment="experiment", scope_id="exp",
                               strategy_account_id="account-a")
    assert await repo.claim_live_dispatch(experiment, **_args()) is False
    assert engine.begins == 1


@pytest.mark.asyncio
async def test_stopped_account_consumes_only_a_durable_reduce_only_exit(monkeypatch):
    class ExitConnection(Connection):
        def __init__(self, has_exit):
            super().__init__()
            self.has_exit = has_exit
        async def execute(self, statement, params):
            if "finance_live_uniswap_exit_bindings" in str(statement):
                assert "c.receipt_json->>'action'='spot_sell'" in str(statement)
                return Result(("exit",) if self.has_exit else None)
            return await super().execute(statement, params)

    async def lock(_conn, _scope):
        return {"admission_state": "stopped", "reconciliation_state": "clean",
                "observation_snapshot_hash": HASH, "policy_hash": POLICY,
                "authority_epoch": 1}

    blocked = Engine()
    blocked.connection = ExitConnection(False)
    repo = FinanceRepository(blocked)
    monkeypatch.setattr(repo, "_lock", lock)
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is False
    assert blocked.connection.claimed is False

    allowed = Engine()
    allowed.connection = ExitConnection(True)
    repo = FinanceRepository(allowed)
    monkeypatch.setattr(repo, "_lock", lock)
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is True
    assert await repo.claim_live_dispatch(SCOPE, **_args()) is False
