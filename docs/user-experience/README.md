# Moeazi user experience research hub

Open the local research hub from the repository root:

```powershell
py docs/user-experience/serve-preview.py
```

Then open `http://127.0.0.1:8765/user-experience/`. Stop the server with `Ctrl+C`.
The hub is static HTML, CSS, JavaScript modules, Markdown and local font files;
it has no build step and uses simulated data in the clickable prototype. It does
not call Moeazi services or submit transactions.

Run the local structural and fixture checks from the repository root:

```powershell
node docs/user-experience/verify-hub.mjs
node docs/user-experience/prototype-test.mjs
node docs/user-experience/verify-prototype-views.mjs
node docs/user-experience/verify-v2-journeys.mjs
node docs/user-experience/verify-v2-controller.mjs
node docs/user-experience/verify-v2-guards.mjs
node docs/user-experience/prototype-consent-test.mjs
node docs/user-experience/verify-v2-layout-consent.mjs
node docs/user-experience/verify-v3-funding-workflow.mjs
node docs/user-experience/verify-theme.mjs
node docs/user-experience/verify-theme-contrast.mjs
```

Current offline verification passes all 11 Node commands listed above:
9 reducer fixtures, 16 view checks, 11 journey checks, 7 guard checks, consent,
layout/consent, controller, the funding-and-required-strategy suite, two theme
checks, and hub structure (62 text files ≤300 lines; 35 historical destinations;
34 current stack bindings and five mode-aware tabs). The theme
checks cover preference isolation, rendered SVG tokens, 40 used text-role pairs,
and essential boundary pairs in the five palettes. These inspect local sources,
simulated state and minimal DOM wiring; they do not launch a browser or native
Android app and do not establish visual quality or human comprehension. See the
[versioned validation log](reader.html?doc=validation.md) and
[required-base/module-availability decision note](reader.html?doc=marketplace-revision.md).

Start with [index.html](index.html). The [prototype](prototype.html) is a design
artifact. The local [document reader](reader.html?doc=research-notes.md) renders
the route audit, research notes, contemporary-source ledger, interaction
coverage matrix, screen specs, implementation backlog, moderated study script,
findings report, validation report, marketplace revision and evidence manifest
inside the hub.

The prototype offers five phone-only appearance presets in Settings → Appearance.
The selected theme is stored separately from the practice session; it does not
change account state or apply to the research hub/reviewer panel. Run
`node docs/user-experience/verify-theme.mjs` and
`node docs/user-experience/verify-theme-contrast.mjs` for preference, picker,
and palette-role checks. Native radio keyboard interaction and browser visual
review at 320, 393 and 430 px remain pending; no browser or native visual review
was performed.

Research was checked 11 October 2026. Competitor patterns come from first-party
product announcements, official support pages, developer docs and platform
guidance; no competitor app was installed or directly observed. Dates separate
2026 releases from older platform foundations and undated current pages. Four
V1 feedback screenshots supersede prior broad V1 completeness wording. Three
V2 feedback screenshots show unresolved market wrapping and dense authorization
surfaces. Four V3 feedback screenshots add alarm-copy, funding-visibility and
zero-balance deposit-entry concerns. Four V4 screenshots supersede the earlier
top-up-everywhere and marketplace-cart recommendations: initial top-up belongs
on Home only while required; repeat top-ups belong beside Receive/Send at the
bottom of Settings; Perpl is the required base and optional module controls are
disabled until available. The latest revision has not been visually verified.
No novice session has been conducted. Recommendations remain hypotheses for
later validation.

## Future production implementation

After the prototype is reviewed, implementation work should use GPT-6 Luna at
its highest supported reasoning effort (`max`). The supervising agent checks
service connections and runs the relevant verification. The current design
stage changes no production screens, backend APIs, trading gates or funded flows;
see the [prioritized backlog](reader.html?doc=implementation-backlog.md).
