import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { AgyClientError, ExtensionConfig, QuotaSnapshot, StatusBarFormat } from '../core/types';
import { isAllowedUpgradeUri, renderDashboardHtml } from './dashboardTemplate';

/**
 * Proveedor del panel lateral Webview con diseño radial Figma v1.1,
 * tarjetas bento y contadores regresivos en vivo.
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
				case 'cycleFormat': {
					const order: StatusBarFormat[] = ['compact', 'detailed', 'bars'];
					const current = this.getConfig().statusBarFormat;
					const next = order[(order.indexOf(current) + 1) % order.length];
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
		this.view.webview.html = renderDashboardHtml({
			snapshot: this.getSnapshot(),
			error: this.getLastError(),
			config: this.getConfig(),
			focused: this.isFocused(),
			loading: this.loading,
			locale: vscode.env.language,
			cspSource: this.view.webview.cspSource,
			nonce: randomBytes(16).toString('base64'),
			strings: {
				live: vscode.l10n.t('Live'),
				pausedUnfocused: vscode.l10n.t('Paused (unfocused)'),
				loading: vscode.l10n.t('Loading...'),
				refresh: vscode.l10n.t('Refresh'),
				cycleFormat: vscode.l10n.t('Cycle Status Bar Format'),
				settings: vscode.l10n.t('Settings'),
				error: vscode.l10n.t('Error'),
				configurePath: vscode.l10n.t('Configure Path'),
				logs: vscode.l10n.t('Logs'),
				tightestLimit: vscode.l10n.t('Tightest limit'),
				activeModel: vscode.l10n.t('Active Model'),
				aiCredits: vscode.l10n.t('AI Credits'),
				upgradeCredits: vscode.l10n.t('Upgrade / Get Credits'),
				pinned: vscode.l10n.t('Pinned'),
				pinToStatusBar: vscode.l10n.t('Pin to Status Bar'),
				fiveHourShort: '5H',
				weeklyShort: '1W',
				resetsIn: vscode.l10n.t('Resets in'),
				noActiveUsage: vscode.l10n.t('No active usage'),
				ready: vscode.l10n.t('Ready'),
				availableNow: vscode.l10n.t('Available'),
				modelsInGroup: vscode.l10n.t('Models in group'),
				availableModels: vscode.l10n.t('Available Models'),
				waitingSnapshot: vscode.l10n.t('Waiting for initial quota snapshot...'),
				noQuotaData: vscode.l10n.t('No quota data available yet.'),
				lastUpdated: vscode.l10n.t('Last updated'),
				healthy: vscode.l10n.t('Healthy'),
				warning: vscode.l10n.t('Warning'),
				critical: vscode.l10n.t('Critical'),
				exhausted: vscode.l10n.t('Exhausted'),
				unknown: vscode.l10n.t('Unknown'),
			},
		});
	}
}
