"""Closed local policy; it is not a Temporal schedule adapter."""
from __future__ import annotations
from .schedule_sync_canonical import digest
VERSION="2026-09-10.feature-26-local-v1"
CADENCES=("on_demand","15m","5m","2m","1m")
LIFECYCLES=("draft","active","paused","retired")
OPERATIONS=("freeze_desired_state","decide_material_change","append_command","claim_command","reconcile_fixture","acknowledge","retry","supersede","dead_letter","watchdog","replay","inspect")
TRANSITIONS={"pending":("dispatching","superseded","dead_letter"),"dispatching":("acknowledged","retry_wait","superseded","dead_letter"),"retry_wait":("dispatching","superseded","dead_letter"),"acknowledged":(),"superseded":(),"dead_letter":()}
MAX_ATTEMPTS=3
def registry_hash(): return digest({"version":VERSION,"cadences":CADENCES,"lifecycles":LIFECYCLES,"operations":OPERATIONS,"transitions":TRANSITIONS,"maxAttempts":MAX_ATTEMPTS})
