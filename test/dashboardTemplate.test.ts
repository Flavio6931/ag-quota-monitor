import assert from 'node:assert/strict';
import test from 'node:test';
import { AgyClientError, ExtensionConfig, QuotaSnapshot } from '../src/core/types';
import { DashboardStrings, renderDashboardHtml } from '../src/ui/dashboardTemplate';

const STRINGS: DashboardStrings = {
	live: 'Live',
	pausedUnfocused: 'Paused (unfocused)',
	loading: 'Loading...',
	refresh: 'Refresh',
	cycleFormat: 'Cycle Status Bar Format',
	settings: 'Settings',
	error: 'Error',
	configurePath: 'Configure Path',
	logs: 'Logs',
	tightestLimit: 'Tightest limit',
	activeModel: 'Active Model',
	aiCredits: 'AI Credits',
	upgradeCredits: 'Upgrade / Get Credits',
	pinned: 'Pinned',
	pinToStatusBar: 'Pin to Status Bar',
	fiveHourShort: '5H',
	weeklyShort: '1W',
	resetsIn: 'Resets in',
	noActiveUsage: 'No active usage',
	ready: 'Ready',
	availableNow: 'Available',
	modelsInGroup: 'Models in group',
	availableModels: 'Available Models',
	waitingSnapshot: 'Waiting...',
	noQuotaData: 'No data',
	lastUpdated: 'Last updated',
	healthy: 'Healthy',
	warning: 'Warning',
	critical: 'Critical',
	exhausted: 'Exhausted',
	unknown: 'Unknown',
};

const BASE_CONFIG: ExtensionConfig = {
	enabled: true,
	pollingIntervalSec: 300,
	pauseWhenUnfocused: true,
	binaryPath: '',
	pinnedGroups: [],
	statusBarFormat: 'compact',
	showCreditsInStatusBar: false,
	warningThreshold: 20,
	criticalThreshold: 5,
	notifyOnLowQuota: true,
	notifyOnReset: false,
};

test('renderDashboardHtml renders radial SVG rings, tightest callout, and CSP nonce', () => {
	const snapshot: QuotaSnapshot = {
		timestamp: new Date('2026-11-26T12:00:00Z'),
		binaryPath: 'agy',
		credits: { remainingCredits: 0, upgradeUri: 'https://antigravity.google/g1-upgrade' },
		activeModel: { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
		availableModels: [{ id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' }],
		groups: [
			{
				name: 'Gemini Models',
				models: ['Gemini 4 Neon'],
				buckets: [
					{
						id: 'g-5h',
						name: 'Five Hour Limit',
						window: '5h',
						remainingFraction: 0.5,
						remainingPercentage: 50,
						isExhausted: false,
						resetTime: new Date('2026-11-26T16:00:00Z'),
						resetTimeIso: '2026-11-26T16:00:00.000Z',
					},
					{
						id: 'g-1w',
						name: 'Weekly Limit',
						window: 'weekly',
						remainingFraction: 0,
						remainingPercentage: 0,
						isExhausted: true,
						resetTime: new Date('2026-11-27T12:00:00Z'),
						resetTimeIso: '2026-11-27T12:00:00.000Z',
					},
				],
			},
		],
	};

	const html = renderDashboardHtml({
		snapshot,
		error: null,
		config: BASE_CONFIG,
		focused: true,
		loading: false,
		locale: 'en-US',
		cspSource: 'vscode-webview://test',
		nonce: 'test-nonce-123',
		strings: STRINGS,
		now: new Date('2026-11-26T12:00:00Z'),
	});

	assert.ok(html.includes("script-src 'nonce-test-nonce-123'"));
	assert.ok(html.includes('ring-svg'));
	assert.ok(html.includes('50%'));
	assert.ok(html.includes('0%'));
	assert.ok(html.includes('Tightest limit'));
	assert.ok(html.includes('callout-exhausted'));
	assert.ok(html.includes('https://antigravity.google/g1-upgrade'));
});

test('renderDashboardHtml escapes untrusted HTML and shows Configure Path for BINARY_NOT_FOUND', () => {
	const html = renderDashboardHtml({
		snapshot: null,
		error: new AgyClientError('BINARY_NOT_FOUND', '<script>alert("xss")</script>'),
		config: BASE_CONFIG,
		focused: true,
		loading: false,
		locale: 'en-US',
		cspSource: 'vscode-webview://test',
		nonce: 'nonce-abc',
		strings: STRINGS,
	});

	assert.ok(!html.includes('<script>alert("xss")</script>'));
	assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
	assert.ok(html.includes('data-action="configureBinary"'));
	assert.ok(html.includes('BINARY_NOT_FOUND'));
});
