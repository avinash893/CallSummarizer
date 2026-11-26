---
name: SargamJam Studio
description: Crisp Light Conservatory Paper & Brass workstation (with Dark Stage mode) for live collaborative music jamming, pitch watching, and meeting intelligence.
colors:
  paper-ground: "#f4f5f7"
  paper-recessed: "#eaedf2"
  paper-surface: "#ffffff"
  paper-elevated: "#f0f2f5"
  paper-hover: "#e4e8ee"
  hairline-subtle: "#dde2ea"
  hairline-default: "#c7cedb"
  hairline-focus: "#1e40af"
  ink-primary: "#11141a"
  ink-secondary: "#374151"
  ink-muted: "#4b5563"
  vermilion-primary: "#b8390c"
  vermilion-hover: "#9a2f09"
  ink-on-accent: "#ffffff"
  blueprint-indigo: "#1e40af"
  sur-emerald: "#047857"
  sur-surface: "#ecfdf5"
  amber-warn: "#92400e"
  coral-danger: "#b91c1c"
typography:
  headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.45rem"
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
    backgroundColor: "{colors.vermilion-primary}"
    textColor: "{colors.ink-on-accent}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.vermilion-hover}"
  button-secondary:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: SargamJam Studio

## Overview

**Creative North Star: "The Conservatory Sheet & Oscilloscope"**

SargamJam Studio transforms the collaborative jam workstation into a crisp daylight studio modeled on printed music notation and precision acoustic instruments (`paper-ground: #f4f5f7`, `paper-surface: #ffffff`, `vermilion-primary: #b8390c`, `blueprint-indigo: #1e40af`), with a 1-click Dark Stage mode for low-light rehearsal rooms.

## Colors

Restrained daylight paper surfaces paired with Burnt Vermilion (`#b8390c`) reserved strictly for primary session actions, active workspace selection, and scale root notes, Blueprint Indigo (`#1e40af`) for melody target references, and Emerald (`#047857`) exclusively for `IN TUNE` intonation lock.

## Typography

**Body & UI Font:** Manrope (weights 400–800)
**Telemetry Font:** JetBrains Mono (`tabular-nums` for `Hz`, `cents`, `BPM`, timers, and error %)

## Layout & Elevation

Flat single-tier studio layout using 1px `#dde2ea` structural borders, two-column pre-call workbench on desktop, responsive single-column stacking on mobile (`<= 850px`), zero nested cards, and zero overlapping/occluding floating badges.
