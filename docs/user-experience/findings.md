# Findings and validation status

Updated 11 October 2026. This report separates repository/emulator findings,
simulated prototype verification, design hypotheses and future human validation.

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

These are proposals, not measured outcomes. Source mapping is in
  [research notes](reader.html?doc=research-notes.md); decisions and validation
  questions appear in the [hub](index.html#decisions).

## Prototype verification findings

- Chrome walkthroughs exercised simulated funding, autonomy start/settlement,
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
- The reducer and view verifier suites passed. These prove fixture transitions
  and route/handler coverage, not that beginners understand the screens.
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
