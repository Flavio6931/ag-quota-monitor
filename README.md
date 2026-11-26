# AG Quota Monitor

**AG Quota Monitor** is a lightweight, zero-dependency VS Code & Open VSX extension to track your **Antigravity** AI model quotas, 5-hour & weekly reset timers, AI credits, and active model directly from the status bar and a dedicated Sidebar Dashboard.

Unlike legacy process/port-scraping extensions that broke after `agy` removed `--csrf_token` from process arguments, **AG Quota Monitor** uses the **official, documented Antigravity CLI (`agy`) zero-token JSON interface** (`num_turns: 0`, `total_tokens: 0`).

---

## Features

- **Zero-Token Official CLI Integration:** Queries `/usage`, `/credits`, `/model`, and `models` via `execFile` (no shell injection, no process scraping, no `wmic`/`netstat` Windows locale bugs, works across Windows, macOS, Linux, and Remote environments).
- **Smart Status Bar:** Displays compact (`Gemini 90%|38%`) or detailed (`Gemini [5h: 90% | 1w: 38%]`) quota pills with severity colors (`OK`, `Warning`, `Critical`, `Exhausted`) and optional AI Credits.
- **Rich Markdown Tooltip & Quick Menu:** Hover for ASCII progress bars, exact countdowns, local reset times, and group models. Click to pin/unpin groups, toggle credits, switch format, or refresh.
- **Sidebar Quota Dashboard:** Dedicated Activity Bar view with native IDE theme styling, live countdown tickers, active model badge, AI credits balance, and a collapsible Available Models catalog.
- **Proactive Deduplicated Alerts:** Optional notifications when quotas cross configurable warning/critical/exhausted thresholds or reset back to available — never spammed twice in the same reset window.
- **Responsible Polling:** Defaults to 300s intervals, automatically pauses when the editor window loses focus, prevents overlapping requests (single-flight lock), and backs off exponentially on errors.
- **Bilingual (English & Español):** Automatically adapts to your editor display language (`vscode.l10n` & `package.nls*.json`).

---

## Requirements

- [Antigravity CLI (`agy`)](https://antigravity.google/docs/install) installed and authenticated (`agy` signed in).
- The extension auto-detects `agy` in `~/.gemini/bin`, standard installation paths, and `PATH`. You can also set a custom executable path via `agQuotaMonitor.binaryPath`.

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `agQuotaMonitor.enabled` | `true` | Enable automatic background quota polling. |
| `agQuotaMonitor.pollingInterval` | `300` | Polling interval in seconds (`60`–`3600`). |
| `agQuotaMonitor.pauseWhenUnfocused` | `true` | Pause scheduled polling while the IDE window is unfocused. |
| `agQuotaMonitor.binaryPath` | `""` | Custom path to the `agy` executable (empty = auto-detect). |
| `agQuotaMonitor.pinnedGroups` | `[]` | Group names pinned to the status bar (`[]` = all, `["none"]` = hide all). |
| `agQuotaMonitor.statusBarFormat` | `"compact"` | `"compact"` or `"detailed"`. |
| `agQuotaMonitor.showCreditsInStatusBar` | `false` | Display remaining AI credits in the status bar. |
| `agQuotaMonitor.warningThreshold` | `20` | Warning threshold percentage. |
| `agQuotaMonitor.criticalThreshold` | `5` | Critical threshold percentage. |
| `agQuotaMonitor.notifyOnLowQuota` | `true` | Notify when dropping below thresholds. |
| `agQuotaMonitor.notifyOnReset` | `false` | Notify when an exhausted bucket resets. |

---

## Commands

- `AG Quota Monitor: Refresh Quota Now` (`agQuotaMonitor.refresh`)
- `AG Quota Monitor: Show Quick Menu` (`agQuotaMonitor.showMenu`)
- `AG Quota Monitor: Open Quota Dashboard` (`agQuotaMonitor.openDashboard`)
- `AG Quota Monitor: Configure agy Binary Path` (`agQuotaMonitor.configureBinaryPath`)
- `AG Quota Monitor: Show Diagnostic Logs` (`agQuotaMonitor.showLogs`)

---

## Troubleshooting

1. **`BINARY_NOT_FOUND`**: Run **AG Quota Monitor: Configure agy Binary Path** and select your `agy` executable (for example `C:\Users\<user>\.gemini\bin\agy.exe` on Windows or `~/.gemini/bin/agy` on macOS/Linux).
2. **`AUTH_REQUIRED`**: Run `agy` once in your terminal and complete sign-in.
3. **Diagnostic Logs**: Run **AG Quota Monitor: Show Diagnostic Logs** to inspect timestamps and exact CLI diagnostics.

---

## Disclaimer

This is an **independent, open-source community extension** developed by [Flavio Morales (Flavio6931)](https://github.com/Flavio6931/ag-quota-monitor). It is **not affiliated with, endorsed by, or officially supported by Google**.

## License

[MIT](LICENSE)
