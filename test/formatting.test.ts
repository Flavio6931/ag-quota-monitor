import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaSnapshot } from '../src/core/types';
import {
	drawProgressBar,
	findTightestBucket,
	formatDuration,
	formatResetInfo,
	formatStatusBarText,
	getGroupShortName,
	isGroupPinned,
} from '../src/utils/formatting';

test('getGroupShortName normalizes common group names', () => {
	assert.equal(getGroupShortName('Gemini Models'), 'Gemini');
	assert.equal(getGroupShortName('Claude and GPT models'), 'Claude/GPT');
	assert.equal(getGroupShortName('Custom Models'), 'Custom');
});

test('isGroupPinned handles empty, none sentinel, and specific subgroups', () => {
	assert.equal(isGroupPinned('Gemini Models', []), true);
	assert.equal(isGroupPinned('Gemini Models', ['none']), false);
	assert.equal(isGroupPinned('Gemini Models', ['Gemini']), true);
	assert.equal(isGroupPinned('Gemini 4 Argon', ['gemini']), false);
	assert.equal(isGroupPinned('Claude and GPT models', ['Claude/GPT']), true);
	assert.equal(isGroupPinned('Claude and GPT models', ['Gemini']), false);
});

test('drawProgressBar renders bounded widths', () => {
	assert.equal(drawProgressBar(0, 10), '░░░░░░░░░░');
	assert.equal(drawProgressBar(100, 10), '▓▓▓▓▓▓▓▓▓▓');
	assert.equal(drawProgressBar(undefined, 10), '░░░░░░░░░░');
});

test('formatDuration and formatResetInfo handle null and active timestamps', () => {
	assert.equal(formatDuration(18 * 60_000), '18m');
	assert.equal(formatDuration((4 * 60 + 32) * 60_000), '4h 32m');
	assert.equal(formatDuration((5 * 24 + 10) * 3600_000), '5d 10h');

	const noUsage = formatResetInfo(null, new Date('2026-11-26T00:00:00Z'));
	assert.equal(noUsage.countdown, 'No active usage');
	assert.equal(noUsage.absolute, null);

	const future = formatResetInfo(
		new Date('2026-11-26T04:30:00Z'),
		new Date('2026-11-26T00:00:00Z'),
		undefined,
		'en-US'
	);
	assert.equal(future.countdown, '4h 30m');
	assert.ok(future.absolute !== null);
});

test('formatStatusBarText formats compact, detailed, and credits states', () => {
	const snapshot: QuotaSnapshot = {
		timestamp: new Date(),
		binaryPath: 'agy',
		availableModels: [],
		credits: { remainingCredits: 15 },
		groups: [
			{
				name: 'Gemini Models',
				models: [],
				buckets: [
					{
						id: 'g-5h',
						name: '5h',
						window: '5h',
						remainingFraction: 0.9,
						remainingPercentage: 90,
						isExhausted: false,
						resetTime: null,
						resetTimeIso: null,
					},
					{
						id: 'g-1w',
						name: 'Weekly',
						window: 'weekly',
						remainingFraction: 0.15,
						remainingPercentage: 15,
						isExhausted: false,
						resetTime: null,
						resetTimeIso: null,
					},
				],
			},
		],
	};

	const compact = formatStatusBarText(snapshot, {
		pinnedGroups: [],
		statusBarFormat: 'compact',
		showCreditsInStatusBar: true,
		warningThreshold: 20,
		criticalThreshold: 5,
	});
	assert.equal(compact.worstSeverity, 'warning');
	assert.equal(compact.text, '$(warning) Gemini 90%|15%  $(credit-card) 15');

	const detailed = formatStatusBarText(snapshot, {
		pinnedGroups: [],
		statusBarFormat: 'detailed',
		showCreditsInStatusBar: false,
		warningThreshold: 20,
		criticalThreshold: 5,
	});
	assert.equal(detailed.text, '$(warning) Gemini [5h: 90% | 1w: 15%]');

	const bars = formatStatusBarText(snapshot, {
		pinnedGroups: [],
		statusBarFormat: 'bars',
		showCreditsInStatusBar: false,
		warningThreshold: 20,
		criticalThreshold: 5,
	});
	assert.equal(bars.text, '$(warning) Gemini 5h ▓▓▓▓▓ 90% · 1w ▓░░░░ 15%');

	const tightest = findTightestBucket(snapshot);
	assert.ok(tightest !== null);
	assert.equal(tightest.bucket.id, 'g-1w');
	assert.equal(tightest.bucket.remainingPercentage, 15);

	const hidden = formatStatusBarText(snapshot, {
		pinnedGroups: ['none'],
		statusBarFormat: 'compact',
		showCreditsInStatusBar: false,
		warningThreshold: 20,
		criticalThreshold: 5,
	});
	assert.equal(hidden.text, '$(pulse) AG Quota');
});
