import * as vscode from 'vscode';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Canal de diagnóstico estructurado en el panel Output de VS Code. */
export class Logger implements vscode.Disposable {
	private readonly channel: vscode.OutputChannel;

	constructor(channelName = 'AG Quota Monitor') {
		this.channel = vscode.window.createOutputChannel(channelName);
	}

	private write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
		const ts = new Date().toISOString();
		const line = `${ts} [${level}] [${scope}] ${message}`;
		this.channel.appendLine(line);
		if (detail !== undefined) {
			try {
				const serialized =
					detail instanceof Error
						? `${detail.name}: ${detail.message}`
						: typeof detail === 'string'
						? detail
						: JSON.stringify(detail);
				this.channel.appendLine(`    ${serialized}`);
			} catch {
				this.channel.appendLine(`    ${String(detail)}`);
			}
		}
	}

	debug(scope: string, message: string, detail?: unknown): void {
		this.write('DEBUG', scope, message, detail);
	}

	info(scope: string, message: string, detail?: unknown): void {
		this.write('INFO', scope, message, detail);
	}

	warn(scope: string, message: string, detail?: unknown): void {
		this.write('WARN', scope, message, detail);
	}

	error(scope: string, message: string, detail?: unknown): void {
		this.write('ERROR', scope, message, detail);
	}

	show(): void {
		this.channel.show(true);
	}

	dispose(): void {
		this.channel.dispose();
	}
}
