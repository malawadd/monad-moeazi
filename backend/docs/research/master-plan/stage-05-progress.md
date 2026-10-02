# Stage 5 grounding preparation

This is an early local slice under [Stage 5](stages-05-06.md), not a Q6–Q9
qualification. Q5's connected experiment gate remains open.

Ordinary specialist orchestration and Evaluation v2 previously replaced the
model's selected citations with every supplied evidence reference. That concealed
empty or invented selections. Both paths now resolve only model-selected IDs to
canonical supplied `EvidenceRef` records. They ignore model-supplied source metadata,
deduplicate repeated valid IDs, preserve raw selected and invalid IDs in structured
call evidence, and neutralize stance, score, and confidence when an ID cannot be
resolved. Provider token and cost usage remain recorded after such a response.

Evaluation v2 labels ID resolution as `exact_id_only` and citation qualification
as `unqualified`; its validation records invalid-ID flags. These checks establish
reference identity, not whether the source actually supports a claim, whether a
number is correct, or whether information was available at decision time. No
provider-backed comparison, semantic claim adjudication, or strategy value test
has run. The full Evaluation v2 function path was not integration-tested in this
slice; its helper and existing Evaluation Lab regressions were tested offline.

Focused Python tests passed 37/37 across citation resolution, ordinary orchestration,
and existing Evaluation Lab suites. Independent Luna XHigh review found no core
provenance, usage-accounting, or execution-authority blocker in this narrow change.
The next Stage 5 main path still requires frozen experiment outcomes and the
pre-registered deterministic/agent comparisons in the master brief.
