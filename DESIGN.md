---
name: DuckStudio
description: Zero-upload, agent-native data lab — a dark optical instrument lit by two signal lamps, where every surface is glass you can see custody through.
colors:
  chassis: "#050508"
  glass: "rgb(255 255 255 / 4%)"
  glass-raised: "rgb(255 255 255 / 8%)"
  edge: "rgb(255 255 255 / 9%)"
  edge-bright: "rgb(255 255 255 / 16%)"
  signal-cyan: "#00F2FE"
  lamp-amber: "#FFB347"
  ink: "#F4F7FA"
  ink-secondary: "#9AA4B2"
typography:
  title:
    fontFamily: "Space Grotesk, Geist, ui-sans-serif, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  numeral:
    fontFamily: "Space Grotesk, Geist, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.14em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, monospace"
    fontSize: "1em"
    fontWeight: 400
rounded:
  panel: "18px"
  panel-inner: "14px"
  island: "20px"
  pill: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
components:
  glass-island:
    backgroundColor: "rgb(5 5 8 / 60%)"
    textColor: "{colors.ink}"
    rounded: "{rounded.island}"
    padding: "10px 16px"
  card-panel:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "6px"
  card-operation:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "6px"
  panel-evidence:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "6px"
  preset-card:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "6px"
  badge-zero-upload:
    backgroundColor: "rgb(0 242 254 / 6%)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 10px"
  chip-operation:
    backgroundColor: "transparent"
    textColor: "{colors.lamp-amber}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-policy-sensitive:
    backgroundColor: "rgb(255 179 71 / 5%)"
    textColor: "{colors.lamp-amber}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-policy-public:
    backgroundColor: "rgb(255 255 255 / 3%)"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  tab-evidence:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  tab-evidence-active:
    backgroundColor: "rgb(0 242 254 / 8%)"
    textColor: "{colors.signal-cyan}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  button-recovery:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
---

# Design System: DuckStudio

## Overview

**Creative North Star: "Custody Glass"**

DuckStudio is a dark optical instrument lit by its own two signal lamps — Signal Cyan is custody and trust, Lamp Amber is the agent — and every surface is translucent white glass you can see custody through. The chassis is OLED black; two fixed radial lamp fields wash the room (cyan over the evidence pane, amber low over the agent rail); panels are machined hardware built as concentric double bezels with 1px white hairlines. It refuses the category's flat admin-panel arrangement: nothing here is a grey card on a grey dashboard — depth, light, and hairline construction make the workspace read as a scientific instrument. The tone stays "a luminous custody instrument — glass depth under two signal lamps, forensic legibility; not a brand film."

Density is deliberate and forensic: working type is 11–14px, every readout binds to explicit workspace state (revision, policy enum, artifact handle), and every empty state teaches the custody invariant it enforces with ghost geometry that fabricates no values. The aha is staged in the material itself: governed evidence renders on glass while the badge still reads `0 Bytes of Dataset Uploaded`.

All state motion runs on one house glide (`cubic-bezier(0.32, 0.72, 0, 1)`) with full `prefers-reduced-motion` compliance; the lamp drift is the only ambient animation, and reduced motion pins it.

**Key Characteristics:**
- OLED-black chassis (`#050508`) with two fixed radial lamp fields — cyan over evidence, amber over the agent rail — the only chromatic voices
- Translucent white-glass panels with 1px hairlines, built as concentric double bezels (18px outer shell / 14px inner core)
- One soft ambient shadow per panel; lamp glows appear only on lamp-owned surfaces (the Activity card, the evidence instrument)
- `backdrop-blur` only on fixed/sticky glass; scrolling content is never blurred, and lamp softness comes from gradient falloff, not filters
- JetBrains Mono marks anything the machine emitted, read in ink-white on grey meta lines
- Ghost empty states preview geometry, never values; disabled controls dim to 75% and state their reason
- One house glide everywhere, staggered reading-order entry, a 0.97 press, full reduced-motion compliance

## Colors

A black-glass monochrome whose entire expressive range is two signal lamps: white at four opacities does every structural job, cyan and amber carry meaning.

