import * as vscode from 'vscode';
import type { CssIntellisenseConfig } from '../configModel';
import type { SourceRange } from '../css/selectorModel';
import type { ClassAttributeContext, DocumentAnalysis } from '../html/analyzeHtml';
import { ClassMatch, rank, WorkspaceIndex } from '../index/workspaceIndex';
import { subjectClasses } from '../match/matcher';
import type { Logger } from '../log';

export interface CompletionDeps {
  getAnalysis(document: vscode.TextDocument): DocumentAnalysis | undefined;
  getIndex(document: vscode.TextDocument): WorkspaceIndex | undefined;
  getConfig(scope: vscode.Uri): CssIntellisenseConfig;
  logger: Logger;
}

interface CompletionData {
  selectorText: string;
  sourceUri: string;
  range: SourceRange;
}

class CssCompletionItem extends vscode.CompletionItem {
  constructor(
    label: string,
    readonly completionData: CompletionData
  ) {
    super(label, vscode.CompletionItemKind.Class);
  }
}

function toVscodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function workspaceRelativePath(sourceUri: string): string {
  return vscode.workspace.asRelativePath(vscode.Uri.parse(sourceUri), false);
}

export class CssCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly deps: CompletionDeps) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.CompletionItem[] | undefined {
    const config = this.deps.getConfig(document.uri);
    if (!config.enabled) return undefined;

    const analysis = this.deps.getAnalysis(document);
    if (!analysis) return undefined;

    const ctx = analysis.contextAt(document.offsetAt(position));
    if (!ctx) return undefined;

    const index = this.deps.getIndex(document);
    if (!index) return undefined;

    const used = subjectClasses(ctx);
    const results = index.query(
      ctx,
      document.uri.toString(),
      { includeNonMatching: !config.strictHierarchy },
      token
    );

    const items: vscode.CompletionItem[] = [];
    for (const result of results) {
      if (token.isCancellationRequested) return items;
      if (config.hideAlreadyUsedClasses && used.has(result.className)) continue;
      items.push(this.toItem(result, ctx));
    }
    return items;
  }

  resolveCompletionItem(item: vscode.CompletionItem): vscode.CompletionItem {
    if (!(item instanceof CssCompletionItem)) return item;
    const { selectorText, sourceUri, range } = item.completionData;
    const relative = workspaceRelativePath(sourceUri);
    const selection = {
      start: { line: range.start.line, character: range.start.character },
      end: { line: range.end.line, character: range.end.character },
    };
    const commandLink =
      'command:vscode.open?' +
      encodeURIComponent(JSON.stringify([sourceUri, { selection }]));
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(selectorText, 'css');
    markdown.appendMarkdown(`\n[${relative}:${range.start.line + 1}](${commandLink})`);
    markdown.isTrusted = { enabledCommands: ['vscode.open'] };
    item.documentation = markdown;
    return item;
  }

  private toItem(match: ClassMatch, ctx: ClassAttributeContext): vscode.CompletionItem {
    const rule = match.best ?? match.fallback!;
    const completionData: CompletionData = {
      selectorText: rule.selectorText,
      sourceUri: rule.sourceUri,
      range: rule.range,
    };
    const item = new CssCompletionItem(match.className, completionData);
    item.insertText = match.className;
    item.filterText = match.className;
    item.range = toVscodeRange(ctx.range);

    const relative = workspaceRelativePath(rule.sourceUri);
    const mismatch = !match.best;
    item.detail = `${rule.selectorText} — ${relative}${mismatch ? ' (context mismatch)' : ''}`;

    const rankPart = String(9 - rank(rule)).padStart(2, '0');
    item.sortText = `${mismatch ? 'zz' : ''}${rankPart}${match.className.toLowerCase()}\u0000${match.className}`;
    return item;
  }
}
