import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { classifySeverity } from '../core/parser';
import { AgyClientError, ExtensionConfig, QuotaSeverity, QuotaSnapshot } from '../core/types';
import { formatResetInfo, getGroupShortName, isGroupPinned } from '../utils/formatting';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function isAllowedUpgradeUri(rawUri: string): boolean {
	try {
		const parsed = new URL(rawUri);
		return (
			parsed.protocol === 'https:' &&
			(parsed.hostname === 'antigravity.google' || parsed.hostname.endsWith('.antigravity.google'))
		);
	} catch {
		return false;
	}
}

/**
 * Proveedor del panel lateral Webview con tarjetas interactivas, barras de progreso
 * y contadores regresivos en vivo.
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'agQuotaMonitor.dashboardView';

	private view?: vscode.WebviewView;
	private loading = false;

	constructor(
		private readonly getSnapshot: () => QuotaSnapshot | null,
		private readonly getLastError: () => AgyClientError | null,
		private readonly getConfig: () => ExtensionConfig,
		private readonly isFocused: () => boolean,
		private readonly onTogglePin: (groupShortName: string) => Promise<void>,
		private readonly onRefresh: () => Promise<unknown>
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
		};

		webviewView.webview.onDidReceiveMessage(async (msg: unknown) => {
			if (!msg || typeof msg !== 'object') {
				return;
			}
			const payload = msg as { type?: unknown; groupShortName?: unknown; uri?: unknown };
			switch (payload.type) {
				case 'refresh':
					await this.onRefresh();
					break;
				case 'togglePin':
					if (typeof payload.groupShortName === 'string' && payload.groupShortName.trim()) {
						await this.onTogglePin(payload.groupShortName.trim());
					}
					break;
				case 'openSettings':
					await vscode.commands.executeCommand(
						'workbench.action.openSettings',
						'@ext:flavio6931.ag-quota-monitor'
					);
					break;
				case 'configureBinary':
					await vscode.commands.executeCommand('agQuotaMonitor.configureBinaryPath');
					break;
				case 'showLogs':
					await vscode.commands.executeCommand('agQuotaMonitor.showLogs');
					break;
				case 'openUpgrade':
					if (typeof payload.uri === 'string' && isAllowedUpgradeUri(payload.uri)) {
						await vscode.env.openExternal(vscode.Uri.parse(payload.uri));
					}
					break;
			}
		});

		this.render();
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
		this.render();
	}

	render(): void {
		if (!this.view) {
			return;
		}
		this.view.webview.html = this.buildHtml(this.view.webview);
	}

	private severityLabel(severity: QuotaSeverity): string {
		switch (severity) {
			case 'ok':
				return vscode.l10n.t('Healthy');
			case 'warning':
				return vscode.l10n.t('Warning');
			case 'critical':
				return vscode.l10n.t('Critical');
			case 'exhausted':
				return vscode.l10n.t('Exhausted');
			default:
				return vscode.l10n.t('Unknown');
		}
	}

	private buildHtml(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('base64');
		const snapshot = this.getSnapshot();
		const error = this.getLastError();
		const cfg = this.getConfig();
		const focused = this.isFocused();

		const resetLabels = {
			noActiveUsage: vscode.l10n.t('No active usage'),
			ready: vscode.l10n.t('Ready'),
		};

		const statusBadge =
			cfg.pauseWhenUnfocused && !focused
				? `<span class="pill pill-muted">${escapeHtml(vscode.l10n.t('Paused (unfocused)'))}</span>`
				: `<span class="pill pill-live">${escapeHtml(vscode.l10n.t('Live'))}</span>`;

		const headerMeta = snapshot
			? `<div class="meta-grid">
				${
					snapshot.activeModel
						? `<div class="meta-card">
							<div class="meta-label">${escapeHtml(vscode.l10n.t('Active Model'))}</div>
							<div class="meta-value">${escapeHtml(snapshot.activeModel.label)}</div>
						</div>`
						: ''
				}
				${
					snapshot.credits !== undefined
						? `<div class="meta-card">
							<div class="meta-label">${escapeHtml(vscode.l10n.t('AI Credits'))}</div>
							<div class="meta-row">
								<span class="meta-value">${snapshot.credits.remainingCredits}</span>
								${
									snapshot.credits.upgradeUri && isAllowedUpgradeUri(snapshot.credits.upgradeUri)
										? `<button class="link-btn" data-action="openUpgrade" data-uri="${escapeHtml(
												snapshot.credits.upgradeUri
										  )}">${escapeHtml(vscode.l10n.t('Upgrade / Get Credits'))}</button>`
										: ''
								}
							</div>
						</div>`
						: ''
				}
			</div>`
			: '';

		const errorBanner = error
			? `<div class="alert-box">
				<div class="alert-title">${escapeHtml(vscode.l10n.t('Error'))} (${escapeHtml(error.code)})</div>
				<div class="alert-msg">${escapeHtml(error.message)}</div>
				<div class="alert-actions">
					${
						error.code === 'BINARY_NOT_FOUND'
							? `<button class="btn-secondary" data-action="configureBinary">${escapeHtml(
									vscode.l10n.t('Configure Path')
							  )}</button>`
							: ''
					}
					<button class="btn-secondary" data-action="showLogs">${escapeHtml(
						vscode.l10n.t('Logs')
					)}</button>
				</div>
			</div>`
			: '';

		let groupsHtml = '';
		if (snapshot && snapshot.groups.length > 0) {
			groupsHtml = snapshot.groups
				.map(group => {
					const shortName = getGroupShortName(group.name);
					const pinned = isGroupPinned(group.name, cfg.pinnedGroups);

					const bucketsHtml = group.buckets
						.map(bucket => {
							const pct = bucket.remainingPercentage;
							const pctLabel = pct !== undefined ? `${pct.toFixed(1)}%` : 'N/A';
							const widthPct = pct !== undefined ? Math.max(0, Math.min(100, pct)) : 0;
							const severity = classifySeverity(pct, cfg.warningThreshold, cfg.criticalThreshold);
							const reset = formatResetInfo(
								bucket.resetTime,
								new Date(),
								resetLabels,
								vscode.env.language
							);
							const windowTitle =
								bucket.window === '5h'
									? vscode.l10n.t('5-Hour Window')
									: bucket.window === 'weekly'
									? vscode.l10n.t('Weekly Window')
									: bucket.name;

							const resetTimeMs = bucket.resetTime ? bucket.resetTime.getTime() : 0;

							return `<div class="bucket">
								<div class="bucket-head">
									<span class="bucket-title">${escapeHtml(windowTitle)}</span>
									<span class="bucket-right">
										<span class="sev-badge sev-${severity}">${escapeHtml(this.severityLabel(severity))}</span>
										<strong>${escapeHtml(pctLabel)}</strong>
									</span>
								</div>
								<div class="bar-track">
									<div class="bar-fill sev-fill-${severity}" style="width: ${widthPct.toFixed(1)}%"></div>
								</div>
								<div class="bucket-foot">
									<span class="countdown" data-reset-ms="${resetTimeMs}" data-no-usage="${escapeHtml(
										resetLabels.noActiveUsage
									)}" data-ready="${escapeHtml(resetLabels.ready)}">
										${escapeHtml(vscode.l10n.t('Resets in'))}: ${escapeHtml(reset.countdown)}
									</span>
									${reset.absolute ? `<span class="abs-time">${escapeHtml(reset.absolute)}</span>` : ''}
								</div>
							</div>`;
						})
						.join('');

					const modelsBlock =
						group.models.length > 0
							? `<details class="models-details">
								<summary>${escapeHtml(vscode.l10n.t('Models in group'))} (${group.models.length})</summary>
								<div class="tag-list">${group.models
									.map(m => `<span class="model-tag">${escapeHtml(m)}</span>`)
									.join('')}</div>
							</details>`
							: '';

					return `<section class="card">
						<div class="card-head">
							<h3 class="card-title">${escapeHtml(group.name)}</h3>
							<button class="pin-btn ${pinned ? 'is-pinned' : ''}" data-action="togglePin" data-group="${escapeHtml(
								shortName
							)}">${escapeHtml(
								pinned ? vscode.l10n.t('Pinned') : vscode.l10n.t('Pin to Status Bar')
							)}</button>
						</div>
						${bucketsHtml}
						${modelsBlock}
					</section>`;
				})
				.join('');
		} else if (!error) {
			groupsHtml = `<div class="empty-state">${escapeHtml(
				this.loading
					? vscode.l10n.t('Waiting for initial quota snapshot...')
					: vscode.l10n.t('No quota data available yet.')
			)}</div>`;
		}

		const catalogHtml =
			snapshot && snapshot.availableModels.length > 0
				? `<details class="card catalog-card">
					<summary class="catalog-summary">${escapeHtml(vscode.l10n.t('Available Models'))} (${
						snapshot.availableModels.length
				  })</summary>
					<div class="catalog-list">
						${snapshot.availableModels
							.map(
								m => `<div class="catalog-item">
									<span class="catalog-label">${escapeHtml(m.label)}</span>
									<code class="catalog-id">${escapeHtml(m.id)}</code>
								</div>`
							)
							.join('')}
					</div>
				</details>`
				: '';

		const footerTimestamp = snapshot
			? `<footer class="footer">${escapeHtml(vscode.l10n.t('Last updated'))}: ${escapeHtml(
					snapshot.timestamp.toLocaleTimeString(vscode.env.language)
			  )}</footer>`
			: '';

		return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
	:root {
		color-scheme: light dark;
	}
	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		background: transparent;
		padding: 10px;
		margin: 0;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
	}
	.toolbar-actions {
		display: flex;
		gap: 6px;
	}
	button {
		cursor: pointer;
		font-family: inherit;
		font-size: 11px;
		border-radius: 4px;
		border: 1px solid var(--vscode-button-border, transparent);
		padding: 4px 8px;
	}
	.btn-primary {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
	.btn-secondary {
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
	}
	.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
	.link-btn {
		background: transparent;
		border: none;
		color: var(--vscode-textLink-foreground);
		padding: 0;
		text-decoration: underline;
	}
	.pill {
		font-size: 10px;
		padding: 2px 7px;
		border-radius: 999px;
		font-weight: 600;
	}
	.pill-live {
		background: color-mix(in srgb, var(--vscode-testing-iconPassed, #22c55e) 18%, transparent);
		color: var(--vscode-testing-iconPassed, #22c55e);
	}
	.pill-muted {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
	}
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
		margin-bottom: 10px;
	}
	.meta-card, .card {
		background: var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, 0.08));
		border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
		border-radius: 6px;
		padding: 10px;
		margin-bottom: 10px;
	}
	.meta-card { margin-bottom: 0; }
	.meta-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 2px;
	}
	.meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.meta-value { font-weight: 600; }
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}
	.card-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}
	.pin-btn {
		background: transparent;
		border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.3));
		color: var(--vscode-descriptionForeground);
		padding: 2px 7px;
		font-size: 10px;
	}
	.pin-btn.is-pinned {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
	}
	.bucket { margin-bottom: 10px; }
	.bucket:last-of-type { margin-bottom: 4px; }
	.bucket-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
		font-size: 12px;
	}
	.bucket-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sev-badge {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 4px;
	}
	.sev-ok { color: var(--vscode-testing-iconPassed, #22c55e); }
	.sev-warning { color: var(--vscode-editorWarning-foreground, #eab308); }
	.sev-critical, .sev-exhausted { color: var(--vscode-editorError-foreground, #ef4444); }
	.bar-track {
		height: 7px;
		border-radius: 999px;
		background: var(--vscode-progressBar-background, rgba(127,127,127,0.22));
		background-color: rgba(127, 127, 127, 0.22);
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.25s ease;
	}
	.sev-fill-ok { background: var(--vscode-testing-iconPassed, #22c55e); }
	.sev-fill-warning { background: var(--vscode-editorWarning-foreground, #eab308); }
	.sev-fill-critical, .sev-fill-exhausted { background: var(--vscode-editorError-foreground, #ef4444); }
	.sev-fill-unknown { background: var(--vscode-descriptionForeground); }
	.bucket-foot {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
	}
	.models-details summary, .catalog-summary {
		cursor: pointer;
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		margin-top: 6px;
	}
	.catalog-summary { margin-top: 0; font-weight: 600; color: var(--vscode-foreground); }
	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.model-tag {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
	}
	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
		max-height: 220px;
		overflow-y: auto;
	}
	.catalog-item {
		display: flex;
		flex-direction: column;
		font-size: 11px;
		padding-bottom: 4px;
		border-bottom: 1px solid rgba(127,127,127,0.12);
	}
	.catalog-id {
		font-size: 10px;
		color: var(--vscode-descriptionForeground);
	}
	.alert-box {
		border: 1px solid var(--vscode-editorError-foreground, #ef4444);
		background: color-mix(in srgb, var(--vscode-editorError-foreground, #ef4444) 10%, transparent);
		border-radius: 6px;
		padding: 10px;
		margin-bottom: 10px;
	}
	.alert-title { font-weight: 600; margin-bottom: 4px; }
	.alert-msg { font-size: 11px; margin-bottom: 8px; word-break: break-word; }
	.alert-actions { display: flex; gap: 6px; }
	.empty-state, .footer {
		text-align: center;
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		padding: 12px 4px;
	}
</style>
</head>
<body>
	<div class="toolbar">
		${statusBadge}
		<div class="toolbar-actions">
			<button class="btn-primary" data-action="refresh" ${this.loading ? 'disabled' : ''}>
				${escapeHtml(this.loading ? vscode.l10n.t('Loading...') : vscode.l10n.t('Refresh'))}
			</button>
			<button class="btn-secondary" data-action="openSettings">${escapeHtml(vscode.l10n.t('Settings'))}</button>
		</div>
	</div>
	${errorBanner}
	${headerMeta}
	${groupsHtml}
	${catalogHtml}
	${footerTimestamp}
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	document.addEventListener('click', (event) => {
		const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
		if (!target) return;
		const action = target.getAttribute('data-action');
		if (action === 'togglePin') {
			vscode.postMessage({ type: 'togglePin', groupShortName: target.getAttribute('data-group') });
		} else if (action === 'openUpgrade') {
			vscode.postMessage({ type: 'openUpgrade', uri: target.getAttribute('data-uri') });
		} else {
			vscode.postMessage({ type: action });
		}
	});

	function formatDuration(ms) {
		if (ms <= 0) return '0m';
		const mins = Math.ceil(ms / 60000);
		if (mins < 60) return mins + 'm';
		const hours = Math.floor(mins / 60);
		const remMins = mins % 60;
		if (hours < 24) return remMins > 0 ? hours + 'h ' + remMins + 'm' : hours + 'h';
		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return remHours > 0 ? days + 'd ' + remHours + 'h' : days + 'd';
	}

	setInterval(() => {
		const now = Date.now();
		document.querySelectorAll('.countdown[data-reset-ms]').forEach((el) => {
			const resetMs = Number(el.getAttribute('data-reset-ms'));
			if (!resetMs) return;
			const diff = resetMs - now;
			const labelPrefix = el.textContent.split(':')[0] || 'Resets in';
			if (diff <= 0) {
				el.textContent = labelPrefix + ': ' + (el.getAttribute('data-ready') || 'Ready');
			} else {
				el.textContent = labelPrefix + ': ' + formatDuration(diff);
			}
		});
	}, 60000);
</script>
</body>
</html>`;
	}
}