### Primary
- **Signal Cyan** (`#00F2FE`): the custody lamp. Marks trust, custody, selection, and focus: the evidence instrument's hairline (15%) and surrounding glow, the zero-upload badge dot (full, pulsing) and border (30%), the active evidence tab (text full, background 8%, border 30%), the selected readout's lamp (active preset and artifact cards: border 40%, fill 5%), ghost-readout accents (20–55%), and every `focus-visible` outline (2px, offset −2px). The lamp field itself is two radial cyan washes at 13% and 7% over the evidence side. Cyan never marks agent activity and never fills large areas — its rarity is the signal.

### Secondary
- **Lamp Amber** (`#FFB347`): the agent lamp, reserved exclusively for agent tool operations and warnings. The ACTIVITY card wires its shell with amber (border 40%, core gradient tinted 6%→1.5%, plus the amber glow); its operation pills read full-strength amber while queued/running, with the exact tool/command name on the tooltip, and the `sensitive_aggregate_only` policy chip is amber. The lamp field is two radial amber washes at 9% and 5% low over the controls rail. Never decorative; never marks human-initiated UI.

### Neutral
- **Chassis** (`#050508`): the OLED-black room. Page background, `theme-color` meta, pre-hydration `<body>` background, and the glass header's tint base (60% opacity) — the chassis shows through the glass.
- **Glass** (`rgb(255 255 255 / 4%)`): every resting panel surface — cards, tab panel, badge, buttons, preset cards.
- **Glass Raised** (`rgb(255 255 255 / 8%)`): hover-raised surfaces (recovery button hover).
- **Edge** (`rgb(255 255 255 / 9%)`): the 1px hairline that wraps every shell, core, tile, island, and divider.
- **Edge Bright** (`rgb(255 255 255 / 16%)`): hover-lifted hairlines (recovery button) and the scrollbar thumb's register.
- **Ink** (`#F4F7FA`): primary text and all mono machine values. ≈15:1 on the glass-over-chassis surface.
- **Ink Secondary** (`#9AA4B2`): labels, meta copy, empty-state sentences, idle tabs. ≈7:1 on the glass-over-chassis surface — still AA at working sizes, so it may carry real content, not just hints.

### Named Rules
**The Two-Lamp Rule.** Cyan and amber are the only chromatic colors in the system, and each owns one subject: cyan means custody, amber means the agent. A third hue on screen is a defect.

**The Dim Border Rule.** Chromatic borders render dimmed (cyan at 15–40%, amber at 40%); chromatic text renders at full strength. A colored border marks; colored text speaks.

**The Lamp-Glow Rule.** Glows mark the two lamps and nothing else: the amber glow lives only on the ACTIVITY card, the cyan glow only on the evidence instrument. Neutral panels get ambient shadow, never glow.

## Typography

**Display Font:** Space Grotesk (variable 300–700, self-hosted woff2, preloaded; fallback Geist, then system sans) — the product title and display numerals.
**Body Font:** Geist (variable 100–900, self-hosted woff2, preloaded; fallback ui-sans-serif/system-ui) — all human copy.
**Label/Mono Font:** JetBrains Mono (variable 400–600, self-hosted woff2, preloaded; fallback ui-monospace/Cascadia Mono) — everything the machine emitted.

**Character:** An optical-instrument pairing. Geist keeps dense human copy calm; Space Grotesk gives the title and numbered readouts their machined-display voice; JetBrains Mono gives machine output fixed-width authority. A value's typography is its type signature — the family answers "who emitted this?"

Fonts are self-hosted because `Cross-Origin-Embedder-Policy: require-corp` makes third-party asset origins fragile; all three woff2 files preload in `index.html`.

