import {
	ActiveModelInfo,
	AgyClientError,
	AvailableModel,
	CreditsInfo,
	QuotaBucket,
	QuotaGroup,
	QuotaSeverity,
} from './types';

const EPOCH_THRESHOLD_MS = 86_400_000;

interface AgyEnvelope {
	status?: unknown;
	error?: unknown;
	num_turns?: unknown;
	command?: {
		name?: unknown;
		data?: unknown;
	};
}

/**
 * Extrae el objeto JSON principal desde stdout del CLI agy.
 * Tolera líneas previas de diagnóstico buscando el último objeto JSON válido si el parse directo falla.
 */
export function extractJsonEnvelope(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new AgyClientError('INVALID_OUTPUT', 'Empty output received from agy CLI.');
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean);

		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (line.startsWith('{') && line.endsWith('}')) {
				try {
					return JSON.parse(line);
				} catch {
					// Continúa buscando una línea JSON válida anterior.
				}
			}
		}
		throw new AgyClientError('INVALID_OUTPUT', 'Output from agy CLI is not valid JSON.');
	}
}

function assertCommandEnvelope(raw: unknown, expectedCommand: string): Record<string, unknown> {
	if (!raw || typeof raw !== 'object') {
		throw new AgyClientError('INVALID_OUTPUT', 'Malformed JSON envelope from agy CLI.');
	}

	const env = raw as AgyEnvelope;
	const status = typeof env.status === 'string' ? env.status : '';
	if (status !== 'SUCCESS') {
		const errorMsg = typeof env.error === 'string' ? env.error : `Unexpected CLI status: ${status || 'unknown'}`;
		if (/auth(entication)?\s+required|not\s+authenticated|sign\s*in/i.test(errorMsg)) {
			throw new AgyClientError('AUTH_REQUIRED', errorMsg);
		}
		throw new AgyClientError('EXECUTION_ERROR', errorMsg);
	}

	// Garantía estricta: estos comandos headless nunca deben consumir turnos LLM.
	const numTurns = typeof env.num_turns === 'number' ? env.num_turns : 0;
	if (numTurns !== 0) {
		throw new AgyClientError(
			'INVALID_OUTPUT',
			`Unexpected LLM turn count (${numTurns}) for command '${expectedCommand}'.`
		);
	}

	if (!env.command || typeof env.command !== 'object' || env.command.name !== expectedCommand) {
		throw new AgyClientError(
			'INVALID_OUTPUT',
			`Expected command '${expectedCommand}', got '${String(env.command?.name ?? 'none')}'.`
		);
	}

	if (!env.command.data || typeof env.command.data !== 'object') {
		throw new AgyClientError('INVALID_OUTPUT', `Missing command.data for '${expectedCommand}'.`);
	}

	return env.command.data as Record<string, unknown>;
}

function parseResetTime(rawReset: unknown): { resetTime: Date | null; resetTimeIso: string | null } {
	if (typeof rawReset !== 'string' || !rawReset.trim()) {
		return { resetTime: null, resetTimeIso: null };
	}

	const parsed = new Date(rawReset);
	const ms = parsed.getTime();
	// 1970-01-01T00:00:00Z indica bucket sin consumo activo todavía.
	if (Number.isNaN(ms) || ms <= EPOCH_THRESHOLD_MS) {
		return { resetTime: null, resetTimeIso: null };
	}

	return { resetTime: parsed, resetTimeIso: parsed.toISOString() };
}

function parseModelsFromDescription(description: unknown): string[] {
	if (typeof description !== 'string') {
		return [];
	}

	const prefixMatch = description.match(/models\s+within\s+this\s+group\s*:\s*(.+)$/i);
	if (!prefixMatch?.[1]) {
		return [];
	}

	return prefixMatch[1]
		.split(',')
		.map(item => item.trim())
		.filter(Boolean);
}

function clampFraction(value: unknown): number | undefined {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return undefined;
	}
	return Math.max(0, Math.min(1, value));
}

/**
 * Parsea la salida JSON de `agy -p "/usage" --output-format json`.
 */
