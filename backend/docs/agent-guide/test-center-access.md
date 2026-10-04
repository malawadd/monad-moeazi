# Test Center Access

The Agentic Safety Test Center is a local-only, authenticated surface for checked-in
synthetic scenarios. It cannot activate product features, contact providers, sign,
broadcast, deploy, or perform external network mutations.

Feature 20 is default-off and requires the local effective-authority fixture control;
its results remain product unavailable and dispatch unavailable.

## Correct address

Open:

```text
http://127.0.0.1:3102/agent-lab/test-center
```

The legacy `/agent-lab` root is intentionally disabled and returns `404`. It is not
an alternate Test Center address.

## Access requirements

Access succeeds only when all of these conditions are true:

1. The frontend and isolated Test Center backend are running.
2. `AGENT_TEST_CENTER_ENABLED=true` is effective in both processes.
3. The user has a valid Moeazi Particle or Magic session cookie.
4. The exact verified session subject is present in
   `TEST_CENTER_OPERATOR_SUBJECTS`.
5. `TEST_CENTER_REPOSITORY_SHA` is the current reviewed 40-character Git SHA.
6. The Test Center backend is reachable only through loopback HTTP.
7. Manual Guard and Lite Mode remain on; live execution, mainnet setup, certified
   venues, and external Test Center networking remain off.

## Find the subject safely

Sign in normally. In the browser developer tools, inspect the successful response
from either `/api/auth/session` or `/api/auth/wallet-session` and copy only:

```json
{ "session": { "subject": "<copy-this-value>" } }
```

Typical subjects look like:

```text
particle:0x...
magic:0x...
```

The value is exact and case-sensitive after the provider prefix. The wallet address
created by the current sign-in routes is normalized to lowercase.

Never copy a JWT, Particle access token, signature, email address, cookie, wallet
secret, or complete session response into an environment file, issue, commit, log,
or chat. If a session token is exposed, sign out and sign back in to rotate it. The
stable subject remains allowlisted after token rotation.

## Local configuration

Keep local values in an ignored environment file. Do not commit the operator list.

```text
AGENT_TEST_CENTER_ENABLED=true
TEST_CENTER_OPERATOR_SUBJECTS=<verified-session-subject>
TEST_CENTER_REPOSITORY_SHA=<current-git-sha>
TEST_CENTER_API_URL=http://127.0.0.1:9110
```

Generate the repository binding locally:

```powershell
git rev-parse HEAD
```

Multiple operators use a comma-separated exact allowlist:

```text
TEST_CENTER_OPERATOR_SUBJECTS=particle:0x...,magic:0x...
```

The same `WORKER_SHARED_SECRET` must already be available to Next.js and the
isolated backend. Do not print or duplicate it while configuring access.

Environment values are read at process startup. Restart the frontend and Test Center
backend after changing the flag, subject list, repository SHA, backend URL, or shared
secret.

## Start and verify

Start the normal local infrastructure as described in [Runtime and
operations](runtime.md), then start the Compose `test-center` profile. The Test
Center process must stay on `test-center-runtime`; do not attach it to an
internet-capable network to make the UI reachable.

Verify the two local listeners:

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3102, 9110 }
```

Expected boundaries:

- `3102`: Next.js product frontend.
- `9110`: loopback-only Test Center backend or loopback bridge.
- The Test Center service itself: internal Docker network only.

Then sign in and open the correct address. An unauthenticated request should redirect
to `/sign-in?redirect=/agent-lab/test-center`; it should not expose backend data.

## Enabling features

Every control lease defaults to `off` and expires after at most two hours. Start with
Feature 01. Features with prerequisites can be enabled only after their required
features are effective through the same layers.

```text
01 Dependency Safety Envelope → later dependency-bound features
```

Use `observe` first. `enforce` is synthetic and isolated to the Test Center; it does
not enable product authority. Redis loss, an expired lease, a stale registry binding,
or persistence failure restores conservative defaults.

Feature 14 requires the exact local Feature 02 and Feature 11 control ancestry. Its
termination scenarios are fixture-only: “automation stopped” never means a product
schedule, order, position, credential, asset, or authority was changed.

## Troubleshooting

| Symptom | Meaning and first check |
| --- | --- |
| `/agent-lab` returns `404` | Expected. Use `/agent-lab/test-center`. |
| Test Center page returns `404` | Confirm the enable flag and exact subject in the frontend process, then restart it. |
| Redirect to sign-in | The session cookie is missing or expired. Sign in normally. |
| `Test Center operator access is required` | The backend allowlist does not contain the same exact subject as the frontend. |
| `Unsupported Test Center route` | The frontend proxy is older than the implemented feature registry. Update/restart the frontend; do not broaden it to an arbitrary proxy. |
| `Test Center controls failed safe` | Redis CAS or immutable Timescale persistence failed. Check both dependencies and migrations; do not bypass persistence. |
| `prerequisite ... is not effective` | Enable the named prerequisite first through the required layers. |
| `registry binding changed` | Refresh the page and verify `TEST_CENTER_REPOSITORY_SHA` and the checked-in registry match the running code. |

On Windows, another PostgreSQL service may already own `127.0.0.1:15432`. Keep the
Test Center connected to the Compose `timescaledb` service by internal Docker DNS;
do not silently point it at the unrelated host database. If Docker Desktop cannot
publish a port from the internal network, use a loopback-only bridge while leaving
the Test Center service itself isolated.

For logs and the full safe-runtime contract, see [Runtime and
operations](runtime.md) and [Testing and debugging](testing-and-debugging.md).

Feature 15 is available only as the default-off `incident-communication-outbox` local
fixture replay. It has no audience input, template input, external channel, or product
incident acknowledgement route.
# Feature 18 mandate-policy semantic fidelity

Feature 37 follows the same subject-allowlisted, loopback-only feature lease. It needs
explicit same-operator Feature 30, 31, and 36 selections; observe is capped at
`shadow_only` and isolated enforce never creates a proposal.

Feature 18 follows the same subject-allowlisted, loopback-only feature lease. Select a
checked-in scenario only; isolated enforce appends synthetic fixture history and never
enables product policy activation.
