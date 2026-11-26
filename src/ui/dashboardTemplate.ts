import { classifySeverity } from '../core/parser';
import {
	AgyClientError,
	ExtensionConfig,
	QuotaGroup,
	QuotaSeverity,
	QuotaSnapshot,
} from '../core/types';
import {
	findTightestBucket,
	formatResetInfo,
	getGroupShortName,
	getWindowShortLabel,
	isGroupPinned,
} from '../utils/formatting';

export interface DashboardStrings {
	live: string;
	pausedUnfocused: string;
	loading: string;
	refresh: string;
	cycleFormat: string;
	settings: string;
	error: string;
	configurePath: string;
	logs: string;
	tightestLimit: string;
	activeModel: string;
	aiCredits: string;
	upgradeCredits: string;
	pinned: string;
	pinToStatusBar: string;
	fiveHourShort: string;
	weeklyShort: string;
	resetsIn: string;
	noActiveUsage: string;
	ready: string;
	availableNow: string;
	modelsInGroup: string;
	availableModels: string;
	waitingSnapshot: string;
	noQuotaData: string;
	lastUpdated: string;
	healthy: string;
	warning: string;
	critical: string;
	exhausted: string;
	unknown: string;
}

export interface DashboardRenderParams {
	snapshot: QuotaSnapshot | null;
	error: AgyClientError | null;
	config: ExtensionConfig;
	focused: boolean;
	loading: boolean;
	locale: string;
	cspSource: string;
	nonce: string;
	strings: DashboardStrings;
	now?: Date;
}

const SEVERITY_RANK: Record<QuotaSeverity, number> = {
	unknown: 0,
	ok: 1,
	warning: 2,
	critical: 3,
	exhausted: 4,
};

