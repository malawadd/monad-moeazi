"""Pure no-silent-default compiler for checked-in typed mandates."""
from __future__ import annotations
from dataclasses import dataclass
from functools import lru_cache
from .mandate_policy_canonical import digest
from .mandate_policy_mandate_contracts import MandateSpec
from .mandate_policy_compilation_contracts import CompiledAutomationPolicyV1, ProfilePolicyBinding
from .mandate_policy_registry import POLICY_FIELDS, PROFILE_FIELDS, SCOPE_FIELDS, raw, registry_hash

class CompilationBlocked(ValueError): pass

@dataclass(frozen=True)
class Compilation:
    policy: dict; binding: dict; mappings: tuple[dict, ...]; coverage: tuple[dict, ...]
    manifest: dict; tests: dict; receipt: dict

def _default_hash(field: str, value: object) -> str:
    return digest({"field": field, "value": value, "registry": registry_hash()})

def _check_value(field: str, value: object, unit: str) -> None:
    meta = raw()["fields"][field]
    if unit != meta["unit"]: raise CompilationBlocked(f"invalid_unit:{field}")
    if meta["kind"] == "set":
        if not isinstance(value, tuple) or not value: raise CompilationBlocked(f"empty_set:{field}")
        allowed = raw()["markets"] if field == "allowedMarkets" else raw()["venues"] if field == "allowedVenues" else raw()["authorityModes"]
        if any(item not in allowed for item in value): raise CompilationBlocked(f"invalid_set_member:{field}")
    elif meta["kind"] in {"max", "min","time"} and (not isinstance(value, int) or isinstance(value, bool) or not raw()["bounds"][field][0]<=value<=raw()["bounds"][field][1]):
        raise CompilationBlocked(f"invalid_integer:{field}")
    elif meta["kind"] == "required" and not isinstance(value, bool): raise CompilationBlocked(f"invalid_boolean:{field}")
    elif field == "cadence" and value not in raw()["cadences"]: raise CompilationBlocked("invalid_cadence")

def _expected_operator(field: str) -> str:
    kind=raw()["fields"][field]["kind"]
    return {"set":"subset","max":"max","min":"min","required":"required","cadence":"exact"}[kind]

def _observed(field: str, value: object) -> bool:
    try: _check_value(field,value,raw()["fields"][field]["unit"]); return True
    except CompilationBlocked: return False
def _case(rows: list[dict], field: str, kind: str, value: object, expected: bool) -> None:
    observed=_observed(field,value); verdict=observed==expected
    rows.append({"caseId":f"{field}:{kind}","field":field,"caseKind":kind,"verdict":"pass" if verdict else "fail","caseHash":digest({"field":field,"case":kind,"value":value,"expected":expected,"observed":observed})})
def _run_cases(values: dict) -> tuple[dict, ...]:
    rows=[]
    for field,value in sorted(values.items()):
        meta=raw()["fields"][field]; kind=meta["kind"]
        if kind in {"max","min","time"}:
            lower,upper=raw()["bounds"][field]; _case(rows,field,"lower",lower,True); _case(rows,field,"equal",value,True); _case(rows,field,"upper",upper,True); _case(rows,field,"deny",lower-1,False); _case(rows,field,"deny",upper+1,False)
        elif kind=="set":
            _case(rows,field,"allow",value,True); _case(rows,field,"deny",("__invalid__",),False)
        elif kind=="required":
            _case(rows,field,"protective" if field.startswith("require") else "profile",value,True); _case(rows,field,"deny",1,False)
        elif kind=="cadence":
            _case(rows,field,"profile",value,True); _case(rows,field,"deny","weekly",False)
    chain_ok=raw()["chainId"]==42161; rows.append({"caseId":"scope:chain","field":"chainId","caseKind":"chain","verdict":"pass" if chain_ok else "fail","caseHash":digest({"chain":raw()["chainId"],"expected":42161,"observed":chain_ok})})
    if any(row["verdict"]!="pass" for row in rows): raise CompilationBlocked("frozen_policy_case_failed")
    return tuple(rows)

