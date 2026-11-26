import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface BinaryResolverDeps {
	exists?: (path: string) => boolean;
	env?: NodeJS.ProcessEnv;
	home?: string;
	platform?: NodeJS.Platform;
}

export interface BinaryResolution {
	binaryPath: string | null;
	searchedCandidates: string[];
	source: 'custom' | 'known' | 'path' | 'not_found';
}

function expandHome(inputPath: string, homeDir: string, joinPath: (...paths: string[]) => string): string {
	if (inputPath === '~') {
		return homeDir;
	}
	if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
		return joinPath(homeDir, inputPath.slice(2));
	}
	return inputPath;
}

/**
 * Resuelve la ruta del ejecutable oficial `agy` priorizando configuración manual,
 * ubicaciones estándar de instalación y PATH del sistema.
 */
export function resolveAgyBinary(
	customPath?: string,
	deps: BinaryResolverDeps = {}
): BinaryResolution {
	const checkExists = deps.exists ?? existsSync;
	const env = deps.env ?? process.env;
	const home = deps.home ?? homedir();
	const platform = deps.platform ?? process.platform;
	const pathImpl = platform === 'win32' ? win32 : posix;
	const pathDelimiter = platform === 'win32' ? ';' : ':';
	const exeName = platform === 'win32' ? 'agy.exe' : 'agy';
	const searchedCandidates: string[] = [];

	const trimmedCustom = customPath?.trim();
	if (trimmedCustom) {
		const expanded = expandHome(trimmedCustom, home, pathImpl.join);
		searchedCandidates.push(expanded);
		if (checkExists(expanded)) {
			return { binaryPath: expanded, searchedCandidates, source: 'custom' };
		}
	}

	const knownCandidates: string[] = [pathImpl.join(home, '.gemini', 'bin', exeName)];

	if (platform === 'win32') {
		if (env.LOCALAPPDATA) {
			knownCandidates.push(pathImpl.join(env.LOCALAPPDATA, 'Programs', 'antigravity', 'bin', exeName));
		}
		if (env.USERPROFILE && env.USERPROFILE !== home) {
			knownCandidates.push(pathImpl.join(env.USERPROFILE, '.gemini', 'bin', exeName));
		}
	} else {
		knownCandidates.push(
			'/usr/local/bin/agy',
			'/opt/homebrew/bin/agy',
			pathImpl.join(home, '.local', 'bin', 'agy')
		);
	}

	for (const candidate of knownCandidates) {
		if (!searchedCandidates.includes(candidate)) {
			searchedCandidates.push(candidate);
		}
		if (checkExists(candidate)) {
			return { binaryPath: candidate, searchedCandidates, source: 'known' };
		}
	}

	const pathVar = env.PATH || env.Path || '';
	for (const entry of pathVar.split(pathDelimiter)) {
		const dir = entry.trim().replace(/^"|"$/g, '');
		if (!dir) {
			continue;
		}
		const candidate = pathImpl.join(dir, exeName);
		if (!searchedCandidates.includes(candidate)) {
			searchedCandidates.push(candidate);
		}
		if (checkExists(candidate)) {
			return { binaryPath: candidate, searchedCandidates, source: 'path' };
		}
	}

	return { binaryPath: null, searchedCandidates, source: 'not_found' };
}
