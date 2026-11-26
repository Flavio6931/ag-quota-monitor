import { classifySeverity } from '../core/parser';
import {
	ExtensionConfig,
	QuotaBucket,
	QuotaGroup,
	QuotaSeverity,
	QuotaSnapshot,
} from '../core/types';

export interface ResetLabels {
	noActiveUsage: string;
	ready: string;
}

const DEFAULT_RESET_LABELS: ResetLabels = {
	noActiveUsage: 'No active usage',
	ready: 'Ready',
};

const SEVERITY_ORDER: Record<QuotaSeverity, number> = {
	unknown: 0,
	ok: 1,
	warning: 2,
	critical: 3,
	exhausted: 4,
};

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Obtiene una etiqueta corta legible para un grupo de cuota. */
export function getGroupShortName(groupName: string): string {
	const trimmed = groupName.trim();
	const lower = trimmed.toLowerCase();
	if (lower.includes('claude') && lower.includes('gpt')) {
		return 'Claude/GPT';
	}
	if (lower === 'gemini' || lower === 'gemini models') {
		return 'Gemini';
	}
	if (lower.includes('claude')) {
		return 'Claude';
	}
	if (lower.includes('gpt')) {
		return 'GPT';
	}
	return trimmed.replace(/\s+models$/i, '') || trimmed;
}

/** Determina si un grupo está fijado para mostrarse en la barra de estado. */
export function isGroupPinned(groupName: string, pinnedGroups: readonly string[]): boolean {
	if (!pinnedGroups || pinnedGroups.length === 0) {
		return true;
	}
	const shortName = getGroupShortName(groupName).toLowerCase();
	const fullName = groupName.toLowerCase().trim();

	return pinnedGroups.some(raw => {
		const target = raw.toLowerCase().trim();
		if (!target || target === 'none') {
			return false;
		}
		if (target === shortName || target === fullName) {
			return true;
		}
		if (target === 'gemini' && shortName !== 'gemini') {
			return false;
		}
		const regex = new RegExp(`(^|[\\s/\\-_,.])${escapeRegex(target)}($|[\\s/\\-_,.])`, 'i');
		return regex.test(fullName) || regex.test(shortName);
	});
}

/** Genera una barra ASCII de progreso de ancho configurable. */
export function drawProgressBar(percentage: number | undefined, width = 10): string {
	if (percentage === undefined || Number.isNaN(percentage)) {
		return '░'.repeat(width);
	}
	const clamped = Math.max(0, Math.min(100, percentage));
	const filled = Math.round((clamped / 100) * width);
	return '▓'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/** Formatea una duración en milisegundos en texto compacto (ej. 5d 10h, 4h 32m, 18m). */
export function formatDuration(ms: number): string {
	if (ms <= 0) {
		return '0m';
	}
	const totalMinutes = Math.ceil(ms / 60_000);
	if (totalMinutes < 1) {
		return '<1m';
	}
	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}
	const totalHours = Math.floor(totalMinutes / 60);
	const mins = totalMinutes % 60;
	if (totalHours < 24) {
		return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
	}
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/** Formatea la cuenta regresiva y fecha absoluta local de reinicio de un bucket. */
export function formatResetInfo(
	resetTime: Date | null,
	now: Date = new Date(),
	labels: ResetLabels = DEFAULT_RESET_LABELS,
	locale?: string
): { countdown: string; absolute: string | null } {
	if (!resetTime) {
		return { countdown: labels.noActiveUsage, absolute: null };
	}

	const diff = resetTime.getTime() - now.getTime();
	if (diff <= 0) {
		return { countdown: labels.ready, absolute: null };
	}

	const absolute = resetTime.toLocaleString(locale, {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});

	return {
		countdown: formatDuration(diff),
		absolute,
	};
}

/** Obtiene la etiqueta corta de ventana (5h, 1w, etc.). */
export function getWindowShortLabel(windowName: string): string {
	const normalized = windowName.toLowerCase().trim();
	if (normalized === 'weekly' || normalized.includes('week')) {
		return '1w';
	}
	if (normalized === '5h' || normalized.includes('five')) {
		return '5h';
	}
	return windowName;
}

function worstGroupSeverity(
	group: QuotaGroup,
	warningThreshold: number,
	criticalThreshold: number
): QuotaSeverity {
	let worst: QuotaSeverity = 'ok';
	for (const bucket of group.buckets) {
		const severity = classifySeverity(
			bucket.remainingPercentage,
			warningThreshold,
			criticalThreshold
		);
		if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[worst]) {
			worst = severity;
		}
	}
	return worst;
}

