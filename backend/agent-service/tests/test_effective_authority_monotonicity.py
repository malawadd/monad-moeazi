"""Fixed-seed adversarial reducer properties for the local-only fixture."""
from random import Random

from moeazi_agent.effective_authority_reducer import ORDER, reduce
from moeazi_agent.effective_authority_registry import required_gate_ids
from moeazi_agent.effective_authority_scenarios import NOW, _gate, _hash, _request


def _replace(rows, replacement):
    return tuple(replacement if row.gate_id == replacement.gate_id else row for row in rows)


def _adverse(case, rows, request, target):
    if case == 0:
        return _replace(rows, _gate(target, request, 1, "fail"))
    if case == 1:
        return _replace(rows, _gate(target, request, 1, "unknown"))
    if case == 2:
        return tuple(row for row in rows if row.gate_id != target)
    if case == 3:
        return _replace(rows, _gate(target, request, 1, source_version="fixture-v0"))
    if case == 4:
        return _replace(rows, _gate(target, request, 1, provenance="authoritative_product"))
    if case == 5:
        return (*rows, _gate(target, request, 1, receipt_salt="fork"))
    return _replace(rows, _gate(target, request, 2, predecessor_hash=_hash("rollback")))


def test_ten_thousand_fixed_seed_adverse_sets_never_increase_or_submit():
    rng = Random(19031)
    request = _request(True)
    ids = required_gate_ids()
    baseline_rows = tuple(_gate(gate_id, request, 1) for gate_id in ids)
    baseline = reduce(request, baseline_rows, "Autopilot", NOW)
    for index in range(10_000):
        target = ids[rng.randrange(len(ids))]
        rows = _adverse(index % 7, baseline_rows, request, target)
        now = NOW if index % 8 else NOW.replace(minute=NOW.minute + 6)
        after = reduce(request, tuple(rng.sample(rows, len(rows))), "Autopilot", now)
        assert ORDER[after.capability] <= ORDER[baseline.capability]
        assert after.capability != "SUBMISSION_ELIGIBLE"


def test_permutation_and_hash_closure_are_stable_for_identical_inputs():
    request = _request(True)
    rows = tuple(_gate(gate_id, request, 1) for gate_id in required_gate_ids())
    original = reduce(request, rows, "Autopilot", NOW)
    for seed in range(50):
        shuffled = list(rows)
        Random(seed).shuffle(shuffled)
        assert reduce(request, tuple(shuffled), "Autopilot", NOW).decision_hash == original.decision_hash
