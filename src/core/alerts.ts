import { classifySeverity } from './parser';
import { QuotaSeverity, QuotaSnapshot } from './types';

export type AlertKind = 'warning' | 'critical' | 'exhausted' | 'reset';

export interface QuotaAlertEvent {
	kind: AlertKind;
	groupName: string;
	bucketId: string;
	bucketName: string;
	window: string;
	remainingPercentage: number;
}

interface BucketTrackingState {
	lastResetIso: string | null;
	notifiedLevels: Set<'warning' | 'critical' | 'exhausted'>;
	wasExhausted: boolean;
}

const SEVERITY_RANK: Record<QuotaSeverity, number> = {
	unknown: 0,
	ok: 1,
	warning: 2,
	critical: 3,
	exhausted: 4,
};

/**
 * Evalúa transiciones de cuota para emitir alertas sin duplicados dentro de un mismo ciclo de reinicio.
 */
export class QuotaAlertEvaluator {
	private readonly states = new Map<string, BucketTrackingState>();

	/** Evalúa un snapshot nuevo y devuelve únicamente las alertas nuevas a mostrar al usuario. */
	evaluate(
		snapshot: QuotaSnapshot,
		options: {
			warningThreshold: number;
			criticalThreshold: number;
			notifyOnLowQuota: boolean;
			notifyOnReset: boolean;
		}
	): QuotaAlertEvent[] {
		const events: QuotaAlertEvent[] = [];

		for (const group of snapshot.groups) {
			for (const bucket of group.buckets) {
				const key = `${group.name}::${bucket.id}`;
				const pct = bucket.remainingPercentage;
				if (pct === undefined) {
					continue;
				}

				const prev = this.states.get(key);
				const currentResetIso = bucket.resetTimeIso;

				if (!prev) {
					const severity = classifySeverity(pct, options.warningThreshold, options.criticalThreshold);
					const notified = new Set<'warning' | 'critical' | 'exhausted'>();
					if (options.notifyOnLowQuota && SEVERITY_RANK[severity] >= SEVERITY_RANK.warning) {
						const kind = severity as 'warning' | 'critical' | 'exhausted';
						notified.add(kind);
						events.push({
							kind,
							groupName: group.name,
							bucketId: bucket.id,
							bucketName: bucket.name,
							window: bucket.window,
							remainingPercentage: pct,
						});
					}
					this.states.set(key, {
						lastResetIso: currentResetIso,
						notifiedLevels: notified,
						wasExhausted: bucket.isExhausted,
					});
					continue;
				}

				const resetCycleChanged =
					prev.lastResetIso !== null &&
					currentResetIso !== prev.lastResetIso &&
					pct > 0;

				const recoveredFromExhaustion = prev.wasExhausted && !bucket.isExhausted && pct > 0;

				if (resetCycleChanged || recoveredFromExhaustion) {
					prev.notifiedLevels.clear();
					if (options.notifyOnReset && prev.wasExhausted) {
						events.push({
							kind: 'reset',
							groupName: group.name,
							bucketId: bucket.id,
							bucketName: bucket.name,
							window: bucket.window,
							remainingPercentage: pct,
						});
					}
				}

				prev.lastResetIso = currentResetIso;
				prev.wasExhausted = bucket.isExhausted;

				if (!options.notifyOnLowQuota) {
					continue;
				}

				const severity = classifySeverity(pct, options.warningThreshold, options.criticalThreshold);
				if (
					(severity === 'warning' || severity === 'critical' || severity === 'exhausted') &&
					!prev.notifiedLevels.has(severity)
				) {
					// Marca niveles inferiores como ya superados para evitar alertas en cascada inversa.
					if (severity === 'critical') {
						prev.notifiedLevels.add('warning');
					} else if (severity === 'exhausted') {
						prev.notifiedLevels.add('warning');
						prev.notifiedLevels.add('critical');
					}
					prev.notifiedLevels.add(severity);

					events.push({
						kind: severity,
						groupName: group.name,
						bucketId: bucket.id,
						bucketName: bucket.name,
						window: bucket.window,
						remainingPercentage: pct,
					});
				}
			}
		}

		return events;
	}

	/** Limpia el historial de alertas acumuladas. */
	clear(): void {
		this.states.clear();
	}
}
