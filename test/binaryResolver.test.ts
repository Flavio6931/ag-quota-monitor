import assert from 'node:assert/strict';
import test from 'node:test';
import { posix, win32 } from 'node:path';
import { resolveAgyBinary } from '../src/core/binaryResolver';

test('resolveAgyBinary prefers custom path and expands tilde', () => {
	const home = 'C:\\Users\\tester';
	const customExe = win32.join(home, 'custom', 'agy.exe');
	const res = resolveAgyBinary('~/custom/agy.exe', {
		home,
		platform: 'win32',
		env: {},
		exists: p => p === customExe,
	});
	assert.equal(res.source, 'custom');
	assert.equal(res.binaryPath, customExe);
});

test('resolveAgyBinary finds known ~/.gemini/bin path before PATH', () => {
	const home = '/home/tester';
	const known = posix.join(home, '.gemini', 'bin', 'agy');
	const fromPath = posix.join('/usr/bin', 'agy');
	const res = resolveAgyBinary('', {
		home,
		platform: 'linux',
		env: { PATH: '/usr/bin' },
		exists: p => p === known || p === fromPath,
	});
	assert.equal(res.source, 'known');
	assert.equal(res.binaryPath, known);
});

test('resolveAgyBinary falls back to PATH and handles missing binary', () => {
	const fromPath = posix.join('/opt/tools', 'agy');
	const found = resolveAgyBinary('', {
		home: '/home/tester',
		platform: 'linux',
		env: { PATH: '/usr/local/sbin:/opt/tools' },
		exists: p => p === fromPath,
	});
	assert.equal(found.source, 'path');
	assert.equal(found.binaryPath, fromPath);

	const missing = resolveAgyBinary('', {
		home: '/home/tester',
		platform: 'linux',
		env: { PATH: '/usr/bin' },
		exists: () => false,
	});
	assert.equal(missing.source, 'not_found');
	assert.equal(missing.binaryPath, null);
});
