---
name: DuckStudio
description: Zero-upload, agent-native data lab — a dark instrument panel where every surface is custody evidence.
colors:
  signal-cyan: "#00F2FE"
  lamp-amber: "#FFB347"
  canvas-ink: "#0A0B0F"
  panel-graphite: "#161821"
  hairline-edge: "#2D3139"
  readout-white: "#E9EDF1"
  readout-grey: "#9AA7B4"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.025em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, monospace"
    fontSize: "1em"
    fontWeight: 400
  metric:
    fontFamily: "Space Grotesk, Inter, ui-sans-serif, sans-serif"
    fontWeight: 500
rounded:
  md: "6px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  card-panel:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card-operation:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  badge-zero-upload:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  chip-tool:
    textColor: "{colors.lamp-amber}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-policy-sensitive:
    textColor: "{colors.lamp-amber}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-policy-public:
    textColor: "{colors.readout-grey}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  tab-evidence-active:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "6px 6px 0 0"
    padding: "6px 12px"
  tab-evidence-idle:
    textColor: "{colors.readout-grey}"
    rounded: "6px 6px 0 0"
    padding: "6px 12px"
  button-recovery:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  preset-card:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: DuckStudio

## Overview

**Creative North Star: "The Instrument Panel"**

DuckStudio is styled as a precision instrument for data custody: a near-black chassis, graphite readout surfaces separated by 1px hairline seams, and exactly two signal lamps — Signal Cyan for trust, selection, and focus; Lamp Amber for agent tool operations and warnings. Nothing glows, nothing floats, nothing animates for attention. The screen is legible the way avionics are legible, because its audiences — analysts under egress bans, browser agents, challenge judges — must read state, not admire art. PRODUCT.md pins the tone: "a legible analytical lab, not a brand film."

Density is deliberately compact (12–14px working type). Every panel is a readout bound to explicit workspace state — a workspace ID, a revision, a policy enum, an artifact handle — and every empty state teaches the custody invariant it enforces rather than apologizing for missing data. The chrome stays quiet so the evidence can be loud: exact tool names, exact policy enums, and the fixed `0 Bytes of Dataset Uploaded` badge carry the product's specificity, not decoration.

**Key Characteristics:**
- Flat, shadowless panels; depth = surface tone + hairline seam + the selected-tab z-fusion
- Two chromatic voices only: Signal Cyan (trust) and Lamp Amber (agent operations/warnings)
- JetBrains Mono marks anything the machine emitted; Inter carries everything human
- Every readout binds to explicit workspace state (ID, revision, policy); no ambient state
- Empty states state the rule; error frames give a stable code plus one recovery action
- 150ms ease-out state shifts, a 0.97 press, and full motion-reduce compliance

## Colors

A near-black monochrome chassis whose entire expressive range is two signal lamps.

