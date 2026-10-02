# Replay engine qualification preparation

2026-09-30, supervisor-only offline preparation while Stage 2 proceeds.
Disposition remains **prototype** under [the master component decision](trading-components.md).
Q4 has not run; no application dependency or live adapter was added.

NautilusTrader `1.231.0` was installed in the isolated ignored environment
`.data/nautilus-1.231`. PyPI metadata identifies `LGPL-3.0-or-later` and Python
`>=3.12,<3.15`. The upstream release title includes Beta; this is not a production
certification. The exact Windows CPython 3.12 wheel is 112,750,098 bytes with SHA-256:
`0697f51e9143f9d8d040f75d2e6a45218003cc34f7ea5b0eb2f9cda6935427de`.
[Release](https://github.com/nautechsystems/nautilus_trader/releases/tag/v1.231.0),
[package metadata](https://pypi.org/pypi/nautilus_trader/1.231.0/json),
[license source](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/LICENSE).

The latest documentation currently targets 2.x prereleases and explicitly says its
examples differ from 1.x. Qualification must use the installed version's API/source;
no unpinned prerelease upgrade is implied.
[Installation guidance](https://nautilustrader.io/docs/latest/getting_started/installation/).

Locally verified: imports, installed-wheel hash, construction and disposal of an
empty offline `BacktestEngine` (0.004231 seconds, excluding imports). No market event,
strategy, fill, funding, account, wallet, provider or network venue operation ran.
The first probe needed two local harness fixes (UTF-8 report decoding and normalized
package name); neither was an engine failure. Install report and probe remain ignored
local artifacts `.data/nautilus-1.231-install.json` and `.data/probe-nautilus.py`.

Next qualification after Q2/Q3: map the same frozen observations/intents to the engine,
compare exact fills/fees/partial cancellations/funding against the independent oracle,
record unsupported mechanics and resource use, and prove simulation cannot access
Moeazi credentials or live financial state. Availability alone is not sufficient to
retain an integration or replace Moeazi's financial owner.
