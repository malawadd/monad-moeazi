# Findings and validation status

Updated 11 October 2026. This report separates repository/emulator findings,
historical fixture checks, design hypotheses and future human validation.
Four V1 review images identify a context-free chart, off-brand duration slider,
oversized status glossary, gray demo run card and missing subpage/signing
coverage. Three V2 images then identify market-name wrapping and dense
review/provider surfaces. Four V3 images call out alarm wording, funding
visibility/action placement and a zero-balance manual deposit prompt. Four V4
images supersede the earlier persistent top-up and marketplace-cart decisions:
Home top-up only for the initial prerequisite, repeat top-ups beside
Receive/Send at the bottom of Settings, and no cart. All are user feedback
captures with unknown original viewport/date, not study results.

All nine current Node/source/reducer checks pass. Earlier validation claims do
not establish the visual success of these changes. No visual pass is recorded;
the supervisor's local browser review attempt was blocked by the CUA URL policy.

The current required-base/module-availability and funding-placement revision
passes its documented fixture, source, controller, consent and structural
checks. Browser visual, native handoff, full accessibility and human
comprehension remain pending; source assertions do not resolve those questions.

## Source and emulator findings

- The authenticated navigation graph declares the `Main` shell plus 28 stack
  destinations and five nested tabs; Welcome is the signed-out route. The full
  graph has 35 route bindings including Main, with two aliases (AgentStatus and
  PerplMarkets) among 32 screen component files. See the [route audit](reader.html?doc=route-audit.md).
- Home has a testnet asset list, owner/observed block metadata and multiple
  stacked actions. The screenshot records MON, AUSD, USDC and WMON balances.
- Funding includes external faucet links and a Mera-reviewed in-app Agora AUSD
  claim. Successful arrival must be determined from a verified balance/receipt,
  not from opening an external site.
- Strategies and Perpl setup expose complex venue/optimizer/mandate information.
  The direct deterministic optimizer uses fixed 100 AUSD; service terms govern
  duration/venue bounds. Planned-loss is a target, not a loss guarantee.
- Perpl balances and PnL values may be absent. Stop, settlement, return and
  recovery are distinct operational states.
- Seven Android captures are available. They do not cover every screen or state;
  some are mid-scroll and Perpl Setup has a debugger overlay.
- Competitor apps were not installed. Official product help pages were reviewed
  and are labeled documented, not directly observed.
- The production catalog distinguishes an available Perpl deterministic
  strategy from a planned agentic concept. The community module in the prototype
  is illustrative, not a real creator submission. Production metrics count
  unique activated wallets (not people) and finalized realized AUSD cycles; the
  API exposes no start date for an all-time label. See the
  [marketplace decision note](reader.html?doc=marketplace-revision.md).

## Design hypotheses

1. A balance-first Home and one context-sensitive next action will help a novice
   understand where they are and how to begin.
2. A short faucet → AUSD → strategy checklist will make testnet prerequisites
   clearer while preserving accurate confirmation.
3. Four tabs plus a settings entry will be easier to learn than five equal tabs
   and a long Home action list.
4. A visual signing summary with expandable technical evidence will improve
   comprehension without removing proof or validation.
5. Separate stop, settlement and returned-balance labels will prevent false
   expectations during an active run.
6. Showing Perpl deterministic as the required base and keeping each optional
   module's availability beside its own Enable control can make current and
   planned capability easier to compare. The current Agentic/community controls
   stay disabled until service-backed runtimes are available.

These are proposals, not measured outcomes. Source mapping is in
  [research notes](reader.html?doc=research-notes.md); decisions and validation
  questions appear in the [hub](index.html#decisions).

## Historical V1 fixture checks

- The prior V1 Chrome walkthrough exercised simulated funding, autonomy start/settlement,
  Spot swap, manual Perpl, recovery and mode switching. The exact fixture paths
  and values are recorded in the [validation log](reader.html?doc=validation.md).
- The faucet handoff alone leaves MON at zero; a separate simulated arrival is
  required before the demo AUSD claim. AUSD appears only after the simulated
  confirmed state, exactly once.
- Error fixtures distinguish “Nothing sent,” “Nothing submitted,” and “check
  the same operation”; offline/stale amounts are labeled LAST KNOWN.
- Small-phone checks sampled 320 × 740 at normal and 200% text, ≥48 px Home
  controls, reduced motion, visible keyboard focus and two contrast pairs.
  These checks do not establish full WCAG conformance or native accessibility.
- The historical reducer and view verifier suites passed. These prove fixture
  transitions and registered route handlers at that version; the supplied
  screenshots show that they did not establish clear screen hierarchy, complete
  subpage/signing coverage or beginner comprehension.
- Live manual quotes and liquidation data remain unavailable placeholders;
  simulated trading results are not evidence of executable quotes or returns.

## Human validation

**Pending.** No novice participants have been recruited or tested. There are no
completion rates, task timings or user quotes. Use the
[moderator script](reader.html?doc=study-plan.md), then update this section only from recorded
sessions. Target: four of five uncoached completions on each critical flow.

## Limits

The baseline is selected Android screenshots plus repository source. It is not
a full audit of visual states, live error behavior, iOS layout, app store
competitor builds or all keyboard/accessibility combinations. Official help
pages do not establish what a current installed competitor app looks like.
Prototype values are fictional and no trade execution is represented.
