# Brand asset manifest

Moeazi currently uses a typographic `MOEAZI` wordmark in the app. The source web repository does not contain a distinct approved Moeazi logo asset; its only root SVG is a Convex favicon, so it was intentionally not copied or misrepresented as the product logo.

The approved color tokens are versioned in `src/theme/tokens.ts`. Android font assets are versioned in `android/app/src/main/assets/fonts`:

- Syne
- Plus Jakarta Sans
- IBM Plex Mono

Their Open Font License files are in `docs/licenses`. No product logo or native UI mockup asset is included.

`readme-themes.svg` is a documentation palette preview built from the five
native `src/theme/userThemes.ts` color sets. It is not an app screenshot or a
claim that all five layouts have been captured on a device.

`readme-hero.svg` and `readme-divider-*.svg` are README-only artwork using the
approved color tokens; they are not an app logo or native screen. The
`readme-prototype-*.png` captures under `docs/user-experience/evidence/` show
the local HTML prototype with simulated fixture data, not live wallet or market
activity. See that folder's README for capture details.
