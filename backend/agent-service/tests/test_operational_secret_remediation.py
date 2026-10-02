from datetime import datetime, timedelta, timezone
import pytest
from moeazi_agent.operational_secret_contracts import digest
from moeazi_agent.operational_secret_evaluator import envelope_metadata
from moeazi_agent.operational_secret_fake_vault import FakeVault
from moeazi_agent.operational_secret_operations import build_access_request, build_descriptor
from moeazi_agent.operational_secret_storage import MemoryOperationalSecretRepository

TENANT="tenant_aaaaaaaaaaaaaaaa:account_bbbbbbbbbbbbbbbb"

@pytest.mark.asyncio
async def test_descriptor_swap_and_canonical_request_tamper_cannot_release_fixture_plaintext():
    now=datetime.now(timezone.utc); vault=FakeVault(environment="test",frozen_lease=True,development_gates_closed=True,fixture_id="osc-remediation",fake_keks={1:bytes.fromhex("11"*32)})
    descriptor=build_descriptor(seed="remediation",tenant_scope=TENANT,class_id="internal_service_auth",source_owner="platform")
    expires=now+timedelta(minutes=2); handle=vault.store_fixture(descriptor,b"sealed",expires)
    request=build_access_request(descriptor=descriptor,purpose="service_auth",consumer_id="service_auth_boundary",consumer_version="v1",capability="authenticate_service",aad_hash=digest(envelope_metadata(descriptor,expires)),idempotency_key="remediation:descriptor",requested_at=now)
    swapped=request.model_copy(update={"descriptor_id":"osc_"+"f"*48})
    with pytest.raises(PermissionError): await vault.access(handle,swapped,MemoryOperationalSecretRepository(),lambda _:None,now)
    with pytest.raises(ValueError): request.__class__(**(request.model_dump()|{"request_hash":"f"*64}))

@pytest.mark.asyncio
async def test_receipt_cannot_cross_bind_an_authorized_decision():
    now=datetime.now(timezone.utc); vault=FakeVault(environment="test",frozen_lease=True,development_gates_closed=True,fixture_id="osc-receipt",fake_keks={1:bytes.fromhex("11"*32)})
    descriptor=build_descriptor(seed="receipt",tenant_scope=TENANT,class_id="internal_service_auth",source_owner="platform"); expires=now+timedelta(minutes=2)
    handle=vault.store_fixture(descriptor,b"sealed",expires); request=build_access_request(descriptor=descriptor,purpose="service_auth",consumer_id="service_auth_boundary",consumer_version="v1",capability="authenticate_service",aad_hash=digest(envelope_metadata(descriptor,expires)),idempotency_key="remediation:receipt",requested_at=now)
    repository=MemoryOperationalSecretRepository(); await vault.access(handle,request,repository,lambda _:None,now)
    terminal=repository.receipts[-1].model_copy(update={"tenant_scope":"tenant_cccccccccccccccc:account_dddddddddddddddd"})
    with pytest.raises(RuntimeError,match="identity mismatch"): await repository.append_terminal(terminal)