### Hierarchy
- **Title** (Space Grotesk 500, 18px/28px, tracking −0.01em): the product name `DuckStudio` and the error-frame heading. The only display-size text.
- **Numeral** (Space Grotesk 500, 12px): display numerals inside machined elements — reserved for numbered readouts; no live surface seats one today.
- **Label** (Geist 500, 11px/16px, +0.14em tracking, uppercase): pane labels (`AGENT CONTROL & OPERATIONS`, `SELECTED ARTIFACT`) and every card label (`CONTEXT`, `OPERATION`, `CUSTODY`). Always Ink Secondary.
- **Body** (Geist 400, 14px/20px): tab-panel content, badge copy, recovery button, dataset IDs' neighbors. A 13px medium working size covers tab labels, the run button, and the dropzone lead line.
- **Meta** (Geist 400, 12px/16px): secondary lines, preset metadata, budget lists, empty-state and error explanations.
- **Mono** (JetBrains Mono 400, 1em — inherits surrounding size, never rescales): revisions, tool names, budgets, artifact IDs, transports, policy enums, error codes, SQL. Mono values read in Ink on grey meta lines.

### Named Rules
**The Mono-Means-Machine Rule.** If the system emitted it, it's JetBrains Mono in Ink; if a human said it, it's Geist in grey. Never set prose in mono; never set an ID, revision, or code in the UI font.

## Layout

A single-screen instrument frame: a full-viewport (`h-dvh`) two-pane grid at ≥1024px; below that breakpoint the panes stack in reading order and the page scrolls. A floating glass header island hovers above two independently scrolling panes — 35% controls left, 65% results right. Z-order is the room's architecture: the lamp field is fixed at z-0, content sits at z-10, the header island floats at z-30.

- **Header island:** page gutter 20px/16px (`px-5 pt-4`); the island itself is `glass-island` — 20px radius, chassis-tinted glass at 60%, 1px hairline, `backdrop-blur-xl`, top inner highlight — with 10px/16px internal padding. Title, then a polite live status line (revision, dataset) in Meta grey with mono values separated by `·`, the zero-upload badge, and the agent capability chip; the badge carries `margin-left: auto` and the island row wraps when narrow.
- **Panes:** the grid runs 35/65 with a 16px gap and 20px page gutters. The left pane scrolls (`overflow-y-auto`) with 4px gutter allowance; the right pane is a flex column: pane label, tab island, then the evidence panel filling all remaining height (`flex-1`) with its core scrolling inside.
- **Left rail order:** DATASETS (the local-file dropzone, then the preset cards) → RUN AN ANALYSIS → SAVED RESULTS → ACTIVITY. Cards stack on an 8px rhythm (`mt-2`), 12px before groups (`mt-3`); a card label sits 4–6px above its content.
- **First paint:** regions rise in reading order via a `--rise-delay` stagger (left rail 60→220ms; right pane 140→260ms) — a 640ms rise of 14px with a blur-resolve (6px→0) on the house glide.
- **Scrollbars:** instrument-quiet everywhere — thin, `rgb(255 255 255 / 14%)` thumb on transparent.

## Elevation & Depth

Depth is a hybrid of glass tone, hairline construction, and light. Every panel carries exactly one soft ambient shadow that seats it above the chassis; the two lamp-owned surfaces add a single colored glow each; every shell catches light along its top edge with an inset 1px white highlight. Softness in the room comes from radial-gradient falloff, never from blur filters — the lamp layer costs one paint.

### Shadow Vocabulary
- **Ambient panel** (`box-shadow: 0 24px 48px -24px rgb(0 0 0 / 0.55)`): every card panel and the evidence instrument. One per panel — never stacked neutrals.
- **Ambient island** (`0 24px 48px -24px rgb(0 0 0 / 0.65)` plus `inset 0 1px 0 rgb(255 255 255 / 0.07)`): the floating glass header island and error island — deeper seating for true float.
- **Core highlight** (`inset 0 1px 0 rgb(255 255 255 / 0.06)`, ghost tiles `0.04`): the inner core's light-catch.
- **Amber lamp glow** (`0 0 24px -8px rgb(255 179 71 / 0.18)`): only the ACTIVITY card, layered after its ambient shadow.
- **Cyan lamp glow** (`0 0 48px -16px rgb(0 242 254 / 0.28)`): only the evidence instrument, layered after its ambient shadow.

