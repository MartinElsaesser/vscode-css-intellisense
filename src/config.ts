import * as vscode from 'vscode';
import { CssIntellisenseConfig, parseConfig } from './configModel';

export function getConfig(scope?: vscode.ConfigurationScope): CssIntellisenseConfig {
  const raw = vscode.workspace.getConfiguration('cssIntellisense', scope);
  return parseConfig({ get: (key) => raw.get(key) });
}