@lru_cache(maxsize=256)
def compile_mandate(mandate: MandateSpec) -> Compilation:
    registry = raw()
    if mandate.registry_version != registry["registryVersion"] or mandate.scope.chain_id != 42161:
        raise CompilationBlocked("registry_or_chain_mismatch")
    clauses = {item.field: item for item in mandate.clauses}
    if len(clauses) != len(mandate.clauses): raise CompilationBlocked("duplicate_conflicting_clause")
    default_rows = {item.field: item for item in mandate.explicit_defaults}
    values: dict = {}; coverage: list[dict] = []; mappings: list[dict] = []
    for field in POLICY_FIELDS + PROFILE_FIELDS:
        clause = clauses.get(field); accepted = default_rows.get(field)
        if bool(clause) == bool(accepted): raise CompilationBlocked(f"incomplete_or_ambiguous_coverage:{field}")
        if clause:
            if clause.operator != _expected_operator(field): raise CompilationBlocked(f"invalid_operator:{field}")
            _check_value(field, clause.value, clause.unit)
            values[field] = clause.value; mappings.append({"clauseId": clause.clause_id, "field": field,"operator":clause.operator,"unit":clause.unit,"outputHash": digest({"field": field,"value":clause.value})})
            coverage.append({"field": field,"source":"clause","sourceId":clause.clause_id,"valueHash":digest(clause.value)})
        else:
            expected = registry["fields"][field]
            expected_value = tuple(expected["default"]) if isinstance(expected["default"], list) else expected["default"]
            if accepted.unit != expected["unit"] or accepted.value != expected_value or accepted.registry_version != registry["registryVersion"] or accepted.source_default_hash != _default_hash(field, expected["default"]):
                raise CompilationBlocked(f"invalid_explicit_default:{field}")
            values[field] = accepted.value; coverage.append({"field":field,"source":"explicit_default","sourceId":accepted.source_default_hash,"valueHash":digest(accepted.value)})
    for field in SCOPE_FIELDS:
        value = int(mandate.scope.effective_at.timestamp() * 1000) if field == "effectiveAt" else int((mandate.scope.expires_at.timestamp() if mandate.scope.expires_at else 4102444800) * 1000)
        values[field] = value; coverage.append({"field":field,"source":"scope","sourceId":"scope","valueHash":digest(value)})
    if values["maxDailyLossUsd"] > values["maxExposureUsd"] or values["maxOrderUsd"] > values["maxDailyVolumeUsd"]:
        raise CompilationBlocked("cross_field_cap_contradiction")
    policy = {field: values[field] for field in POLICY_FIELDS}; policy_hash=digest(policy)
    try: CompiledAutomationPolicyV1(**policy,policy_hash=policy_hash)
    except ValueError as exc: raise CompilationBlocked(f"typed_policy_invalid:{exc}") from exc
    binding = {"allowed_authority_modes": values["allowedAuthorityModes"],"cadence":values["cadence"],"approval_required":values["approvalRequired"],"effective_at":mandate.scope.effective_at,"expires_at":mandate.scope.expires_at,"scope_hash":mandate.scope.scope_hash}
    binding_hash=digest(binding)
    try: ProfilePolicyBinding(**binding,binding_hash=binding_hash)
    except ValueError as exc: raise CompilationBlocked(f"typed_binding_invalid:{exc}") from exc
    mappings = tuple(sorted(mappings, key=lambda item: item["clauseId"])); coverage = tuple(sorted(coverage, key=lambda item:item["field"]))
    cases=_run_cases(values); case_hashes=tuple(row["caseHash"] for row in cases)
    manifest={"policyHash":policy_hash,"bindingHash":binding_hash,"cases":cases,"manifestHash":digest(cases)}; tests={"manifestHash":manifest["manifestHash"],"verdictHashes":case_hashes,"passed":True,"receiptHash":digest({"manifest":manifest["manifestHash"],"verdicts":case_hashes})}
    receipt={"scopeHash":mandate.scope.scope_hash,"mandateHash":mandate.mandate_hash,"predecessorHash":mandate.predecessor_hash,"policyHash":policy_hash,"bindingHash":binding_hash,"mapHash":digest(mappings),"coverageHash":digest(coverage),"testManifestHash":manifest["manifestHash"],"testHash":tests["receiptHash"],"compilerVersion":registry["compilerVersion"],"schemaVersion":mandate.schema_version,"registryHash":registry_hash()}
    return Compilation(policy,binding,mappings,coverage,manifest,tests,receipt)
