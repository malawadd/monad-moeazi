# Strategy marketplace and funding-placement revision

Updated 11 October 2026. This revision responds to the V4 user captures and
supersedes the earlier proposal for a saved workflow draft/cart and repeat
top-up shortcuts on both Home and Settings. The offline preview has no cart or
workflow-draft UI. Perpl deterministic is the required base strategy; optional
module controls stay disabled unless a reviewed runtime is actually available.

## Before / after / why

| Before | After | Why |
|---|---|---|
| A funded Home still showed “Add test tokens”; Settings repeated the same action in a top card. | Show a Home top-up action only while it is an initial setup prerequisite. Once the user has the required test funds, remove it from Home. Put repeat top-ups at the bottom of Settings beside Receive and Send. | Keep Home focused on the initial next step and group repeat wallet actions together. Live eligibility, cooldown, receipt amount and repeat limits must still come from the service. |
| Manual Perpl asked for a typed deposit amount while the AUSD balance was zero, with no nearby way to fund it. | Offer common amounts first, put custom entry under a collapsed disclosure, and keep the funding path beside the empty-balance step. | A relevant prefill and visible prerequisite reduce recall without letting the prototype invent live limits. |
| Duration used a native-looking slider and the selected value competed with slider chrome. | Use 10 min, 30 min, 2 hr, 6 hr and 12 hr presets; put custom whole-number minutes under a closed-by-default disclosure, with inline 10–720 validation. | Presets make common, service-valid choices scannable. A numeric field stays precise and keyboard-accessible; the slider was rejected for this bounded duration. |
| Strategy discovery suggested users could collect deterministic, agentic and community items in a cart/draft before review. | Perpl deterministic is always included and cannot be disabled. It opens the existing guarded setup. Optional modules have their own Enable/Disable control only when a service-backed runtime is available; current Agentic and community controls are disabled and labeled Coming soon/concept. | The required execution base must remain clear. A cart implied unsupported multi-module composition and execution, so it is removed. Discovery and actual enablement remain separate. |
| Funding and authorization showed dense detail as repeated alarm-style warnings and long request copy. | Use calm, concise language. Keep asset/amount, destination or actor, permission, duration and material costs visible in the summary; put exact methodology and secondary terms behind named disclosures. Avoid repeating generic risk language. | Apple Pay guidance favors short line items and concise, non-duplicative agreements. GOV.UK reserves its warning component for important consequences; applying that threshold to routine status is an inference. Essential authority/costs remain visible without an alarm-like wall. |

The first two rows retain the V3 feedback about an empty-balance deposit prompt
and funding visibility, updated by the V4 placement clarification. V4 screenshots
show an unwanted top-up on funded Home, an unwanted top card in Settings, the
preferred Receive/Send destination for repeated wallet actions, and overlap in
the previous marketplace cart. Their original viewport, capture date and app
state are unknown; they are feedback, not usability-study results. See the
[evidence manifest](reader.html?doc=evidence/README.md).

## Required base and optional modules

The local preview contains three deliberately distinct entries:

- **Perpl deterministic — Moeazi Team:** the required, always-included
  fixed-rule Perpl strategy. It cannot be disabled. **Set up strategy** opens
  the existing guarded Perpl setup; active or unresolved runs show their status
  and a route to the appropriate status/recovery screen.
- **Agentic strategy — Moeazi Team:** a planned analysis concept. Its Enable
  switch is disabled and labeled Coming soon. It has no live model, runtime,
  trading permission or direct setup action. The planned 2% fee applies only to
  a future positive net-realized-profit concept; it is not charged now.
- **Community market context — illustrative:** a sample research-input concept,
  not an actual submission, named creator or endorsement. Its Enable switch is
  disabled. It has no data source, rules, review record, runtime or result
  history.

The unavailable performance values display as em dashes, never zero. “Lifetime
users” is shown as unavailable because production records count unique activated
wallets, not identified people, and the API does not provide the start date
needed to confirm an all-time range. “Lifetime P&amp;L” is also unavailable here.
Production net realized AUSD PnL covers finalized cycles, excludes open-position
PnL and unsigned/failed setup attempts, and does not include operator gas paid
in MON. The API exposes no period start; it must not be relabeled as lifetime or
total profit after all fees. The listing note says only “Stats not available
yet”; precise definitions stay in the disclosure/research notes.

Current source files reviewed: [`strategyRoutes.ts`](../../backend/api-server/src/monad/strategyRoutes.ts),
[`monadStrategyCatalog.ts`](../../backend/convex/monadStrategyCatalog.ts), and
[`strategies.ts`](../../src/types/strategies.ts). Catalog publication and metric
semantics remain governed by those service/type contracts.

## Optional-module enablement boundary

Perpl remains the only strategy with an available guarded setup. Current Agentic
and community controls have no action handler; their disabled state is not a
saved preference or backend enrollment. There is no local cart, draft, combined
review or composed execution action.

Before an optional module can be enabled, a separately reviewed service contract
must define:

- a versioned module manifest, compatibility rules, verified creator identity
  and community submission, licensing, review and removal policy;
- the module role, inputs/outputs, failure behavior and whether it can influence
  any execution decision;
- server-enforced owner authority, exact assets/venue/limits, expiry, stop,
  revoke and recovery rules for any module that can affect funds or execution;
- a current review tied to the exact permission and idempotent operation
  status/reconciliation when enablement changes on-chain authority;
- metric source, period start/end, asset/unit, inclusion rules and verification
  status. “Lifetime” needs an explicit record boundary, not a label inferred
  from a cumulative-looking count.

Never let an unavailable module appear active, infer a real creator from an
illustrative sample, or let a UI toggle create permission without service
approval.

## Evidence and verification status

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Four user-supplied V4 feedback images | Top-up placement preferences and an overlap problem in the earlier marketplace cart. | Viewport, capture date, task completion, preference strength or comprehension. |
| Production strategy catalog and metric source | Current strategy names/kinds/statuses and fields available for reporting. | That this offline preview receives live catalog/metric data or a planned entry is executable. |
| Pure Node renderer/reducer/view/journey/guard checks, when listed in the [validation log](reader.html?doc=validation.md) | Deterministic fixture transitions and source-level assertions. | Pixel fit, CSS appearance, native wallet/provider behavior, accessibility conformance or human comprehension. |

The current revision passes all nine documented Node/source checks, including
the updated funding and required-base marketplace suite. It has not received a
browser/native visual pass or human validation. See the [validation log](reader.html?doc=validation.md)
and [contemporary patterns](reader.html?doc=contemporary-patterns.md) for the
test scope, dated official sources and evidence boundaries.
