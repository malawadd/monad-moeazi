"""Closed Feature 24 fixture registry.  It never accepts caller-defined domains."""
from __future__ import annotations
import json
from functools import lru_cache
from hashlib import sha256
from importlib.resources import files

DOMAIN_IDS=("account-profile","strategy-agent-configuration","policies-approvals","credits-usage","analyses-evidence","proposals-execution","venues-positions","incidents-communications","contestation-corrections","public-chain-references")
def _pairs(pairs):
 d={}
 for k,v in pairs:
  if k in d: raise ValueError("portability_duplicate_json_key")
  d[k]=v
 return d
@lru_cache(maxsize=1)
def registry():
 raw=files("moeazi_agent").joinpath("portability_registry.json").read_text("utf-8")
 data=json.loads(raw,object_pairs_hook=_pairs)
 if data.get("version")!="2026-09-08.feature-24-local-v1" or tuple(x.get("id") for x in data.get("domains",[]))!=DOMAIN_IDS: raise ValueError("portability_registry_closure_invalid")
 if set(data.get("operations",[]))!={"request_export","plan_domain","snapshot_domain","omit_domain","assemble_package","verify_package","issue_delivery_grant","consume_delivery_grant","record_delivery","expire_delivery_grant","cleanup_package","inspect_export"}: raise ValueError("portability_registry_operations_invalid")
 return data
def registry_hash():
 return sha256(json.dumps(registry(),sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
def domain(domain_id):
 if domain_id not in DOMAIN_IDS: raise ValueError("portability_unknown_domain")
 return next(x for x in registry()["domains"] if x["id"]==domain_id)
