# Changelog

## 1.1.0 — 2026-11-26

- Redesigned Sidebar Quota Dashboard inspired by the Figma v1.1 Cockpit UI:
  - SVG radial quota rings (`5H` / `1W`) with tabular numerals, theme-adaptive tracks, and live countdowns.
  - Tightest-limit callout banner highlighting the nearest quota constraint.
  - Telemetry bento row for Active Model and AI Credits, color-coded group dots, and compact model chips.
  - Guided `BINARY_NOT_FOUND` recovery actions and SVG toolbar controls.
- Added new `"bars"` status bar display format (`Gemini 5h ▓▓▓▓░ 86% · 1w ▓▓░░░ 37%`) and QuickPick cycling.
- Upgraded status bar hover tooltip to a cleanly aligned Markdown table.

## 1.0.0 — 2026-11-25

- Initial release of **AG Quota Monitor** (`flavio6931.ag-quota-monitor`).
- Uses the official Antigravity CLI (`agy`) zero-token JSON commands (`/usage`, `/credits`, `/model`, `models`) without process scraping or undocumented endpoints.
- Added Status Bar indicator with compact/detailed formats, severity colors, Markdown tooltip, and QuickPick menu.
- Added Sidebar Quota Dashboard Webview with live countdowns, AI credits, active model badge, and Available Models catalog.
- Added deduplicated threshold/reset notifications, focus-aware polling, exponential backoff, and full English/Spanish (`l10n`) localization.
