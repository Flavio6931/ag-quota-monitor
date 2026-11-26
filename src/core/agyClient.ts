import { execFile } from 'node:child_process';
import { resolveAgyBinary } from './binaryResolver';
import {
	parseActiveModelOutput,
	parseCreditsOutput,
	parseModelsListOutput,
	parseUsageOutput,
} from './parser';
import {
	ActiveModelInfo,
	AgyClientError,
	AvailableModel,
	CreditsInfo,
	QuotaSnapshot,
} from './types';

const EXEC_TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MODELS_CACHE_TTL_MS = 30 * 60 * 1000;

export interface FetchSnapshotOptions {
	customBinaryPath?: string;
	forceRefreshModels?: boolean;
}

/**
 * Cliente seguro y de solo lectura sobre la lista blanca de comandos headless del CLI `agy`.
 * Nunca usa shell ni envía prompts libres al LLM.
 */
export class AgyClient {
	private cachedModels: AvailableModel[] = [];
	private cachedModelsAt = 0;

	private runBinary(binaryPath: string, args: readonly string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(
				binaryPath,
				[...args],
				{
					timeout: EXEC_TIMEOUT_MS,
					maxBuffer: MAX_BUFFER_BYTES,
					windowsHide: true,
				},
				(err, stdout, stderr) => {
					if (err) {
						const errObj = err as NodeJS.ErrnoException & { killed?: boolean };
						const combined = `${stderr || ''}\n${err.message || ''}`.trim();

						if (errObj.code === 'ENOENT') {
							reject(new AgyClientError('BINARY_NOT_FOUND', `Binary not found at ${binaryPath}`));
							return;
						}
						if (errObj.killed || /timeout|ETIMEDOUT/i.test(combined)) {
							reject(new AgyClientError('TIMEOUT', 'Antigravity CLI request timed out.'));
							return;
						}
						if (/auth(entication)?\s+required|not\s+authenticated|sign\s*in/i.test(combined)) {
							reject(new AgyClientError('AUTH_REQUIRED', combined));
							return;
						}
						// Algunas salidas JSON de error llegan en stdout aun con código de salida != 0.
						if (stdout?.trim().startsWith('{')) {
							resolve(stdout);
							return;
						}
						reject(new AgyClientError('EXECUTION_ERROR', combined || 'agy CLI execution failed.'));
						return;
					}

					resolve(stdout);
				}
			);
		});
	}

	/** Consulta `/usage` en formato JSON (0 tokens consumidos). */
	async fetchUsage(binaryPath: string) {
		const stdout = await this.runBinary(binaryPath, [
			'-p',
			'/usage',
			'--output-format',
			'json',
			'--print-timeout',
			'15s',
		]);
		return parseUsageOutput(stdout);
	}

	/** Consulta `/credits` en formato JSON (0 tokens consumidos). */
	async fetchCredits(binaryPath: string): Promise<CreditsInfo | undefined> {
		const stdout = await this.runBinary(binaryPath, [
			'-p',
			'/credits',
			'--output-format',
			'json',
			'--print-timeout',
			'15s',
		]);
		return parseCreditsOutput(stdout);
	}

	/** Consulta `/model` activo en formato JSON (0 tokens consumidos). */
	async fetchActiveModel(binaryPath: string): Promise<ActiveModelInfo | undefined> {
		const stdout = await this.runBinary(binaryPath, [
			'-p',
			'/model',
			'--output-format',
			'json',
			'--print-timeout',
			'15s',
		]);
		return parseActiveModelOutput(stdout);
	}

	/** Consulta la lista de modelos disponibles usando caché de 30 minutos. */
	async fetchAvailableModels(binaryPath: string, force = false): Promise<AvailableModel[]> {
		const isFresh =
			!force &&
			this.cachedModels.length > 0 &&
			Date.now() - this.cachedModelsAt < MODELS_CACHE_TTL_MS;

		if (isFresh) {
			return this.cachedModels;
		}

		const stdout = await this.runBinary(binaryPath, ['models']);
		const parsed = parseModelsListOutput(stdout);
		if (parsed.length > 0) {
			this.cachedModels = parsed;
			this.cachedModelsAt = Date.now();
		}
		return this.cachedModels;
	}

	/**
	 * Obtiene un snapshot completo combinando `/usage` (obligatorio) con créditos,
	 * modelo activo y catálogo de modelos (degradación elegante si alguno falla).
	 */
	async fetchSnapshot(options: FetchSnapshotOptions = {}): Promise<QuotaSnapshot> {
		const resolution = resolveAgyBinary(options.customBinaryPath);
		if (!resolution.binaryPath) {
			throw new AgyClientError(
				'BINARY_NOT_FOUND',
				`Antigravity CLI (agy) not found. Checked: ${resolution.searchedCandidates.slice(0, 5).join(', ')}`
			);
		}

		const binaryPath = resolution.binaryPath;

		const [usageRes, creditsRes, activeModelRes, modelsRes] = await Promise.allSettled([
			this.fetchUsage(binaryPath),
			this.fetchCredits(binaryPath),
			this.fetchActiveModel(binaryPath),
			this.fetchAvailableModels(binaryPath, options.forceRefreshModels),
		]);

		if (usageRes.status === 'rejected') {
			throw usageRes.reason;
		}

		return {
			timestamp: new Date(),
			description: usageRes.value.description,
			groups: usageRes.value.groups,
			credits: creditsRes.status === 'fulfilled' ? creditsRes.value : undefined,
			activeModel: activeModelRes.status === 'fulfilled' ? activeModelRes.value : undefined,
			availableModels: modelsRes.status === 'fulfilled' ? modelsRes.value : this.cachedModels,
			binaryPath,
		};
	}
}