### Named Rules
**The One Ambient Shadow Rule.** Each panel casts exactly one soft ambient shadow (`0 24px 48px -24px` black). A second neutral shadow is a defect; the only additional shadow allowed is that panel's lamp glow.

**The Blur Budget Rule.** `backdrop-blur` sits only on fixed or sticky glass (the header island, the error island) plus the one floating popover, the workbench select's option list. Scrolling content is never blurred; the lamp fields get their softness from radial-gradient falloff, not filters.

## Shapes

Concentric double-bezel construction is the signature: every readout is machined hardware — an outer shell at 18px radius with a 1px hairline and 6px padding, holding an inner glass core at 14px radius (`18px − 4px`) with a brighter-but-fainter hairline (edge at 60%) and a white 5%→2% vertical glass gradient, padded 10px/12px. The 4px concentric offset is fixed; inner radius always equals outer minus 4. Status geometry is fully round: the badge, chips, tabs, recovery button, and the floating header island (20px) are pills. Ghost readouts reuse the inner radius (`ghost-tile`) so even empty geometry is machined. Borders are always 1px; no 2px strokes, no notched or clipped corners. Inline icons are hand-drawn 1.5px-stroke SVG glyphs — no icon library.

## Components

### Header glass island
The room's one floating chrome: title, live status line (mono values in Ink on Meta grey), the zero-upload badge, and the agent capability chip — its tooltip discloses the served surface (`webmcp_native`, or `simulator_only · same workspace`). `glass-island` construction: 20px radius, chassis glass at 60%, hairline, `backdrop-blur-xl`, island shadow with top inner highlight. The status line is a polite live region; the island is the only blurred element over scrolling content.

### Zero-upload badge (signature)
The emotional core of the product and the most-protected element. A pill on cyan-tinted glass (6%) with a 1px cyan border at 30%, a 6px full-strength cyan dot pulsing on a 2.8s breathing cycle, and Body-size copy reading exactly `0 Bytes of Dataset Uploaded`. The copy is fixed by PRODUCT.md — never paraphrase, amplify, or soften the claim.

### Readout cards (double bezel)
The left rail's atomic unit: `card-panel` shell (18px, glass 4%, hairline, ambient shadow, 6px padding) wrapping a `card-core` (14px, edge at 60%, white glass gradient, 10px/12px padding, top highlight). An uppercase 11px grey label, then Meta content with mono values. One chromatic variant exists: **card-operation** wires the shell amber (border 40%, amber-tinted core gradient, amber glow) because agent operations are the one thing the rail must flag; the evidence instrument gets the mirror treatment (**panel-evidence**: cyan hairline at 15%, cyan-tinted core, cyan glow) because the room's cyan lamp lands on it.

### Operation pills and policy chips
Operation pills (the ACTIVITY card) pair a status dot with a human label — `Activate dataset`, `Run analysis`, `Import file`; the exact tool/command name rides the tooltip, no aliases, no re-casing. Amber + pulse while queued/running, grey when settled, red when failed. Policy chips are 12px pills rendering the human policy label — `Sensitive — totals only` in amber (border 40%, fill 5%), `Public data` in grey (hairline border, white 3%) — with the raw enum (`sensitive_aggregate_only`, `public_synthetic`) on the tooltip. Chip color is the policy mode, readable at a glance.

### Preset cards and the dropzone
Full-width, text-left panel buttons in double-bezel construction: mono 14px dataset ID (`saas_churn`), Meta row line (`250k rows · ~14.2 MB`), the policy chip and a 24px hairline arrow circle right-aligned. Clicking dispatches the activation command — `aria-pressed` carries state, and the active preset wires the cyan lamp (border 40%, cyan 5% fill) with a mono `ACTIVE` chip replacing the arrow. The local-file dropzone leads the group: a 1px dashed hairline panel at the concentric inner radius whose drag-over state tints cyan and whose click target carries the standard focus ring. Hover/press wiring (`state-shift press focus-ring`) is live on both.

