import * as vscode from 'vscode';
import { CssCompletionProvider } from './completion/provider';
import { getConfig } from './config';
import type { CssIntellisenseConfig } from './configModel';
import { parseCss } from './css/parseCss';
import { analyzeHtmlDocument, DocumentAnalysis, HtmlLanguage } from './html/analyzeHtml';
import { WorkspaceIndex } from './index/workspaceIndex';
import { Logger } from './log';

const HTML_LANGUAGES = new Set(['html', 'vue', 'svelte']);

function braceGlob(globs: string[]): string {
  if (globs.length === 0) return '**/node_modules/**';
  if (globs.length === 1) return globs[0]!;
  return `{${globs.join(',')}}`;
}

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  context.subscriptions.push(logger);

  const analysisCache = new Map<string, { version: number; analysis: DocumentAnalysis }>();
  const indexes = new Map<string, WorkspaceIndex>();

  const analysisFor = (document: vscode.TextDocument): DocumentAnalysis | undefined => {
    if (!HTML_LANGUAGES.has(document.languageId)) return undefined;
    const key = document.uri.toString();
    const cached = analysisCache.get(key);
    if (cached && cached.version === document.version) return cached.analysis;
    const analysis = analyzeHtmlDocument(
      document.getText(),
      document.languageId as HtmlLanguage,
      document.version
    );
    analysisCache.set(key, { version: document.version, analysis });
    return analysis;
  };

  const indexFor = (document: vscode.TextDocument): WorkspaceIndex | undefined => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    return indexes.get(folder.uri.toString());
  };

  const provider = new CssCompletionProvider({
    getAnalysis: analysisFor,
    getIndex: indexFor,
    getConfig: (scope) => getConfig(scope),
    logger,
  });

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(getConfig().languages, provider, '-', '_')
  );

  const readFile = async (uri: vscode.Uri): Promise<string | undefined> => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } catch (error) {
      logger.warn(`read failed ${uri.toString()}: ${String(error)}`);
      return undefined;
    }
  };

  const parseInto = (
    index: WorkspaceIndex,
    uri: vscode.Uri,
    text: string,
    version: number
  ): void => {
    try {
      const parsed = parseCss(text, uri.toString(), { origin: 'global' });
      index.apply({
        uri: uri.toString(),
        version,
        rules: parsed.rules,
        imports: parsed.imports,
      });
    } catch (error) {
      logger.warn(
        `parse failed ${uri.toString()}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const indexFile = async (
    index: WorkspaceIndex,
    uri: vscode.Uri,
    config: CssIntellisenseConfig
  ): Promise<void> => {
    const text = await readFile(uri);
    if (text === undefined) return;
    if (Buffer.byteLength(text, 'utf8') > config.maxFileSizeKB * 1024) {
      logger.warn(`skipping large file ${uri.toString()}`);
      return;
    }
    parseInto(index, uri, text, 0);
  };

  const scanFolder = async (folder: vscode.WorkspaceFolder): Promise<void> => {
    const config = getConfig(folder.uri);
    const index = new WorkspaceIndex();
    indexes.set(folder.uri.toString(), index);
    const exclude = braceGlob(config.excludeGlobs);
    const collected = new Map<string, vscode.Uri>();
    for (const glob of config.cssGlobs) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, glob),
        exclude
      );
      for (const uri of found) collected.set(uri.toString(), uri);
    }
    let count = 0;
    for (const uri of collected.values()) {
      if (count >= 5000) {
        logger.warn('scan cap reached (5000 files); some stylesheets were not indexed');
        break;
      }
      await indexFile(index, uri, config);
      count++;
      if (count % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    logger.info(`indexed ${count} stylesheets in ${folder.name}`);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('cssIntellisense.rebuildIndex', async () => {
      indexes.clear();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        await scanFolder(folder);
      }
    }),
    vscode.commands.registerCommand('cssIntellisense.showIndexStats', async () => {
      if (indexes.size === 0) {
        await vscode.window.showInformationMessage('CSS Intellisense: no workspace folder indexed');
        return;
      }
      const lines: string[] = [];
      for (const [key, index] of indexes) {
        const stats = index.stats();
        lines.push(`${key}: ${stats.files} files, ${stats.rules} rules, ${stats.classes} classes`);
      }
      await vscode.window.showInformationMessage(lines.join('\n'));
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'css') return;
      const folder = vscode.workspace.getWorkspaceFolder(event.document.uri);
      if (!folder) return;
      const index = indexes.get(folder.uri.toString());
      if (!index) return;
      parseInto(index, event.document.uri, event.document.getText(), event.document.version);
    })
  );

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    void scanFolder(folder);
  }
}

export function deactivate(): void {}
