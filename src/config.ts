import * as vscode from 'vscode';
import { CssIntellisenseConfig, fromRaw } from './configModel';

export function getConfig(scope?: vscode.ConfigurationScope): CssIntellisenseConfig {
  const raw = vscode.workspace.getConfiguration('cssIntellisense', scope);
  return fromRaw(raw);
}