function severityCodicon(severity: QuotaSeverity): string {
	switch (severity) {
		case 'exhausted':
		case 'critical':
			return '$(error)';
		case 'warning':
			return '$(warning)';
		case 'ok':
			return '$(pulse)';
		default:
			return '$(question)';
	}
}

function formatBucketPct(bucket: QuotaBucket): string {
	if (bucket.remainingPercentage === undefined) {
		return 'N/A';
	}
	return `${Math.round(bucket.remainingPercentage)}%`;
}

/**
 * Devuelve el bucket con el menor porcentaje restante (<100%) para el resumen superior.
 */
export function findTightestBucket(
	snapshot: QuotaSnapshot
): { groupName: string; bucket: QuotaBucket } | null {
	let tightest: { groupName: string; bucket: QuotaBucket; pct: number } | null = null;
	for (const group of snapshot.groups) {
		for (const bucket of group.buckets) {
			const pct = bucket.remainingPercentage;
			if (pct === undefined || pct >= 100) {
				continue;
			}
			if (!tightest || pct < tightest.pct) {
				tightest = { groupName: group.name, bucket, pct };
			}
		}
	}
	return tightest ? { groupName: tightest.groupName, bucket: tightest.bucket } : null;
}

/**
 * Construye el texto y la severidad global para mostrar en la barra de estado de VS Code.
 */
export function formatStatusBarText(
	snapshot: QuotaSnapshot,
	config: Pick<
		ExtensionConfig,
		| 'pinnedGroups'
		| 'statusBarFormat'
		| 'showCreditsInStatusBar'
		| 'warningThreshold'
		| 'criticalThreshold'
	>
): { text: string; worstSeverity: QuotaSeverity } {
	const parts: string[] = [];
	let worstSeverity: QuotaSeverity = 'ok';

	for (const group of snapshot.groups) {
		if (!isGroupPinned(group.name, config.pinnedGroups)) {
			continue;
		}

		const shortName = getGroupShortName(group.name);
		const groupSeverity = worstGroupSeverity(
			group,
			config.warningThreshold,
			config.criticalThreshold
		);
		if (SEVERITY_ORDER[groupSeverity] > SEVERITY_ORDER[worstSeverity]) {
			worstSeverity = groupSeverity;
		}

		const icon = severityCodicon(groupSeverity);
		if (config.statusBarFormat === 'detailed') {
			const bucketParts = group.buckets.map(
				b => `${getWindowShortLabel(b.window)}: ${formatBucketPct(b)}`
			);
			parts.push(`${icon} ${shortName} [${bucketParts.join(' | ')}]`);
		} else if (config.statusBarFormat === 'bars') {
			const bucketParts = group.buckets.map(
				b => `${getWindowShortLabel(b.window)} ${drawProgressBar(b.remainingPercentage, 5)} ${formatBucketPct(b)}`
			);
			parts.push(`${icon} ${shortName} ${bucketParts.join(' · ')}`);
		} else {
			const pcts = group.buckets.map(b => formatBucketPct(b));
			parts.push(`${icon} ${shortName} ${pcts.join('|')}`);
		}
	}

	if (config.showCreditsInStatusBar && snapshot.credits !== undefined) {
		parts.push(`$(credit-card) ${snapshot.credits.remainingCredits}`);
	}

	if (parts.length === 0) {
		return { text: '$(pulse) AG Quota', worstSeverity: 'ok' };
	}

	return { text: parts.join('  '), worstSeverity };
}
