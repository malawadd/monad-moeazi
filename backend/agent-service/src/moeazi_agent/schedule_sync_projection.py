from __future__ import annotations
from .schedule_sync_result_contracts import ScheduleSyncProjection
def safe_projection(graph):
 transitions=graph["transitions"]; state=graph["state"]
 return ScheduleSyncProjection(int(bool(transitions)),int(not transitions),len(state.markets),graph["actual"].schedule_count,sum(x.status=="retry_wait" for x in transitions),sum(x.status=="superseded" for x in transitions),sum(x.status=="dead_letter" for x in transitions),graph["actual"].actual_hash,graph["root"].root_hash).safe()
