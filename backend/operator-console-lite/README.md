# Moeazi lightweight operator console

A dependency-free HTML/CSS/JavaScript console served by Node's built-in HTTP server. It binds only to `127.0.0.1:3104`, lists frozen programs created by the signed-in research operator plus Moeazi's internal mobile program, shows frozen agent model routes and backend credential presence, lists account-owned experiment specs, and can read selected run status and outcomes for a cautious lineage comparison. A collapsed advanced panel exposes the rest of the fixed operation allowlist.

Start the app on port `3102`, sign in at `http://127.0.0.1:3102`, then start the console in another terminal:

```powershell
powershell -NoProfile -File scripts/open-operator-console-lite.ps1
```

The script starts the loopback server and opens `http://127.0.0.1:3104` in your default browser. Use `-NoBrowser` to start it without opening a tab. Stop only the console with `powershell -NoProfile -File scripts/stop-operator-console-lite.ps1`. Keep the same hostname for sign-in and the console so the browser sends the Moeazi session cookie. The browser never supplies a destination URL, upstream header, or operator identity. The local proxy forwards only the session cookie. Next verifies the signed session; Convex enforces operator authority for program edits and accepts operators for research operations. Mutation requests are same-origin checked, request bodies and responses are bounded, and payloads cannot provide a subject field.

The program API returns up to 50 owned programs and the internal mobile program, with their latest 20 frozen versions, summarized team configuration, frozen policy, and model routes. The credential cards show what the agent runtime has loaded. Their key forms save a Moeazi-owned OpenAI, DeepSeek, or OpenRouter key only to the ignored local `.env.agents.monad` file, then recreate the analysis API and workers to load it. The key goes from the browser to the loopback console server, never to Convex or the Next app; the server checks the signed-in subject's Convex operator role before writing. No provider call or balance check occurs when saving a key.

An operator can select models for every internal mobile agent role and save a frozen candidate. An OpenRouter selection requires `author/model` and is checked against OpenRouter's endpoint metadata for strict structured-output support and maximum listed price without making a paid model call. Releasing a compatible candidate changes the models for **new analysis jobs**, including already funded accounts. Existing jobs, assignments, signed mandates, and vaults keep their original bindings. The console release does not change the authority version selected for new mobile enrollment; that remains configured separately by `MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID`. The experiment-spec API returns up to 50 owned specs. The console does not implement wallet, signing, venue, or trading logic. Backend authority and simulation constraints govern each request.

The development controls show the current Redis-backed Lite Mode state and can switch it on or off without changing Manual Guard or live execution. Turning Lite Mode off can increase provider calls and spending. The separate Convex-backed test-credit switch pauses **app-credit charging for new analysis reservations**; existing reservations keep their original charging state. It does not make model-provider calls free, and an available app-credit balance is still needed to start. Both controls default to their ordinary behavior when development controls are disabled.

The credit form searches by email (case-insensitive), Magic wallet, or exact Convex user ID. It lists every matching account, including duplicate email records, with the ledger balance and wallet when present. The operator explicitly selects one account before granting any positive safe-integer number of **app credits**. Grants are recorded in Convex's credit ledger with an idempotent request ID. No USDC or venue balance changes. Email lookup is a bounded operator-only scan of up to 1,001 user records because existing emails were saved with inconsistent capitalization; a limit warning means the operator must use wallet or user ID rather than assume the list is complete.

Run the focused proxy-input tests with:

```powershell
npm --prefix operator-console-lite test
```
