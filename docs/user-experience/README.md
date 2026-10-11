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
```

These checks cover source/link integrity and simulated state transitions; they
do not launch the native Android app or replace human usability testing. See the
[validation log](reader.html?doc=validation.md) for tested Chrome viewports,
flows, limits and current results.

Start with [index.html](index.html). The [prototype](prototype.html) is a design
artifact. The local [document reader](reader.html?doc=research-notes.md) renders
the route audit, research notes, screen specs, implementation backlog, moderated
study script, findings report, validation report and evidence manifest inside
the hub.

All research status is current to 11 October 2026. Competitor behavior is based
on official help pages; no competitor app was installed or directly observed.
No novice sessions have been conducted. The research makes recommendations and
records hypotheses for later validation.

## Future production implementation

After the prototype is reviewed, implementation work should use GPT-6 Luna at
its highest supported reasoning effort (`max`). The supervising agent checks
service connections and runs the relevant verification. The current design
stage changes no production screens, backend APIs, trading gates or funded flows;
see the [prioritized backlog](reader.html?doc=implementation-backlog.md).
