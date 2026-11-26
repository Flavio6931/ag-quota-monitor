import * as vscode from 'vscode';
import { AgyClient } from './core/agyClient';
import { QuotaService } from './core/quotaService';
import { ExtensionConfig, StatusBarFormat } from './core/types';
import { DashboardViewProvider } from './ui/dashboardView';
import { StatusBarController } from './ui/statusBar';
import { Logger } from './utils/logger';

let quotaService: QuotaService | undefined;

function readExtensionConfig(): ExtensionConfig {
	const cfg = vscode.workspace.getConfiguration('agQuotaMonitor');
	const rawInterval = cfg.get<number>('pollingInterval', 300);
	const rawFormat = cfg.get<string>('statusBarFormat', 'compact');
	const statusBarFormat: StatusBarFormat = rawFormat === 'detailed' ? 'detailed' : 'compact';

	return {
		enabled: cfg.get<boolean>('enabled', true),
		pollingIntervalSec: Math.max(60, Math.min(3600, rawInterval)),
		pauseWhenUnfocused: cfg.get<boolean>('pauseWhenUnfocused', true),
		binaryPath: cfg.get<string>('binaryPath', '').trim(),
		pinnedGroups: cfg.get<string[]>('pinnedGroups', []),
		statusBarFormat,
		showCreditsInStatusBar: cfg.get<boolean>('showCreditsInStatusBar', false),
		warningThreshold: cfg.get<number>('warningThreshold', 20),
		criticalThreshold: cfg.get<number>('criticalThreshold', 5),
		notifyOnLowQuota: cfg.get<boolean>('notifyOnLowQuota', true),
		notifyOnReset: cfg.get<boolean>('notifyOnReset', false),
	};
}

/**
 * Punto de entrada de activación de AG Quota Monitor.
 */
export function activate(context: vscode.ExtensionContext): void {
	const logger = new Logger('AG Quota Monitor');
	const client = new AgyClient();
	const service = new QuotaService(client, logger, readExtensionConfig);
	quotaService = service;

	const statusBar = new StatusBarController(
		() => service.getLatestSnapshot(),
		() => service.getLastError(),
		readExtensionConfig,
		() => service.refresh(true)
	);

	const dashboard = new DashboardViewProvider(
		() => service.getLatestSnapshot(),
		() => service.getLastError(),
		readExtensionConfig,
		() => service.isWindowFocused(),
		async groupShortName => {
			await statusBar.togglePinnedGroup(groupShortName);
			statusBar.render();
			dashboard.render();
		},
		() => service.refresh(true)
	);

	context.subscriptions.push(
		logger,
		service,
		statusBar,
		vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboard),
		service.onDidUpdate(() => {
			statusBar.render();
			dashboard.render();
		}),
		service.onDidError(() => {
			statusBar.render();
			dashboard.render();
		}),
		service.onDidChangeLoading(loading => {
			statusBar.setLoading(loading);
			dashboard.setLoading(loading);
		}),
		vscode.window.onDidChangeWindowState(state => {
			service.handleWindowFocusChange(state.focused);
			dashboard.render();
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('agQuotaMonitor')) {
				logger.info('Extension', 'Configuration updated.');
				service.applyConfigChange();
				statusBar.render();
				dashboard.render();
			}
		}),
		vscode.commands.registerCommand('agQuotaMonitor.refresh', async () => {
			await service.refresh(true);
		}),
		vscode.commands.registerCommand('agQuotaMonitor.showMenu', async () => {
			await statusBar.showQuickMenu();
		}),
		vscode.commands.registerCommand('agQuotaMonitor.openDashboard', async () => {
			await vscode.commands.executeCommand('agQuotaMonitor.dashboardView.focus');
		}),
		vscode.commands.registerCommand('agQuotaMonitor.showLogs', () => {
			logger.show();
		}),
		vscode.commands.registerCommand('agQuotaMonitor.configureBinaryPath', async () => {
			const selected = await vscode.window.showOpenDialog({
				canSelectMany: false,
				openLabel: vscode.l10n.t('Select'),
				title: vscode.l10n.t('Select the agy executable'),
				filters:
					process.platform === 'win32'
						? { Executable: ['exe', 'cmd', 'bat'] }
						: undefined,
			});
			if (!selected?.[0]) {
				return;
			}
			const chosenPath = selected[0].fsPath;
			await vscode.workspace
				.getConfiguration('agQuotaMonitor')
				.update('binaryPath', chosenPath, vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(
				vscode.l10n.t('Binary path updated to: {0}', chosenPath)
			);
			await service.refresh(true);
		})
	);

	logger.info('Extension', 'AG Quota Monitor activated.');
	service.start();
}

/** Limpia recursos al desactivar la extensión. */
export function deactivate(): void {
	quotaService?.dispose();
	quotaService = undefined;
}
