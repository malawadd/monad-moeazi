# Moeazi Style Guide

Use this guide when you want another project to feel visually aligned with Moeazi.

## Design Direction

This UI is flat neobrutalism for operational software.

- No gradients.
- No glassmorphism.
- No rounded corners.
- Use near-black structure, hard shadows, and flat color blocks.
- Keep the layout loud, but disciplined.
- Each page should usually have 1 main accent, 1 support accent, and neutral paper surfaces.
- Yellow belongs to the shell, primary actions, and warning moments, not to every major panel.

## Signed-in Dashboard Themes

The portal offers two independent appearance settings: **Dashboard layout** changes
team navigation; **Visual theme** changes presentation across agent and account pages.
Bold is the existing default. Studio follows the agentic prototype reference with a
224px yellow rail, compact utility header and page introduction, sentence-case
navigation, 1–2px square borders, smaller hard shadows, and more restrained panels.
Both keep the same fonts, palette, status meanings, keyboard focus, and content.
Theme rules stay under the signed-in `.app-shell[data-dashboard-theme]`; Terminal,
Viz, public pages, and demos must not inherit them. Agent CSS modules should use
theme-aware border and shadow variables rather than a second blanket override.

## Core Tokens

Use these tokens first. If a new project needs more colors, add them carefully instead of improvising random shades.

```css
:root {
  --bg: #fffdf5;
  --surface-paper: #fffdf5;
  --surface-paper-alt: #fff8e9;
  --surface-cream: #fff1cf;
  --surface-yellow: #ffd23f;
  --surface-pink: #ff7ba5;
  --surface-sky: #74b9ff;
  --surface-sky-tint: #eef7ff;
  --surface-mint: #88d498;
  --surface-mint-tint: #effcef;
  --surface-orange: #ffa552;
  --surface-orange-tint: #fff1e5;
  --surface-lilac: #b8a9fa;
  --surface-lilac-tint: #f1edff;
  --surface-rose: #ff8ba7;
  --surface-rose-tint: #fff0f4;
  --surface-red: #ff6b6b;
  --ink: #111111;
  --muted: #3f3f46;
  --line: #111111;
  --success: var(--surface-mint);
  --warning: var(--surface-yellow);
  --danger: var(--surface-red);
  --info: var(--surface-sky);
  --border-width: 3px;
  --border-width-lg: 5px;
  --shadow-sm: 3px 3px 0 var(--line);
  --shadow-md: 5px 5px 0 var(--line);
  --shadow-lg: 8px 8px 0 var(--line);
}
```

## Typography

Use a three-role font system.

- Display: `Syne`
  - Use for page titles, brand wordmarks, large metrics, and major card headings.
- UI and body: `Plus Jakarta Sans`
  - Use for paragraphs, forms, navigation, buttons, and operational copy.
- Meta and labels: `IBM Plex Mono`
  - Use for kickers, badges, labels, hashes, addresses, IDs, and small system metadata.

### Type Rules

- Display text should feel compressed, bold, and high-contrast.
- Body copy should stay sentence-case.
- Reserve all-caps for labels, badges, kickers, nav items, and tiny metadata moments.
- Long display text must be constrained with `max-width`.
- Sidebar wordmarks should scale with the container instead of overflowing.

Example:

```css
.page-title,
.brand-title,
.metric-value,
.panel h3,
.disclosure-title {
  font-family: var(--font-syne), sans-serif;
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.05em;
}

.panel-kicker,
.page-kicker,
.brand-kicker,
.metric-label {
  font-family: var(--font-plex-mono), monospace;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

## Shell Layout

The authenticated shell uses a hard split:

- Left sidebar: flat yellow block
- Main content: paper background
- Topbar: paper slab with a route accent tab

### Sidebar Rules

- Background should be solid yellow.
- Inactive nav items should use cream.
- Active nav item should use pink.
- Keep the wordmark on one line.
- The sidebar should be a container so the brand title can size responsively.

Example:

```css
.app-sidebar {
  background: var(--surface-yellow);
  border: var(--border-width-lg) solid var(--line);
  box-shadow: var(--shadow-lg);
  container-type: inline-size;
  overflow: hidden;
}

