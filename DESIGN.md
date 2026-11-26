---
name: SargamJam Studio
description: Operate-mode dark workstation for collaborative Hindustani music jamming, live Swara pitch watching, and meeting intelligence.
colors:
  studio-void: "#0c0d10"
  studio-recessed: "#13151a"
  studio-panel: "#181b21"
  studio-elevated: "#20242c"
  studio-hover: "#282d37"
  hairline-subtle: "#262a33"
  hairline-default: "#353b47"
  hairline-focus: "#5a6375"
  ink-primary: "#f4f6f9"
  ink-secondary: "#b8c0cf"
  ink-muted: "#9aa3b2"
  signal-orange: "#ff7629"
  signal-orange-hover: "#ff8c47"
  ink-on-accent: "#0b0d11"
  sur-emerald: "#34d399"
  sur-surface: "#0d2b22"
  amber-warn: "#fbbf24"
  coral-danger: "#ef4444"
typography:
  headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.02em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.ink-on-accent}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-orange-hover}"
  button-secondary:
    backgroundColor: "{colors.studio-elevated}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: SargamJam Studio

## Overview

**Creative North Star: "The Studio Patchbay"**

SargamJam Studio follows Operate-mode precision: low-glare neutral charcoal surfaces built for multi-hour vocal practice and ensemble calls, paired with high-contrast Signal Orange (`#ff7629`) reserved strictly for primary actions, active workspace selection, and the root `Sa` tonic.

## Colors

Restrained dark neutral palette with a single high-visibility Signal Orange action accent and emerald green (`#34d399`) dedicated exclusively to `Sur Mila` / verified status.

### Primary
- **Signal Orange** (`#ff7629`): Primary join/split actions, active studio mode tab, active tolerance chip, and root `Sa` indicator.
- **Ink On Accent** (`#0b0d11`): High-contrast dark ink (>= 7:1 WCAG AAA) on Signal Orange controls.

### Neutral
- **Studio Void** (`#0c0d10`): Application shell and recessed input wells.
- **Studio Panel** (`#181b21`): Top bars, drawers, and single-tier surface containers.
- **Ink Primary** (`#f4f6f9`) / **Ink Secondary** (`#b8c0cf`) / **Ink Muted** (`#9aa3b2`): Minimum 5.5:1 contrast across all dark surfaces.

## Typography

**Body & UI Font:** Manrope (weights 500, 600, 700)
**Data & Telemetry Font:** JetBrains Mono (`font-variant-numeric: tabular-nums` for `Hz`, `cents`, `BPM`, timers, and pitch match `%`)

## Layout

Single-screen desktop viewport shell with collapsible Notes drawer, horizontal Musical Control Strip, and structurally adapting mobile layouts (`<= 850px`). Surfaces remain flat without card-inside-card nesting.

## Elevation & Depth

Flat tonal layering with crisp 1px borders (`#262a33` / `#353b47`) and directional drop shadows reserved for floating docks and modal dialogs. Zero zero-offset glow halos or side-tab borders.

## Do's and Don'ts

### Do:
- **Do** enforce `>= 4.5:1` contrast on every label, placeholder, and accent button (`#0b0d11` on `#ff7629`).
- **Do** separate sibling sections with whitespace and 1px hairline dividers instead of nested cards.

### Don't:
- **Don't** place uppercase eyebrow kickers above headings, side-tab `border-left` accent bars on rounded boxes, or gradients on text/UI controls.
- **Don't** position floating badges over standby text or avatars where mobile viewports can occlude them.
