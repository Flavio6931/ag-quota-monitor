import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaAlertEvaluator } from '../src/core/alerts';
import { QuotaSnapshot } from '../src/core/types';

function makeSnapshot(pct: number, resetIso: string | null): QuotaSnapshot {
	return {
		timestamp: new Date(),
		binaryPath: 'agy',
		availableModels: [],
		groups: [
			{
				name: 'Gemini Models',
				models: [],
				buckets: [
					{
						id: 'gemini-5h',
						name: 'Five Hour Limit Remaining',
						window: '5h',
						remainingFraction: pct / 100,
						remainingPercentage: pct,
						isExhausted: pct <= 0,
						resetTime: resetIso ? new Date(resetIso) : null,
						resetTimeIso: resetIso,
					},
				],
			},
		],
	};
}

const ALERT_OPTS = {
	warningThreshold: 20,
	criticalThreshold: 5,
	notifyOnLowQuota: true,
	notifyOnReset: true,
};

test('QuotaAlertEvaluator deduplicates same severity within one reset cycle and notifies on escalation/reset', () => {
	const evaluator = new QuotaAlertEvaluator();

	const first = evaluator.evaluate(makeSnapshot(18, '2026-11-26T08:00:00Z'), ALERT_OPTS);
	assert.equal(first.length, 1);
	assert.equal(first[0].kind, 'warning');

	// Mismo ciclo y misma severidad -> sin duplicados
	const repeated = evaluator.evaluate(makeSnapshot(14, '2026-11-26T08:00:00Z'), ALERT_OPTS);
	assert.equal(repeated.length, 0);

	// Escala a crítico -> notifica
	const escalated = evaluator.evaluate(makeSnapshot(4, '2026-11-26T08:00:00Z'), ALERT_OPTS);
	assert.equal(escalated.length, 1);
	assert.equal(escalated[0].kind, 'critical');

	// Agotado -> notifica
	const exhausted = evaluator.evaluate(makeSnapshot(0, '2026-11-26T08:00:00Z'), ALERT_OPTS);
	assert.equal(exhausted.length, 1);
	assert.equal(exhausted[0].kind, 'exhausted');

	// Reinicio tras agotamiento -> notifica reset
	const reset = evaluator.evaluate(makeSnapshot(100, '2026-11-26T13:00:00Z'), ALERT_OPTS);
	assert.equal(reset.length, 1);
	assert.equal(reset[0].kind, 'reset');

	// Nuevo ciclo permite volver a alertar si cae otra vez
	const nextCycleWarn = evaluator.evaluate(makeSnapshot(15, '2026-11-26T13:00:00Z'), ALERT_OPTS);
	assert.equal(nextCycleWarn.length, 1);
	assert.equal(nextCycleWarn[0].kind, 'warning');
});