const RING_RADIUS = 29;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Escapa caracteres especiales para evitar inyección HTML en el Webview. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Valida que enlaces externos de mejora apunten únicamente a antigravity.google vía HTTPS. */
export function isAllowedUpgradeUri(rawUri: string): boolean {
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

function severityLabel(severity: QuotaSeverity, strings: DashboardStrings): string {
	switch (severity) {
		case 'ok':
			return strings.healthy;
		case 'warning':
			return strings.warning;
		case 'critical':
			return strings.critical;
		case 'exhausted':
			return strings.exhausted;
		default:
			return strings.unknown;
	}
}

function groupWorstSeverity(group: QuotaGroup, cfg: ExtensionConfig): QuotaSeverity {
	let worst: QuotaSeverity = 'ok';
	for (const bucket of group.buckets) {
		const sev = classifySeverity(bucket.remainingPercentage, cfg.warningThreshold, cfg.criticalThreshold);
		if (SEVERITY_RANK[sev] > SEVERITY_RANK[worst]) {
			worst = sev;
		}
	}
	return worst;
}

function groupAccentClass(groupName: string): string {
	const lower = groupName.toLowerCase();
	if (lower.includes('claude') || lower.includes('gpt')) {
		return 'dot-violet';
	}
	return 'dot-cyan';
}

function renderRadialRing(pct: number | undefined, windowBadge: string, severity: QuotaSeverity): string {
	const clamped = pct === undefined || Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
	const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
	const pctDisplay = pct !== undefined && !Number.isNaN(pct) ? `${Math.round(pct)}%` : 'N/A';

	return `<div class="ring-wrap">
		<svg class="ring-svg" viewBox="0 0 74 74" width="74" height="74" aria-hidden="true">
			<circle class="ring-track" cx="37" cy="37" r="${RING_RADIUS}" />
			<circle class="ring-arc sev-arc-${severity}" cx="37" cy="37" r="${RING_RADIUS}"
				stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
				stroke-dashoffset="${offset.toFixed(2)}" />
		</svg>
		<div class="ring-center">
			<span class="ring-pct">${escapeHtml(pctDisplay)}</span>
			<span class="ring-win sev-text-${severity}">${escapeHtml(windowBadge)}</span>
		</div>
	</div>`;
}

/**
 * Genera el HTML completo del Sidebar Dashboard inspirado en el diseño Figma v1.1.
 */
export function renderDashboardHtml(params: DashboardRenderParams): string {
	const { snapshot, error, config, focused, loading, locale, cspSource, nonce, strings } = params;
	const now = params.now ?? new Date();
	const resetLabels = { noActiveUsage: strings.noActiveUsage, ready: strings.ready };

	const isPaused = config.pauseWhenUnfocused && !focused;
	const timeLabel = snapshot ? snapshot.timestamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
	const statusPill = isPaused
		? `<span class="pill pill-muted"><span class="pill-dot"></span>${escapeHtml(strings.pausedUnfocused)}</span>`
		: `<span class="pill pill-live"><span class="pill-dot pulse"></span>${escapeHtml(strings.live)}${
				timeLabel ? ` · ${escapeHtml(timeLabel)}` : ''
		  }</span>`;

	const errorHtml = error
		? `<div class="alert-card">
			<div class="alert-title">${escapeHtml(strings.error)} · ${escapeHtml(error.code)}</div>
			<div class="alert-msg">${escapeHtml(error.message)}</div>
			<div class="alert-actions">
				${
					error.code === 'BINARY_NOT_FOUND'
						? `<button class="btn-primary" data-action="configureBinary">${escapeHtml(strings.configurePath)}</button>`
						: ''
				}
				<button class="btn-secondary" data-action="showLogs">${escapeHtml(strings.logs)}</button>
			</div>
		</div>`
		: '';

	let calloutHtml = '';
	if (snapshot) {
		const tightest = findTightestBucket(snapshot);
		if (tightest) {
			const sev = classifySeverity(
				tightest.bucket.remainingPercentage,
				config.warningThreshold,
				config.criticalThreshold
			);
			const pctText = `${Math.round(tightest.bucket.remainingPercentage ?? 0)}%`;
			const reset = formatResetInfo(tightest.bucket.resetTime, now, resetLabels, locale);
			const shortGroup = getGroupShortName(tightest.groupName);
			const winLabel = getWindowShortLabel(tightest.bucket.window);
			calloutHtml = `<div class="callout callout-${sev}">
				<span class="callout-text">
					<strong>${escapeHtml(strings.tightestLimit)}</strong> · ${escapeHtml(shortGroup)} ${escapeHtml(winLabel)}
					<strong>${escapeHtml(pctText)}</strong> · ${escapeHtml(strings.resetsIn)} ${escapeHtml(reset.countdown)}
				</span>
			</div>`;
		}
	}

	const bentoHtml = snapshot
		? `<div class="bento-grid">
			${
				snapshot.activeModel
					? `<div class="bento-tile">
						<div class="bento-label">${escapeHtml(strings.activeModel)}</div>
						<div class="bento-val" title="${escapeHtml(snapshot.activeModel.label)}">${escapeHtml(
							snapshot.activeModel.label
						)}</div>
					</div>`
					: ''
			}
			${
				snapshot.credits !== undefined
					? `<div class="bento-tile">
						<div class="bento-label">${escapeHtml(strings.aiCredits)}</div>
						<div class="bento-row">
							<span class="bento-val mono">${snapshot.credits.remainingCredits} cr</span>
							${
								snapshot.credits.upgradeUri && isAllowedUpgradeUri(snapshot.credits.upgradeUri)
									? `<button class="link-btn" data-action="openUpgrade" data-uri="${escapeHtml(
											snapshot.credits.upgradeUri
									  )}">${escapeHtml(strings.upgradeCredits)} ↗</button>`
									: ''
							}
						</div>
					</div>`
					: ''
			}
		</div>`
		: '';

	let groupsHtml = '';
	if (snapshot && snapshot.groups.length > 0) {
		groupsHtml = snapshot.groups
			.map(group => {
				const shortName = getGroupShortName(group.name);
				const pinned = isGroupPinned(group.name, config.pinnedGroups);
				const worstSev = groupWorstSeverity(group, config);

				const gaugesHtml = group.buckets
					.map(bucket => {
						const pct = bucket.remainingPercentage;
						const severity = classifySeverity(pct, config.warningThreshold, config.criticalThreshold);
						const reset = formatResetInfo(bucket.resetTime, now, resetLabels, locale);
						const winCode = getWindowShortLabel(bucket.window).toUpperCase();
						const resetMs = bucket.resetTime ? bucket.resetTime.getTime() : 0;
						const subText = reset.absolute ?? (bucket.resetTime ? '' : strings.availableNow);

						return `<div class="gauge-card">
							${renderRadialRing(pct, winCode, severity)}
							<div class="gauge-countdown mono" data-reset-ms="${resetMs}" data-ready="${escapeHtml(strings.ready)}">
								${escapeHtml(reset.countdown)}
							</div>
							${subText ? `<div class="gauge-sub mono">${escapeHtml(subText)}</div>` : ''}
						</div>`;
					})
					.join('');

				const chipsHtml =
					group.models.length > 0
						? `<details class="models-details">
							<summary>${escapeHtml(strings.modelsInGroup)} (${group.models.length})</summary>
							<div class="chip-list">
								${group.models.map(m => `<span class="model-chip">${escapeHtml(m)}</span>`).join('')}
							</div>
						</details>`
						: '';

				return `<section class="card">
					<div class="card-head">
						<div class="card-title-wrap">
							<span class="group-dot ${groupAccentClass(group.name)}"></span>
							<h3 class="card-title">${escapeHtml(group.name)}</h3>
						</div>
						<div class="card-controls">
							<span class="pill pill-sev-${worstSev}">
								<span class="pill-dot"></span>${escapeHtml(severityLabel(worstSev, strings))}
							</span>
							<button class="pin-btn ${pinned ? 'is-pinned' : ''}" data-action="togglePin" data-group="${escapeHtml(
								shortName
							)}" title="${escapeHtml(pinned ? strings.pinned : strings.pinToStatusBar)}">
								${escapeHtml(pinned ? strings.pinned : strings.pinToStatusBar)}
							</button>
						</div>
					</div>
					<div class="gauge-grid">${gaugesHtml}</div>
					${chipsHtml}
				</section>`;
			})
			.join('');
	} else if (!error) {
		groupsHtml = `<div class="empty-state">${escapeHtml(
			loading ? strings.waitingSnapshot : strings.noQuotaData
		)}</div>`;
	}

	const catalogHtml =
		snapshot && snapshot.availableModels.length > 0
			? `<details class="card catalog-card">
				<summary class="catalog-summary">${escapeHtml(strings.availableModels)} (${
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

	const footerHtml = snapshot
		? `<footer class="footer">${escapeHtml(strings.lastUpdated)}: ${escapeHtml(
				snapshot.timestamp.toLocaleTimeString(locale)
		  )}</footer>`
		: '';

	return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
	:root {
		color-scheme: light dark;
		--ag-ok: var(--vscode-testing-iconPassed, #34d399);
		--ag-warn: var(--vscode-editorWarning-foreground, #fbbf24);
		--ag-crit: var(--vscode-editorError-foreground, #fb7185);
		--ag-accent: var(--vscode-textLink-foreground, #22d3ee);
		--ag-surface: var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, 0.08));
		--ag-elevated: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.12));
		--ag-border: var(--vscode-panel-border, rgba(127, 127, 127, 0.24));
	}
	* { box-sizing: border-box; }
	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		background: transparent;
		padding: 10px;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mono {
		font-family: var(--vscode-editor-font-family, monospace);
		font-variant-numeric: tabular-nums;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.toolbar-actions { display: flex; gap: 5px; }
	button {
		cursor: pointer;
		font-family: inherit;
		font-size: 11px;
		border-radius: 6px;
		border: 1px solid var(--ag-border);
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		background: var(--ag-surface);
		color: var(--vscode-foreground);
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--ag-elevated);
		border-color: var(--ag-accent);
	}
	.icon-btn:disabled { opacity: 0.5; cursor: default; }
	.spin svg { animation: ag-spin 1s linear infinite; }
	@keyframes ag-spin { to { transform: rotate(360deg); } }
	.btn-primary {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border-color: transparent;
		padding: 5px 10px;
		font-weight: 600;
	}
	.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
	.btn-secondary {
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
		padding: 5px 10px;
	}
	.link-btn {
		background: transparent;
		border: none;
		color: var(--ag-accent);
		padding: 0;
		font-size: 10px;
		font-weight: 600;
	}
	.link-btn:hover { text-decoration: underline; }
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.pill-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.pill-dot.pulse { animation: ag-pulse 2s ease-in-out infinite; }
	@keyframes ag-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
	.pill-live, .pill-sev-ok {
		background: color-mix(in srgb, var(--ag-ok) 14%, transparent);
		border-color: color-mix(in srgb, var(--ag-ok) 35%, transparent);
		color: var(--ag-ok);
	}
	.pill-sev-warning {
		background: color-mix(in srgb, var(--ag-warn) 14%, transparent);
		border-color: color-mix(in srgb, var(--ag-warn) 35%, transparent);
		color: var(--ag-warn);
	}
	.pill-sev-critical, .pill-sev-exhausted {
		background: color-mix(in srgb, var(--ag-crit) 14%, transparent);
		border-color: color-mix(in srgb, var(--ag-crit) 35%, transparent);
		color: var(--ag-crit);
	}
	.pill-muted, .pill-sev-unknown {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
	}
	.callout {
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.35;
		border: 1px solid color-mix(in srgb, var(--ag-accent) 35%, transparent);
		background: color-mix(in srgb, var(--ag-accent) 10%, transparent);
	}
	.callout-warning {
		border-color: color-mix(in srgb, var(--ag-warn) 40%, transparent);
		background: color-mix(in srgb, var(--ag-warn) 10%, transparent);
	}
	.callout-critical, .callout-exhausted {
		border-color: color-mix(in srgb, var(--ag-crit) 45%, transparent);
		background: color-mix(in srgb, var(--ag-crit) 12%, transparent);
	}
	.bento-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.bento-tile, .card {
		background: var(--ag-surface);
		border: 1px solid var(--ag-border);
		border-radius: 10px;
		padding: 9px 10px;
	}
	.bento-label {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 3px;
	}
	.bento-val {
		font-size: 11.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bento-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 11px;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		flex-wrap: wrap;
	}
	.card-title-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.group-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot-cyan { background: var(--ag-accent); }
	.dot-violet { background: #a78bfa; }
	.card-title {
		margin: 0;
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.card-controls {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.pin-btn {
		background: var(--ag-elevated);
		color: var(--vscode-descriptionForeground);
		padding: 2px 7px;
		font-size: 10px;
		font-weight: 500;
	}
	.pin-btn.is-pinned {
		background: color-mix(in srgb, var(--ag-accent) 16%, transparent);
		border-color: color-mix(in srgb, var(--ag-accent) 45%, transparent);
		color: var(--ag-accent);
	}
	.gauge-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	@media (max-width: 240px) {
		.gauge-grid, .bento-grid { grid-template-columns: 1fr; }
	}
	.gauge-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 9px 6px;
		border-radius: 9px;
		background: var(--ag-elevated);
		border: 1px solid var(--ag-border);
		text-align: center;
	}
	.ring-wrap {
		position: relative;
		width: 74px;
		height: 74px;
	}
	.ring-svg { transform: rotate(-90deg); display: block; }
	.ring-track {
		fill: none;
		stroke: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
		stroke-width: 6.5;
	}
	.ring-arc {
		fill: none;
		stroke-width: 6.5;
		stroke-linecap: round;
		transition: stroke-dashoffset 0.35s ease;
	}
	.sev-arc-ok { stroke: var(--ag-ok); }
	.sev-arc-warning { stroke: var(--ag-warn); }
	.sev-arc-critical, .sev-arc-exhausted { stroke: var(--ag-crit); }
	.sev-arc-unknown { stroke: var(--vscode-descriptionForeground); }
	.sev-text-ok { color: var(--ag-ok); }
	.sev-text-warning { color: var(--ag-warn); }
	.sev-text-critical, .sev-text-exhausted { color: var(--ag-crit); }
	.sev-text-unknown { color: var(--vscode-descriptionForeground); }
	.ring-center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		line-height: 1.1;
	}
	.ring-pct {
		font-family: var(--vscode-editor-font-family, monospace);
		font-variant-numeric: tabular-nums;
		font-size: 13.5px;
		font-weight: 700;
	}
	.ring-win {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 9px;
		font-weight: 700;
		margin-top: 2px;
	}
	.gauge-countdown { font-size: 11px; font-weight: 600; }
	.gauge-sub { font-size: 9.5px; color: var(--vscode-descriptionForeground); }
	.models-details summary, .catalog-summary {
		cursor: pointer;
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		user-select: none;
	}
	.catalog-summary { font-weight: 600; color: var(--vscode-foreground); }
	.chip-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.model-chip {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 5px;
		background: var(--ag-elevated);
		border: 1px solid var(--ag-border);
	}
	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 8px;
		max-height: 220px;
		overflow-y: auto;
	}
	.catalog-item {
		display: flex;
		flex-direction: column;
		font-size: 11px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--ag-border);
	}
	.catalog-id { font-size: 10px; color: var(--vscode-descriptionForeground); }
	.alert-card {
		border: 1px solid color-mix(in srgb, var(--ag-crit) 50%, transparent);
		background: color-mix(in srgb, var(--ag-crit) 10%, transparent);
		border-radius: 10px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.alert-title { font-weight: 700; color: var(--ag-crit); font-size: 12px; }
	.alert-msg { font-size: 11px; line-height: 1.4; word-break: break-word; }
	.alert-actions { display: flex; gap: 6px; flex-wrap: wrap; }
	.empty-state, .footer {
		text-align: center;
		font-size: 10.5px;
		color: var(--vscode-descriptionForeground);
		padding: 6px 2px;
	}
</style>
</head>
<body>
	<div class="toolbar">
		${statusPill}
		<div class="toolbar-actions">
			<button class="icon-btn ${loading ? 'spin' : ''}" data-action="refresh" ${loading ? 'disabled' : ''} title="${escapeHtml(
				loading ? strings.loading : strings.refresh
			)}" aria-label="${escapeHtml(strings.refresh)}">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
			</button>
			<button class="icon-btn" data-action="cycleFormat" title="${escapeHtml(strings.cycleFormat)}" aria-label="${escapeHtml(
				strings.cycleFormat
			)}">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h14"/></svg>
			</button>
			<button class="icon-btn" data-action="openSettings" title="${escapeHtml(strings.settings)}" aria-label="${escapeHtml(
				strings.settings
			)}">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
			</button>
		</div>
	</div>
	${errorHtml}
	${calloutHtml}
	${bentoHtml}
	${groupsHtml}
	${catalogHtml}
	${footerHtml}
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
		document.querySelectorAll('.gauge-countdown[data-reset-ms]').forEach((el) => {
			const resetMs = Number(el.getAttribute('data-reset-ms'));
			if (!resetMs) return;
			const diff = resetMs - now;
			el.textContent = diff <= 0 ? (el.getAttribute('data-ready') || 'Ready') : formatDuration(diff);
		});
	}, 60000);
</script>
</body>
</html>`;
}
