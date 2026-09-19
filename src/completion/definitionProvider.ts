import * as vscode from 'vscode';
import { ProviderDeps, toVscodeRange } from './provider';

export class CssDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly deps: ProviderDeps) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.LocationLink[] | undefined {
    if (token.isCancellationRequested) return undefined;
    if (!this.deps.getConfig(document.uri).enabled) return undefined;

    const analysis = this.deps.getAnalysis(document);
    if (!analysis) return undefined;

    const ctx = analysis.contextAt(document.offsetAt(position));
    if (!ctx || !ctx.partial) return undefined;

    const index = this.deps.getIndex(document);
    if (!index) return undefined;

    const rules = index.definitionsFor(ctx.partial, ctx, document.uri.toString());
    if (rules.length === 0) return undefined;

    return rules.map((rule) => ({
      originSelectionRange: toVscodeRange(ctx.range),
      targetUri: vscode.Uri.parse(rule.sourceUri),
      targetRange: toVscodeRange(rule.range),
      targetSelectionRange: toVscodeRange(rule.range),
    }));
  }
}
