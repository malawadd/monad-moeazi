# Future Design

## Contracts

`SafetyIncidentRevisionRef`, `IncidentCommunicationPolicy`,
`IncidentAudienceResolution`, `IncidentMessage`, `IncidentDispatchOutboxRow`,
`IncidentDeliveryReceipt`, `IncidentAcknowledgementReceipt`,
`IncidentEscalationDecision`, and `IncidentResolutionCommunication` are strict.
Dispatch identity is `(incident_id, revision, audience_id, template_version, channel)`.

## Ownership and flow

Dependency Safety owns canonical incident/latch/recovery. The Convex mutation publishing
a revision atomically inserts the communication intent and owns current inbox/banner/
ack projection. Temporal owns retries/deadlines/escalation; Timescale immutable message,
delivery, ack and escalation history; Redis ephemeral UI fan-out only. No Convex job
polling.

`incidentEvents.status=acknowledged` remains operator triage or is renamed; customer
message acknowledgement is a separate receipt. It cannot release a latch, resume
trading, widen authority or satisfy approval.

Every material change creates a new immutable message; delayed old revisions become
superseded. Deterministic templates expose allowlisted customer-safe facts only. No
LLM copy/selection, keys, credentials, stacks, exploit detail, cross-tenant data or
hidden reasoning. Notification failure never weakens safety or blocks emergency work.

## Rollout, cost and rollback

Begin with Shadow `would_send`, then durable in-app display/ack, accessibility and
local drills. External providers are held pending explicit cost/privacy approval.
Rollback preserves incident visibility and immutable receipts while disabling new
external dispatch; it never reverts to best-effort fan-out.

The implemented scope is an isolated Test Center proof. Convex current projections,
Temporal retry/deadline ownership, authoritative audiences, and all external channels
remain future gated work.
