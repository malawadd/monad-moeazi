"""Independent Stage 1 identity and compatibility behavior checks."""

from hashlib import sha256
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from moeazi_agent.controller_contracts import (
    ControllerRef,
    customer_mode,
    customer_version_manifest,
    require_customer_binding,
    version_content_hash,
)
from moeazi_agent.execution_workflow import proposal_agreement_strength


CONFIG = '{"model":"m1","policy":"p1"}'
MANIFEST = customer_version_manifest("acct-a", "team-a", "ver-a", CONFIG)
CANONICAL = (
    '{"configJson":"{\\"model\\":\\"m1\\",\\"policy\\":\\"p1\\"}",'
    '"controllerKind":"customer_team","schemaVersion":1,'
    '"strategyAccountId":"acct-a","teamId":"team-a","teamVersionId":"ver-a"}'
)
HASH = sha256(("moeazi-controller-v1\n" + CANONICAL).encode()).hexdigest()
REF = {
    "schemaVersion": 1,
    "environment": "live",
    "strategyAccountId": "acct-a",
    "controllerKind": "customer_team",
    "controllerId": "deployment-a",
    "controllerVersionId": "ver-a",
    "contentHash": HASH,
}


def test_frozen_hash_is_canonical_and_sensitive_to_referenced_content():
    assert version_content_hash(MANIFEST) == HASH
    assert version_content_hash(dict(reversed(list(MANIFEST.items())))) == HASH
    assert version_content_hash({**MANIFEST, "configJson": CONFIG.replace("m1", "m2")}) != HASH
    assert version_content_hash({**MANIFEST, "configJson": CONFIG.replace("p1", "p2")}) != HASH


@pytest.mark.parametrize("bad", [None, 0.5, -0.0, 2**53])
def test_frozen_hash_rejects_noncanonical_values(bad):
    with pytest.raises((TypeError, ValueError)):
        version_content_hash({**MANIFEST, "schemaVersion": bad})


def test_controller_ref_rejects_wrong_schema_environment_and_unknown_fields():
    assert ControllerRef.model_validate(REF).controllerId == "deployment-a"
    for modified in (
        {**REF, "schemaVersion": True},
        {**REF, "schemaVersion": 2},
        {**REF, "environment": "simulated"},
        {**REF, "extra": "customer-supplied"},
    ):
        with pytest.raises(ValidationError):
            ControllerRef.model_validate(modified)


def test_legacy_payload_requires_complete_explicit_identity_and_authoritative_match():
    aliases = {"account_id": "acct-a", "team_id": "team-a",
               "team_version_id": "ver-a", "deployment_id": "deployment-a"}
    assert require_customer_binding(aliases, REF, allow_legacy=True, team_id="team-a").contentHash == HASH
    with pytest.raises(ValueError, match="incomplete"):
        require_customer_binding({k: v for k, v in aliases.items() if k != "team_id"},
                                 REF, allow_legacy=True, team_id="team-a")
    with pytest.raises(ValueError):
        require_customer_binding(aliases, None, allow_legacy=True, team_id="team-a")
    with pytest.raises(ValueError, match="mismatch"):
        require_customer_binding({**aliases, "team_id": "other-team"},
                                 REF, allow_legacy=True, team_id="team-a")
    with pytest.raises(ValueError, match="differs"):
        require_customer_binding({**aliases, "controllerRef": {**REF, "environment": "experiment"}},
                                 REF, team_id="team-a")


def test_customer_modes_preserve_shadow_approval_and_autopilot():
    assert customer_mode("insights") == "shadow"
    assert customer_mode("shadow") == "shadow"
    assert customer_mode("approval_required") == "approval_required"
    assert customer_mode("autopilot") == "autopilot"
    with pytest.raises(ValueError):
        customer_mode("approval")


def test_bearish_direction_stays_signed_while_agreement_is_nonnegative():
    short = SimpleNamespace(side="short")
    long = SimpleNamespace(side="long")
    row = {"consensus": -0.72, "agreementStrength": 0.72, "controllerRef": REF}
    assert proposal_agreement_strength(row, short) == pytest.approx(0.72)
    assert row["consensus"] == -0.72
    with pytest.raises(ValueError, match="direction"):
        proposal_agreement_strength(row, long)
    with pytest.raises(ValueError, match="strength"):
        proposal_agreement_strength({**row, "agreementStrength": 0.0}, short)