.brand-title {
  max-inline-size: 100%;
  white-space: nowrap;
  overflow: hidden;
  font-size: clamp(1.9rem, 15.5cqi, 3.1rem);
}
```

### Route Accent Map

Use this mapping unless a project has a better product reason to change it.

| Route Type | Accent |
| --- | --- |
| Overview | `sky` |
| Deposits | `orange` |
| Withdrawals | `mint` |
| Positions | `lilac` |
| Risk / Activity / Kill | `rose` |
| Settings | `lilac` |

## Panel Anatomy

Top-level panels are two-part objects:

1. Accent header strip
2. Paper body

Do not use one giant tinted block for the whole panel unless there is a very strong reason.

### Top-Level Panels

- Border: `5px solid var(--line)`
- Shadow: `var(--shadow-lg)`
- Header uses accent background.
- Body uses paper.

### Nested Cards

- Border: `3px solid var(--line)`
- Shadow: `var(--shadow-sm)`
- Background should be `paper-alt` or a pale tint.
- Nested cards should feel supportive, not louder than the parent panel.

### Tone System

Use this shared surface set:

- `paper`
- `sky`
- `mint`
- `orange`
- `lilac`
- `rose`

Usage guidance:

- `paper`: neutral sections, history, secondary panels
- `sky`: overview, live data, execution state
- `mint`: wallet inventory, positive live operational views
- `orange`: actions, refresh, intervention, operator tasks
- `lilac`: settings, audit, hedging, secondary strategic views
- `rose`: incidents, emergency, risk-heavy moments

## Buttons And Badges

Buttons should feel stamped, not soft.

- Primary button: yellow fill
- Secondary button: paper fill
- Danger button: red fill
- Border: `5px solid var(--line)`
- Shadow: `var(--shadow-md)`
- Hover should reduce the shadow and shift the element slightly

Status badges:

- Neutral: paper
- Positive: mint
- Warning: yellow
- Danger: red
- Info: sky

## Spacing And Grids

- Main shell gap: `20px`
- Standard panel body padding: `22px`
- Standard nested card padding: `18px`
- Standard grid gap: `18px`
- Desktop shell columns: `300px 1fr`
- Two-column content sections should collapse to one column on narrower screens

Use dense, readable layouts. Do not introduce huge empty whitespace unless it is part of a deliberate landing-page moment.

## Wrapping And Overflow Rules

Operational UIs always contain ugly strings. Design for them.

- Add `min-width: 0` to shrinking flex and grid children.
- Use `overflow-wrap: anywhere` and `word-break: break-word` for long details.
- Keep hashes, addresses, and request IDs in monospace, but let them wrap.
- Never allow raw payload text to push a card wider than its column.

Example:

```css
.mono-label,
.card-detail-wrap,
.list-card h4,
.list-card p {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

## Page Composition Rules

To keep the system coherent across products:

- One page should not use every accent at full strength.
- Pick 1 dominant accent for the page.
- Add 1 support accent if needed.
- Let paper and pale inset surfaces do the rest.
- Metric cards can be louder than long-form data panels.
- The shell should stay visually stable across pages while content accents rotate by route or feature.

## Interaction Patterns

- Show only the most useful first slice of high-volume data.
- Expand inline before reaching for modals or new pages.
- Use disclosure cards for dense operational details.
- Keep empty states blunt and useful.
- Put labels above or beside values clearly; do not rely on subtle visual hints.

## Responsive Rules

- Collapse two-column grids to one column on smaller screens.
- Let the topbar accent tab become a full-width top band on mobile.
- Keep the sidebar title from leaking at high zoom.
- Reduce display sizes before allowing clipping.
- Prioritize wrapping over horizontal scroll in cards.

## Do / Don't

Do:

- Use flat fills.
- Use hard shadows.
- Use square geometry.
- Use strong typography with real hierarchy.
- Use color with purpose.

Don't:

- Add gradients.
- Add blur or glass effects.
- Add rounded corners.
- Let every section scream with full saturation.
- Let long IDs or payloads overflow out of the card.

## Minimal Copy Kit

If you want another project to feel immediately related, keep these patterns:

- Small mono kicker above major title
- Large compressed display headline
- Accent-strip panels with paper bodies
- Yellow shell + pink active state
- Heavy borders and hard offset shadows
- Monospace badges for status, labels, and IDs

## Implementation Reference

If you need the live source of truth in this repo, use:

- `app/globals.css`
- `app/layout.tsx`
- `components/StrategyShell.tsx`
- `components/strategy-ui.tsx`
