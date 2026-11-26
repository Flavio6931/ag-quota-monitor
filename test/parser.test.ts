import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifySeverity,
	extractJsonEnvelope,
	parseActiveModelOutput,
	parseCreditsOutput,
	parseModelsListOutput,
	parseUsageOutput,
} from '../src/core/parser';

const SAMPLE_USAGE_JSON = JSON.stringify({
	conversation_id: '',
	status: 'SUCCESS',
	response: '',
	duration_seconds: 0,
	num_turns: 0,
	usage: { total_tokens: 0 },
	command: {
		name: 'usage',
		data: {
			description: 'Within each group, models share a weekly limit and a 5-hour limit.',
			groups: [
				{
					name: 'Gemini Models',
					description: 'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 3.8 Flash',
					buckets: [
						{
							id: 'gemini-weekly',
							name: 'Weekly Limit Remaining',
							window: 'weekly',
							remaining_fraction: 0.3757,
							reset_time: '2026-12-01T14:08:20Z',
						},
						{
							id: 'gemini-5h',
							name: 'Five Hour Limit Remaining',
							window: '5h',
							remaining_fraction: 0.9052,
							reset_time: '2026-11-26T08:38:50Z',
						},
					],
				},
				{
					name: 'Claude and GPT models',
					description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
					buckets: [
						{
							id: '3p-weekly',
							name: 'Weekly Limit Remaining',
							window: 'weekly',
							remaining_fraction: 1,
							reset_time: '1970-01-01T00:00:00Z',
						},
					],
				},
			],
		},
	},
});

test('parseUsageOutput parses real /usage payload and treats 1970 epoch as null resetTime', () => {
	const result = parseUsageOutput(SAMPLE_USAGE_JSON);
	assert.equal(result.groups.length, 2);
	assert.deepEqual(result.groups[0].models, ['Gemini 4 Neon', 'Gemini 4 Carbon', 'Gemini 3.8 Flash']);
	assert.equal(result.groups[0].buckets[0].window, 'weekly');
	assert.ok(Math.abs((result.groups[0].buckets[0].remainingPercentage ?? 0) - 37.57) < 0.01);
	assert.equal(result.groups[0].buckets[0].resetTimeIso, '2026-12-01T14:08:20.000Z');

	const unusedBucket = result.groups[1].buckets[0];
	assert.equal(unusedBucket.resetTime, null);
	assert.equal(unusedBucket.resetTimeIso, null);
	assert.equal(unusedBucket.isExhausted, false);
});

test('extractJsonEnvelope handles stray prefix lines before JSON', () => {
	const raw = `Loading config...\n${SAMPLE_USAGE_JSON}\n`;
	const env = extractJsonEnvelope(raw) as { status: string };
	assert.equal(env.status, 'SUCCESS');
});

test('parseUsageOutput rejects payloads that consumed LLM turns', () => {
	const bad = JSON.stringify({
		status: 'SUCCESS',
		num_turns: 1,
		command: { name: 'usage', data: { groups: [] } },
	});
	assert.throws(() => parseUsageOutput(bad), /Unexpected LLM turn count/);
});

test('parseUsageOutput maps authentication errors to AUTH_REQUIRED', () => {
	const errJson = JSON.stringify({
		status: 'ERROR',
		error: 'Authentication required. Please sign in.',
	});
	assert.throws(() => parseUsageOutput(errJson), { name: 'AgyClientError', code: 'AUTH_REQUIRED' });
});

test('parseUsageOutput rejects malformed JSON', () => {
	assert.throws(() => parseUsageOutput('not json at all'), {
		name: 'AgyClientError',
		code: 'INVALID_OUTPUT',
	});
});

test('parseCreditsOutput parses credits and upgrade URI', () => {
	const stdout = JSON.stringify({
		status: 'SUCCESS',
		num_turns: 0,
		command: {
			name: 'credits',
			data: { remaining_credits: 42, upgrade_uri: 'https://antigravity.google/g1-upgrade' },
		},
	});
	assert.deepEqual(parseCreditsOutput(stdout), {
		remainingCredits: 42,
		upgradeUri: 'https://antigravity.google/g1-upgrade',
	});
});

test('parseActiveModelOutput parses active model details', () => {
	const stdout = JSON.stringify({
		status: 'SUCCESS',
		num_turns: 0,
		command: {
			name: 'model',
			data: {
				id: 'gemini-4-neon-high',
				label: 'Gemini 4 Neon (High)',
				effort: 'high',
				is_default: false,
			},
		},
	});
	assert.deepEqual(parseActiveModelOutput(stdout), {
		id: 'gemini-4-neon-high',
		label: 'Gemini 4 Neon (High)',
		effort: 'high',
		isDefault: false,
	});
});

test('parseModelsListOutput ignores status lines and deduplicates entries', () => {
	const stdout = [
		'Fetching available models...',
		'gemini-4-neon-high\tGemini 4 Neon (High)',
		'gemini-4-neon-high\tGemini 4 Neon (High)',
		'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
	].join('\n');
	assert.deepEqual(parseModelsListOutput(stdout), [
		{ id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
		{ id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
	]);
});

test('classifySeverity respects warning, critical and exhausted thresholds', () => {
	assert.equal(classifySeverity(undefined, 20, 5), 'unknown');
	assert.equal(classifySeverity(0, 20, 5), 'exhausted');
	assert.equal(classifySeverity(5, 20, 5), 'critical');
	assert.equal(classifySeverity(20, 20, 5), 'warning');
	assert.equal(classifySeverity(55, 20, 5), 'ok');
});
