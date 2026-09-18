import * as vscode from 'vscode';
import { getConfig } from './config';
import { Logger } from './log';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  logger.setLevel(getConfig().trace);

  context.subscriptions.push(
    logger,
    vscode.commands.registerCommand('cssIntellisense.rebuildIndex', () => {
      logger.info('rebuildIndex requested (index not wired yet)');
    }),
    vscode.commands.registerCommand('cssIntellisense.showIndexStats', () => {
      logger.info('showIndexStats requested (index not wired yet)');
    })
  );
}

export function deactivate(): void {}
