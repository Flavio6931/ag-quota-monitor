/**
 * Tipos y contratos de dominio para AG Quota Monitor.
 */

export type QuotaSeverity = 'ok' | 'warning' | 'critical' | 'exhausted' | 'unknown';

export type StatusBarFormat = 'compact' | 'detailed' | 'bars';

export interface QuotaBucket {
	id: string;
	name: string;
	description?: string;
	window: string;
	remainingFraction: number | undefined;
	remainingPercentage: number | undefined;
	isExhausted: boolean;
	resetTime: Date | null;
	resetTimeIso: string | null;
}

export interface QuotaGroup {
	name: string;
	description?: string;
	models: string[];
	buckets: QuotaBucket[];
}

export interface CreditsInfo {
	remainingCredits: number;
	upgradeUri?: string;
}

export interface ActiveModelInfo {
	id: string;
	label: string;
	effort?: string;
	isDefault?: boolean;
}

export interface AvailableModel {
	id: string;
	label: string;
}

export interface QuotaSnapshot {
	timestamp: Date;
	description?: string;
	groups: QuotaGroup[];
	credits?: CreditsInfo;
	activeModel?: ActiveModelInfo;
	availableModels: AvailableModel[];
	binaryPath: string;
}

export interface ExtensionConfig {
	enabled: boolean;
	pollingIntervalSec: number;
	pauseWhenUnfocused: boolean;
	binaryPath: string;
	pinnedGroups: string[];
	statusBarFormat: StatusBarFormat;
	showCreditsInStatusBar: boolean;
	warningThreshold: number;
	criticalThreshold: number;
	notifyOnLowQuota: boolean;
	notifyOnReset: boolean;
}

export type AgyErrorCode =
	| 'BINARY_NOT_FOUND'
	| 'AUTH_REQUIRED'
	| 'TIMEOUT'
	| 'INVALID_OUTPUT'
	| 'EXECUTION_ERROR';

/** Error tipado para fallos al resolver o consultar el CLI oficial agy. */
export class AgyClientError extends Error {
	public readonly code: AgyErrorCode;

	constructor(code: AgyErrorCode, message: string) {
		super(message);
		this.name = 'AgyClientError';
		this.code = code;
	}
}