### Primary
- **Signal Cyan** (#00F2FE): the single live wire. Marks trust, selection, and focus: the zero-upload badge dot (full strength) and its border (30% opacity), `focus-visible` outlines (2px, offset −2), and selected-tab emphasis. It never marks agent activity and never fills large areas — its rarity is the signal.

### Secondary
- **Lamp Amber** (#FFB347): reserved exclusively for agent tool operations and warnings, per PRODUCT.md. Appears as the OPERATION card's border (40% opacity), exact-name tool pills (`duckdb_get_context`) in full-strength mono text, and the `sensitive_aggregate_only` policy chip. Never decorative; never marks human-initiated UI.

### Neutral
- **Canvas Ink** (#0A0B0F): page background — the chassis. Also the `theme-color` meta and the pre-hydration `<body>` inline background.
- **Panel Graphite** (#161821): every readout surface — header strip, cards, tab panel, badge, buttons. One surface tone for everything raised above the chassis.
- **Hairline Edge** (#2D3139): the only neutral border color, always 1px. Separates panes, wraps cards, fuses tabs to their panel.
- **Readout White** (#E9EDF1): primary text and all mono machine values. ≈15:1 on Panel Graphite.
- **Readout Grey** (#9AA7B4): labels, units, meta copy, and empty-state sentences. ≈7:1 on Panel Graphite — still AA at 12px, so it may carry real content, not just hints.

### Named Rules
**The Two-Lamp Rule.** Cyan and amber are the only chromatic colors in the system. A third hue on screen is a defect.
**The Dim Border Rule.** Chromatic borders render dimmed (cyan at 30%, amber at 40%); chromatic text renders at full strength. A colored border marks; colored text speaks.
**The Quiet Chrome Rule.** Neutrals do all structural work. Chrome never competes with evidence.

## Typography

**Display Font:** Inter (variable 400–700, self-hosted woff2, preloaded; fallback ui-sans-serif/system-ui)
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono (variable 400–600, self-hosted woff2, preloaded; fallback ui-monospace/Cascadia Mono)
**Metric Font:** Space Grotesk — committed in PRODUCT.md for KPI values; not yet self-hosted. Introduce it when the Insights KPI implementation lands; never substitute Inter for metrics.

**Character:** An instrument-panel pairing. Inter keeps dense human copy calm and legible; JetBrains Mono gives machine output the fixed-width authority of a readout. The family itself answers "what kind of thing is this?" — a value's typography is its type signature.

Fonts are self-hosted because `Cross-Origin-Embedder-Policy: require-corp` makes third-party asset origins fragile (PRODUCT.md stack note); both woff2 files preload in `index.html`.

### Hierarchy
- **Title** (Inter 600, 18px/28px, tracking −0.01em): the app name `DuckStudio` and the error-frame heading. The only display-size text.
- **Label** (Inter 600, 12px/16px, +0.025em tracking, uppercase): pane and group labels (`AGENT CONTROL & OPERATIONS`, `CUSTODY`). Card labels use the same treatment at weight 500. Always Readout Grey.
- **Body** (Inter 400, 14px/20px): tab labels, tab-panel content, badge copy, dataset IDs' neighbors.
- **Meta** (Inter 400, 12px/16px): secondary lines, preset metadata, empty-state and error explanations.
- **Mono** (JetBrains Mono 400, 1em — inherits surrounding size, never rescales): workspace IDs, revisions, tool names, budgets, artifact IDs, transports, error codes, SQL. Mono values read in Readout White on grey meta lines.
- **Metric** (Space Grotesk 500, size set with implementation): KPI values in the Insights view.

### Named Rules
**The Mono-Means-Machine Rule.** If the system emitted it, it's mono; if a human said it, it's Inter. Never set prose in mono; never set an ID, revision, or code in Inter.

## Layout

A single-screen application frame: a full-viewport (`h-dvh`) column with a one-row instrument header above a fixed two-pane grid — 35% agent operations left, 65% selected artifact right. The floor is `min-width: 960px` with horizontal scroll below it; panes never stack or crush (a deliberate demo-day guardrail against projector and split-window failure).

- **Header:** Panel Graphite strip, bottom hairline, 16px/8px padding. Title, then a `polite` live status line in Meta grey with mono values in Readout White separated by `·`, preset availability, and the badge pinned right (`margin-left: auto`).
- **Panes:** 16px inner padding each side. The left pane stacks readout cards on an 8px rhythm; 12px before the context and dataset groups; 16px before the channel footer and the custody card. The right pane's tab panel fills the pane below the tab strip, so the selected artifact reads as one full-height readout screen.
- **Card internals:** 12px horizontal / 8px vertical padding; 4px between a label and its content; 12px columns in the budget definition list; 4px in lists of artifacts.
- **Type density:** working sizes are 12–14px; nothing larger than the 18px Title exists.

## Elevation & Depth

The system is flat by conviction, not omission: no `box-shadow` appears anywhere in the incumbent code. Depth is conveyed three ways — tonal layering (Canvas Ink chassis behind Panel Graphite readouts), 1px Hairline Edge seams, and one structural exception: the selected evidence tab, which fuses with its panel by dropping its bottom border, translating down 1px, and sitting one z-level above (`z-10`). Focus is a 2px Signal Cyan outline offset −2px inward — the closest thing to a glow, and it is an outline, not a shadow.

### Shadow Vocabulary
None. Do not add shadows; express depth with a seam or a tone shift.

### Named Rules
**The Flat Panel Rule.** Surfaces are flat at rest, hover, and press. Depth comes from seams and tone, never shadows.

## Shapes

Small radii and hard seams. Panels, cards, buttons, and the error-recovery action use a 6px radius; chips, pills, and the badge are fully rounded (9999px). The silhouette is semantic: the pill means "status," the rounded rectangle means "structure." Tabs are top-rounded (6px top, 0 bottom) so they fuse with their panel. The badge's status dot is a 6px circle. No large radii, no asymmetric corners, no clipped or notched shapes.

## Components

### Header & status line
The instrument strip: Title-weight `DuckStudio`, then the workspace readout — `ws_local_01 · rev 0 · no dataset` — in Meta grey with each machine value in mono Readout White, then preset availability. The whole line is a polite live region. The zero-upload badge sits at the far right.

### Zero-upload badge (signature)
The emotional core of the product and the most-protected element. A pill on Panel Graphite with a 1px Signal Cyan border at 30%, a 6px full-strength cyan status dot, and Body-size copy reading exactly `0 Bytes of Dataset Uploaded`. The copy is fixed by PRODUCT.md — never paraphrase, amplify, or soften the claim.

### Readout cards (Context / Operation / Artifacts / Datasets / Custody)
The left pane's atomic unit. 6px radius, Panel Graphite, 1px Hairline Edge border, 12px/8px padding, an uppercase 12px grey label, then Meta content with mono values. The OPERATION card is the single variant: its border swaps to Lamp Amber at 40% because agent operations are the one thing the chassis must flag.

### Tool pill
Mono Lamp Amber text in a pill with a 1px amber 40% border, 2px/8px padding. Renders exact registered tool names (`duckdb_get_context`) — no friendly aliases, no re-casing (PRODUCT.md tool-name invariant).

### Policy chip
A 12px pill, 2px/8px padding. `sensitive_aggregate_only` renders Lamp Amber text on an amber 40% border; `public_synthetic` renders Readout Grey on a Hairline Edge border. The chip color is the policy mode, readable at a glance.

### Preset cards
Full-width, text-left panel-card buttons: mono 14px dataset ID (`saas_churn`) with the policy chip right-aligned, Meta row line under. Disabled until dataset activation ships, with the reason associated via `aria-describedby`.

### Evidence tabs
Top-rounded tab strip over the shared panel. Idle: transparent border, Readout Grey, hover to Panel Graphite background + Readout White. Active: Panel Graphite, Hairline Edge border without bottom, translated 1px, `z-10` — fused to the panel. Press scales to 0.97. Focus is the 2px cyan outline. The full roving-tabindex contract (Arrow/Home/End) is implemented. Transitions: 150ms ease-out on background-color, border-color, color, transform, with `motion-reduce` variants dropping transitions and transforms.

### Tab panel
Bottom-rounded 6px, 1px Hairline Edge border, Panel Graphite, 16px padding, Body-size content. One panel serves all four views; tabs are not workspace state.

### Empty states (signature)
Every no-artifact view renders a centered sentence (minimum 144px row) in Meta grey that teaches the invariant it enforces: "No artifact — the grid paints rows only from an approved artifact." Never "nothing here yet"; the empty state is the policy, stated.

### Error frame
Centered on Canvas Ink: a Title heading ("This view failed to render"), a Meta explanation in human terms, the stable code in mono (`E_URL_INVALID_PARAM`), and exactly one recovery action — a panel-card button ("Back to the workspace") whose hover lifts its border to Readout Grey. Stack traces and serialized validation output never render (product principle 6).

## Do's and Don'ts

### Do:
- **Do** render every machine-emitted value in JetBrains Mono at the surrounding text size: workspace IDs, revisions, tool names, budgets, artifact IDs, transports, error codes.
- **Do** reserve Lamp Amber (#FFB347) for agent tool operations and warnings — tool pills, the OPERATION card border, the sensitive policy chip — with borders at 40% opacity.
- **Do** use Signal Cyan (#00F2FE) only for trust, selection, focus, and status: badge dot (full), badge border (30%), focus outlines, selected-tab emphasis.
- **Do** state the governing custody rule inside every empty state — one centered Meta sentence on a ≥144px row.
- **Do** keep all state transitions at 150ms ease-out and ship `motion-reduce` variants that drop transitions and transforms.
- **Do** hold the measured contrast floor: ≈7:1 for Readout Grey and ≈15:1 for Readout White on Panel Graphite; keep new color pairs at or above AA at these sizes.

### Don't:
- **Don't** introduce shadows, glows, or gradients — depth is seams and tone (The Flat Panel Rule).
- **Don't** add a third hue (The Two-Lamp Rule), and never use amber decoratively or for human-initiated UI.
- **Don't** paraphrase the badge: it reads exactly `0 Bytes of Dataset Uploaded` — no "zero-knowledge," no "SOC 2," no claims PRODUCT.md does not make.
- **Don't** set prose in mono or machine values in Inter (The Mono-Means-Machine Rule).
- **Don't** fabricate a readout: every number, status, and artifact on screen must bind to workspace state — no ambient "last result," no painted rows without a policy-approved artifact.
- **Don't** soften error frames with generic advice; render a stable code and one recovery action.
- **Don't** stack or reflow the 35/65 panes responsively; below 960px the shell scrolls horizontally.