### Evidence tab island
A pill rail (hairline border, chassis glass at 80%, 6px padding, top inner highlight) holding five pill tabs (`Charts`, `Query`, `Rows`, `SQL & Lineage`, `Zero Upload`) at 13px medium. Idle: grey text, hover to white 4% + Ink. Active: cyan text on cyan 8% with a cyan 30% border. Full roving-tabindex keyboard contract (Arrow/Home/End). Tab switches morph the panel island via the View Transitions API (240ms house glide) where supported; the fallback remount resolves with a 320ms blur-rise (`view-swap`). Tabs are not workspace state.

### Evidence panel (the instrument)
The right pane's full-height double bezel: `panel-evidence` shell (cyan hairline, cyan glow) with its core filling the pane and scrolling internally at Body size. One panel serves all four views.

### Ghost empty states (signature)
Every no-artifact view renders a centered composition (minimum 224px tall, 20px gaps): a ghost of the readout that will land there, then the governing custody sentence and the move that unlocks it, in Meta grey. The ghost is geometry only — glass bars at varying widths for the grid, three KPI tiles with a cyan-drawn sparkline (`ghost-draw` linework animating on the house glide) for Insights, a statement block flowing into a lineage chain for SQL & Lineage, concentric rings with one live center for Custody. Ghosts never fabricate values: no fake numbers, no fake rows, no placeholder text.

### Error frame
Centered on the chassis under the lamp field: a glass island holding a Title heading ("This view failed to render"), a Meta explanation in human terms, the stable code in mono (`E_URL_INVALID_PARAM`), and exactly one recovery action — the pill recovery button (hairline border, glass fill; hover lifts the hairline to Edge Bright and the fill to Glass Raised; press scales 0.97). Stack traces and serialized validation output never render.

### Motion contract (all components)
One house glide (`cubic-bezier(0.32, 0.72, 0, 1)`) everywhere: state shifts at 300ms, entry rise at 640ms, view swap at 320ms, linework draw at 700ms (150ms delay), lamp drift at 22s/26s alternate. Interactive elements press to 0.97. Every transition and animation ships a `motion-reduce` fallback that drops it entirely (including the scale press) — reduced motion shows the finished, pinned instrument.

## Do's and Don'ts

### Do:
- **Do** build every readout as a concentric double bezel: `card-panel` shell (18px, 6px padding, hairline, one ambient shadow) wrapping a `card-core` (14px, 10px/12px padding, edge at 60%, top highlight). Inner radius = outer − 4px, always.
- **Do** keep cyan for custody/trust/selection/focus and amber for agent operations/warnings only, with borders dimmed (cyan 15–40%, amber 40%) and text at full strength.
- **Do** render machine values in JetBrains Mono at Ink on grey meta lines; humans read Geist in grey.
- **Do** stagger first paint in reading order with `--rise-delay` on the 640ms rise, and run all motion on the house glide with `motion-reduce` fallbacks.
- **Do** state the governing custody rule inside every empty state, with ghost geometry that fabricates no values.
- **Do** hold the measured contrast floor: ≈15:1 for Ink and ≈7:1 for Ink Secondary on the glass-over-chassis surface; keep new pairs at or above AA at working sizes.
- **Do** give disabled controls a visible dim (75%) and a spoken reason (`aria-describedby`).

### Don't:
- **Don't** add a third hue, use amber decoratively, or let cyan mark agent activity (The Two-Lamp Rule).
- **Don't** stack neutral shadows or put a glow on a neutral panel — one ambient shadow per panel, glows only where a lamp owns the surface (The One Ambient Shadow Rule, The Lamp-Glow Rule).
- **Don't** apply `backdrop-blur` to scrolling content or use blur filters for lamp softness — radial-gradient falloff only (The Blur Budget Rule).
- **Don't** paraphrase the badge: it reads exactly `0 Bytes of Dataset Uploaded` — no "zero-knowledge," no "SOC 2," no claims PRODUCT.md does not make.
- **Don't** set prose in mono or machine values in the UI font (The Mono-Means-Machine Rule).
- **Don't** reflow the two panes into any split other than 35/65 at ≥1024px or the reading-order stack below; never a 50/50 split or a hidden pane.
- **Don't** soften error frames with generic advice; render a stable mono code and one recovery action.
