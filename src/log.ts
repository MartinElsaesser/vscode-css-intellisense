import * as vscode from 'vscode';
import type { TraceLevel } from './configModel';

const LEVEL_ORDER: Record<TraceLevel, number> = { off: 0, messages: 1, verbose: 2 };

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('CSS Intellisense');
  private level: TraceLevel = 'off';

  setLevel(level: TraceLevel): void {
    this.level = level;
  }

  info(message: string): void {
    this.write('messages', 'info', message);
  }

  warn(message: string): void {
    this.write('messages', 'warn', message);
  }

  verbose(message: string): void {
    this.write('verbose', 'verbose', message);
  }

  error(message: string): void {
    this.channel.appendLine(`[error] ${message}`);
  }

  get traceLevel(): TraceLevel {
    return this.level;
  }

  private write(required: TraceLevel, tag: string, message: string): void {
    if (LEVEL_ORDER[this.level] >= LEVEL_ORDER[required]) {
      this.channel.appendLine(`[${tag}] ${message}`);
    }
  }

  dispose(): void {
    this.channel.dispose();
  }
}