export function parseUsageOutput(stdout: string): { description?: string; groups: QuotaGroup[] } {
	const envelope = extractJsonEnvelope(stdout);
	const data = assertCommandEnvelope(envelope, 'usage');

	const rawGroups = Array.isArray(data.groups) ? data.groups : [];
	const groups: QuotaGroup[] = [];

	for (const item of rawGroups) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const g = item as Record<string, unknown>;
		const name = typeof g.name === 'string' && g.name.trim() ? g.name.trim() : 'Unknown Group';
		const description = typeof g.description === 'string' ? g.description : undefined;
		const rawBuckets = Array.isArray(g.buckets) ? g.buckets : [];

		const buckets: QuotaBucket[] = [];
		for (const rawBucket of rawBuckets) {
			if (!rawBucket || typeof rawBucket !== 'object') {
				continue;
			}
			const b = rawBucket as Record<string, unknown>;
			const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : 'unknown';
			const bucketName = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : id;
			const window = typeof b.window === 'string' && b.window.trim() ? b.window.trim() : id;
			const remainingFraction = clampFraction(b.remaining_fraction);
			const remainingPercentage =
				remainingFraction !== undefined ? remainingFraction * 100 : undefined;
			const { resetTime, resetTimeIso } = parseResetTime(b.reset_time);

			buckets.push({
				id,
				name: bucketName,
				description: typeof b.description === 'string' ? b.description : undefined,
				window,
				remainingFraction,
				remainingPercentage,
				isExhausted: remainingFraction === 0,
				resetTime,
				resetTimeIso,
			});
		}

		groups.push({
			name,
			description,
			models: parseModelsFromDescription(description),
			buckets,
		});
	}

	return {
		description: typeof data.description === 'string' ? data.description : undefined,
		groups,
	};
}

/**
 * Parsea la salida JSON de `agy -p "/credits" --output-format json`.
 */
export function parseCreditsOutput(stdout: string): CreditsInfo | undefined {
	const envelope = extractJsonEnvelope(stdout);
	const data = assertCommandEnvelope(envelope, 'credits');
	const remaining = typeof data.remaining_credits === 'number' ? data.remaining_credits : undefined;
	if (remaining === undefined || Number.isNaN(remaining)) {
		return undefined;
	}

	return {
		remainingCredits: remaining,
		upgradeUri: typeof data.upgrade_uri === 'string' ? data.upgrade_uri : undefined,
	};
}

/**
 * Parsea la salida JSON de `agy -p "/model" --output-format json`.
 */
export function parseActiveModelOutput(stdout: string): ActiveModelInfo | undefined {
	const envelope = extractJsonEnvelope(stdout);
	const data = assertCommandEnvelope(envelope, 'model');
	const id = typeof data.id === 'string' ? data.id.trim() : '';
	const label = typeof data.label === 'string' ? data.label.trim() : '';
	if (!id && !label) {
		return undefined;
	}

	return {
		id: id || label,
		label: label || id,
		effort: typeof data.effort === 'string' ? data.effort : undefined,
		isDefault: typeof data.is_default === 'boolean' ? data.is_default : undefined,
	};
}

/**
 * Parsea la salida tabular de `agy models`.
 */
export function parseModelsListOutput(stdout: string): AvailableModel[] {
	const models: AvailableModel[] = [];
	const seen = new Set<string>();

	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || !line.includes('\t')) {
			continue;
		}
		const [idPart, ...labelParts] = line.split('\t');
		const id = idPart.trim();
		const label = labelParts.join(' ').trim() || id;
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		models.push({ id, label });
	}

	return models;
}

/**
 * Clasifica el nivel de severidad de un porcentaje restante según los umbrales configurados.
 */
export function classifySeverity(
	percentage: number | undefined,
	warningThreshold: number,
	criticalThreshold: number
): QuotaSeverity {
	if (percentage === undefined || Number.isNaN(percentage)) {
		return 'unknown';
	}
	if (percentage <= 0) {
		return 'exhausted';
	}
	if (percentage <= criticalThreshold) {
		return 'critical';
	}
	if (percentage <= warningThreshold) {
		return 'warning';
	}
	return 'ok';
}
