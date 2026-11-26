import * as vscode from 'vscode';
import { AgyClient } from './agyClient';
import { QuotaAlertEvaluator } from './alerts';
import { AgyClientError, ExtensionConfig, QuotaSnapshot } from './types';
import { Logger } from '../utils/logger';

const MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Orquesta las consultas periódicas al CLI `agy`, caché de snapshots,
 * pausa por foco de ventana, backoff ante fallos y alertas deduplicadas.
 */
export class QuotaService implements vscode.Disposable {
	private snapshot: QuotaSnapshot | null = null;
	private lastError: AgyClientError | null = null;
	private inFlightRefresh: Promise<QuotaSnapshot | null> | null = null;
	private pollTimer: NodeJS.Timeout | undefined;
	private consecutiveErrors = 0;
	private isFocused = vscode.window.state.focused;

	private readonly alertEvaluator = new QuotaAlertEvaluator();

	private readonly updateEmitter = new vscode.EventEmitter<QuotaSnapshot>();
	private readonly errorEmitter = new vscode.EventEmitter<AgyClientError>();
	private readonly loadingEmitter = new vscode.EventEmitter<boolean>();

	public readonly onDidUpdate = this.updateEmitter.event;
	public readonly onDidError = this.errorEmitter.event;
	public readonly onDidChangeLoading = this.loadingEmitter.event;

	constructor(
		private readonly client: AgyClient,
		private readonly logger: Logger,
		private getConfig: () => ExtensionConfig
	) {}

	getLatestSnapshot(): QuotaSnapshot | null {
		return this.snapshot;
	}

	getLastError(): AgyClientError | null {
		return this.lastError;
	}

	isWindowFocused(): boolean {
		return this.isFocused;
	}

	/** Actualiza el estado de foco y reanuda polling si corresponde. */
	handleWindowFocusChange(focused: boolean): void {
		this.isFocused = focused;
		const cfg = this.getConfig();
		if (!cfg.enabled) {
			return;
		}
		if (focused && cfg.pauseWhenUnfocused) {
			this.logger.debug('QuotaService', 'Window focused, resuming polling.');
			this.scheduleNextPoll();
			const staleMs = cfg.pollingIntervalSec * 1000;
			if (!this.snapshot || Date.now() - this.snapshot.timestamp.getTime() >= staleMs) {
				void this.refresh(false);
			}
		} else if (!focused && cfg.pauseWhenUnfocused) {
			this.logger.debug('QuotaService', 'Window unfocused, pausing scheduled polls.');
			this.clearTimer();
		}
	}

	/** Reconfigura los temporizadores tras un cambio en ajustes del usuario. */
	applyConfigChange(): void {
		const cfg = this.getConfig();
		this.clearTimer();
		if (cfg.enabled) {
			this.scheduleNextPoll();
		}
	}

	/** Inicia el monitoreo con una primera lectura inmediata. */
	start(): void {
		const cfg = this.getConfig();
		if (!cfg.enabled) {
			this.logger.info('QuotaService', 'Automatic polling is disabled by configuration.');
			return;
		}
		void this.refresh(false);
	}

	/**
	 * Ejecuta una lectura evitando llamadas simultáneas mediante bloqueo single-flight.
	 */
	async refresh(forceModels = false): Promise<QuotaSnapshot | null> {
		if (this.inFlightRefresh) {
			return this.inFlightRefresh;
		}

		this.inFlightRefresh = this.executeRefresh(forceModels);
		try {
			return await this.inFlightRefresh;
		} finally {
			this.inFlightRefresh = null;
		}
	}

	private async executeRefresh(forceModels: boolean): Promise<QuotaSnapshot | null> {
		const cfg = this.getConfig();
		this.loadingEmitter.fire(true);

		try {
			const nextSnapshot = await this.client.fetchSnapshot({
				customBinaryPath: cfg.binaryPath,
				forceRefreshModels: forceModels,
			});

			this.snapshot = nextSnapshot;
			this.lastError = null;
			this.consecutiveErrors = 0;

			this.logger.info(
				'QuotaService',
				`Fetched snapshot via ${nextSnapshot.binaryPath} (${nextSnapshot.groups.length} groups)`
			);

			this.updateEmitter.fire(nextSnapshot);
			this.emitAlerts(nextSnapshot, cfg);
			this.scheduleNextPoll();
			return nextSnapshot;
		} catch (rawError) {
			const error =
				rawError instanceof AgyClientError
					? rawError
					: new AgyClientError(
							'EXECUTION_ERROR',
							rawError instanceof Error ? rawError.message : String(rawError)
					  );

			this.consecutiveErrors++;
			this.lastError = error;
			this.logger.error('QuotaService', `Refresh failed (${error.code}): ${error.message}`);
			this.errorEmitter.fire(error);
			this.scheduleNextPoll();
			return null;
		} finally {
			this.loadingEmitter.fire(false);
		}
	}

	private emitAlerts(snapshot: QuotaSnapshot, cfg: ExtensionConfig): void {
		const events = this.alertEvaluator.evaluate(snapshot, {
			warningThreshold: cfg.warningThreshold,
			criticalThreshold: cfg.criticalThreshold,
			notifyOnLowQuota: cfg.notifyOnLowQuota,
			notifyOnReset: cfg.notifyOnReset,
		});

		for (const evt of events) {
			const pct = Math.round(evt.remainingPercentage);
			if (evt.kind === 'warning') {
				void vscode.window.showWarningMessage(
					vscode.l10n.t('Antigravity quota warning: {0} ({1}) is at {2}%.', evt.groupName, evt.window, pct)
				);
			} else if (evt.kind === 'critical') {
				void vscode.window.showWarningMessage(
					vscode.l10n.t('Antigravity quota critical: {0} ({1}) is at {2}%.', evt.groupName, evt.window, pct)
				);
			} else if (evt.kind === 'exhausted') {
				void vscode.window.showErrorMessage(
					vscode.l10n.t('Antigravity quota exhausted: {0} ({1}) reached 0%.', evt.groupName, evt.window)
				);
			} else if (evt.kind === 'reset') {
				void vscode.window.showInformationMessage(
					vscode.l10n.t('Antigravity quota reset: {0} ({1}) is now available ({2}%).', evt.groupName, evt.window, pct)
				);
			}
		}
	}

	private clearTimer(): void {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	private scheduleNextPoll(): void {
		this.clearTimer();
		const cfg = this.getConfig();
		if (!cfg.enabled) {
			return;
		}
		if (cfg.pauseWhenUnfocused && !this.isFocused) {
			return;
		}

		const baseMs = Math.max(60, cfg.pollingIntervalSec) * 1000;
		const delayMs =
			this.consecutiveErrors > 0
				? Math.min(baseMs * Math.pow(2, this.consecutiveErrors), MAX_BACKOFF_MS)
				: baseMs;

		this.pollTimer = setTimeout(() => {
			void this.refresh(false);
		}, delayMs);
	}

	dispose(): void {
		this.clearTimer();
		this.updateEmitter.dispose();
		this.errorEmitter.dispose();
		this.loadingEmitter.dispose();
	}
}
