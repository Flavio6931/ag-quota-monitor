import * as vscode from 'vscode';
import { classifySeverity } from '../core/parser';
import { AgyClientError, ExtensionConfig, QuotaSnapshot } from '../core/types';
import {
	drawProgressBar,
	formatResetInfo,
	formatStatusBarText,
	getGroupShortName,
	getWindowShortLabel,
	isGroupPinned,
} from '../utils/formatting';

interface QuickMenuItem extends vscode.QuickPickItem {
	action?:
		| { type: 'toggleGroup'; groupShortName: string }
		| { type: 'refresh' }
		| { type: 'openDashboard' }
		| { type: 'toggleCredits' }
		| { type: 'toggleFormat' }
		| { type: 'openSettings' }
		| { type: 'showLogs' }
		| { type: 'configureBinary' };
}

/**
 * Administra el ítem de la barra de estado, su tooltip enriquecido y el menú rápido.
 */
export class StatusBarController implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;

	constructor(
		private readonly getSnapshot: () => QuotaSnapshot | null,
		private readonly getLastError: () => AgyClientError | null,
		private readonly getConfig: () => ExtensionConfig,
		private readonly onRefreshRequested: () => Promise<unknown>
	) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = 'agQuotaMonitor.showMenu';
		this.item.text = '$(sync~spin) AG Quota';
		this.item.tooltip = vscode.l10n.t('Click to view Antigravity quota details');
		this.item.show();
	}

	setLoading(loading: boolean): void {
		const snapshot = this.getSnapshot();
		if (loading && !snapshot) {
			this.item.text = `$(sync~spin) ${vscode.l10n.t('Loading...')}`;
			this.item.backgroundColor = undefined;
			this.item.show();
		} else if (!loading) {
			this.render();
		}
	}

	/** Actualiza el texto, color y tooltip de la barra de estado con el último estado disponible. */
	render(): void {
		const snapshot = this.getSnapshot();
		const error = this.getLastError();
		const cfg = this.getConfig();

		if (!snapshot && error) {
			this.item.text = `$(error) AG Quota`;
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			this.item.tooltip = `${vscode.l10n.t('Error')}: ${error.message}`;
			this.item.show();
			return;
		}

		if (!snapshot) {
			this.item.text = '$(pulse) AG Quota';
			this.item.backgroundColor = undefined;
			this.item.tooltip = vscode.l10n.t('Click to view Antigravity quota details');
			this.item.show();
			return;
		}

		const { text, worstSeverity } = formatStatusBarText(snapshot, cfg);
		this.item.text = text;

		if (worstSeverity === 'exhausted' || worstSeverity === 'critical') {
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (worstSeverity === 'warning') {
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			this.item.backgroundColor = undefined;
		}

		this.item.tooltip = this.buildTooltip(snapshot, cfg, error);
		this.item.show();
	}

	private buildTooltip(
		snapshot: QuotaSnapshot,
		cfg: ExtensionConfig,
		error: AgyClientError | null
	): vscode.MarkdownString {
		const md = new vscode.MarkdownString(undefined, true);
		md.isTrusted = false;

		const lines: string[] = ['**AG Quota Monitor**', ''];

		if (snapshot.activeModel) {
			lines.push(`**${vscode.l10n.t('Active Model')}:** \`${snapshot.activeModel.label}\``);
		}
		if (snapshot.credits !== undefined) {
			lines.push(`**${vscode.l10n.t('AI Credits')}:** ${snapshot.credits.remainingCredits}`);
		}
		if (snapshot.activeModel || snapshot.credits !== undefined) {
			lines.push('');
		}

		const resetLabels = {
			noActiveUsage: vscode.l10n.t('No active usage'),
			ready: vscode.l10n.t('Ready'),
		};

		for (const group of snapshot.groups) {
			lines.push(`**${group.name}**`);
			for (const bucket of group.buckets) {
				const pct =
					bucket.remainingPercentage !== undefined
						? `${bucket.remainingPercentage.toFixed(1)}%`
						: 'N/A';
				const bar = drawProgressBar(bucket.remainingPercentage, 10);
				const reset = formatResetInfo(bucket.resetTime, new Date(), resetLabels, vscode.env.language);
				const resetText = reset.absolute
					? `${reset.countdown} (${reset.absolute})`
					: reset.countdown;
				const sev = classifySeverity(
					bucket.remainingPercentage,
					cfg.warningThreshold,
					cfg.criticalThreshold
				);
				const icon =
					sev === 'exhausted' || sev === 'critical'
						? '$(error)'
						: sev === 'warning'
						? '$(warning)'
						: '$(check)';

				lines.push(
					`- ${icon} **${getWindowShortLabel(bucket.window)}:** \`${bar}\` **${pct}** — ${resetText}`
				);
			}
			if (group.models.length > 0) {
				lines.push(`  _${group.models.join(', ')}_`);
			}
			lines.push('');
		}

		if (error) {
			lines.push(`$(warning) ${error.message}`, '');
		}

		lines.push(
			`_${vscode.l10n.t('Last updated')}: ${snapshot.timestamp.toLocaleTimeString(vscode.env.language)}_`
		);

		md.value = lines.join('\n');
		return md;
	}

	/** Muestra el menú rápido interactivo para fijar grupos y ejecutar acciones. */
	async showQuickMenu(): Promise<void> {
		const pick = vscode.window.createQuickPick<QuickMenuItem>();
		pick.title = 'AG Quota Monitor';
		pick.placeholder = vscode.l10n.t('Select a group to pin/unpin or choose an action');
		pick.items = this.buildQuickMenuItems();

		pick.onDidAccept(async () => {
			const selected = pick.selectedItems[0];
			if (!selected?.action) {
				return;
			}

			const action = selected.action;
			if (action.type === 'toggleGroup') {
				await this.togglePinnedGroup(action.groupShortName);
				pick.items = this.buildQuickMenuItems();
				this.render();
				return;
			}

			pick.hide();
			switch (action.type) {
				case 'refresh':
					await this.onRefreshRequested();
					break;
				case 'openDashboard':
					await vscode.commands.executeCommand('agQuotaMonitor.openDashboard');
					break;
				case 'toggleCredits':
					await this.toggleConfigBoolean('showCreditsInStatusBar');
					break;
				case 'toggleFormat': {
					const current = this.getConfig().statusBarFormat;
					const next = current === 'compact' ? 'detailed' : 'compact';
					await vscode.workspace
						.getConfiguration('agQuotaMonitor')
						.update('statusBarFormat', next, vscode.ConfigurationTarget.Global);
					break;
				}
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
			}
		});

		pick.onDidHide(() => pick.dispose());
		pick.show();
	}

	private buildQuickMenuItems(): QuickMenuItem[] {
		const items: QuickMenuItem[] = [];
		const snapshot = this.getSnapshot();
		const cfg = this.getConfig();
		const resetLabels = {
			noActiveUsage: vscode.l10n.t('No active usage'),
			ready: vscode.l10n.t('Ready'),
		};

		if (snapshot && snapshot.groups.length > 0) {
			items.push({
				label: vscode.l10n.t('Quota Groups'),
				kind: vscode.QuickPickItemKind.Separator,
			});

			for (const group of snapshot.groups) {
				const shortName = getGroupShortName(group.name);
				const pinned = isGroupPinned(group.name, cfg.pinnedGroups);
				const pinIcon = pinned ? '$(pinned)' : '$(circle-outline)';
				const summary = group.buckets
					.map(b => {
						const pct =
							b.remainingPercentage !== undefined ? `${Math.round(b.remainingPercentage)}%` : 'N/A';
						const reset = formatResetInfo(b.resetTime, new Date(), resetLabels, vscode.env.language);
						return `${getWindowShortLabel(b.window)}: ${pct} (${reset.countdown})`;
					})
					.join('  |  ');

				items.push({
					label: `${pinIcon} ${group.name}`,
					description: pinned
						? vscode.l10n.t('Unpin from Status Bar')
						: vscode.l10n.t('Pin to Status Bar'),
					detail: `    ${summary}`,
					action: { type: 'toggleGroup', groupShortName: shortName },
				});
			}
		}

		items.push({
			label: vscode.l10n.t('Display Options'),
			kind: vscode.QuickPickItemKind.Separator,
		});

		items.push({
			label: `$(credit-card) ${
				cfg.showCreditsInStatusBar
					? vscode.l10n.t('Hide AI Credits in Status Bar')
					: vscode.l10n.t('Show AI Credits in Status Bar')
			}`,
			description:
				snapshot?.credits !== undefined
					? `${vscode.l10n.t('AI Credits')}: ${snapshot.credits.remainingCredits}`
					: undefined,
			action: { type: 'toggleCredits' },
		});

		items.push({
			label: `$(list-flat) ${
				cfg.statusBarFormat === 'compact'
					? vscode.l10n.t('Status Bar Format: Detailed')
					: vscode.l10n.t('Status Bar Format: Compact')
			}`,
			action: { type: 'toggleFormat' },
		});

		items.push({
			label: vscode.l10n.t('Actions'),
			kind: vscode.QuickPickItemKind.Separator,
		});

		items.push(
			{
				label: `$(refresh) ${vscode.l10n.t('Refresh Quota Now')}`,
				action: { type: 'refresh' },
			},
			{
				label: `$(dashboard) ${vscode.l10n.t('Open Quota Dashboard')}`,
				action: { type: 'openDashboard' },
			},
			{
				label: `$(gear) ${vscode.l10n.t('Open Settings')}`,
				action: { type: 'openSettings' },
			},
			{
				label: `$(terminal) ${vscode.l10n.t('Configure agy Binary Path')}`,
				action: { type: 'configureBinary' },
			},
			{
				label: `$(output) ${vscode.l10n.t('Show Diagnostic Logs')}`,
				action: { type: 'showLogs' },
			}
		);

		return items;
	}

	private async toggleConfigBoolean(key: 'showCreditsInStatusBar'): Promise<void> {
		const config = vscode.workspace.getConfiguration('agQuotaMonitor');
		const current = config.get<boolean>(key, false);
		await config.update(key, !current, vscode.ConfigurationTarget.Global);
	}

	/** Alterna el estado fijado de un grupo en la configuración global del usuario. */
	async togglePinnedGroup(groupShortName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('agQuotaMonitor');
		const snapshot = this.getSnapshot();
		const allShortNames = (snapshot?.groups ?? []).map(g => getGroupShortName(g.name));
		let pinned = [...(config.get<string[]>('pinnedGroups') || [])];

		if (pinned.length === 0) {
			pinned = allShortNames.filter(name => name.toLowerCase() !== groupShortName.toLowerCase());
			if (pinned.length === 0) {
				pinned = ['none'];
			}
		} else {
			const clean = pinned.filter(p => p.toLowerCase() !== 'none');
			const exists = clean.some(p => p.toLowerCase() === groupShortName.toLowerCase());
			if (exists) {
				pinned = clean.filter(p => p.toLowerCase() !== groupShortName.toLowerCase());
				if (pinned.length === 0) {
					pinned = ['none'];
				}
			} else {
				pinned = [...clean, groupShortName];
				if (
					allShortNames.length > 0 &&
					allShortNames.every(name => pinned.some(p => p.toLowerCase() === name.toLowerCase()))
				) {
					pinned = [];
				}
			}
		}

		await config.update('pinnedGroups', pinned, vscode.ConfigurationTarget.Global);
	}

	dispose(): void {
		this.item.dispose();
	}
}
