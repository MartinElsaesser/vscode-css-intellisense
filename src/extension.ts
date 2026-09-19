import * as vscode from 'vscode';
import { CssCompletionProvider } from './completion/provider';
import { CssDefinitionProvider } from './completion/definitionProvider';
import { getConfig } from './config';
import { analyzeHtmlDocument, DocumentAnalysis, HtmlLanguage, isHtmlLanguage } from './html/analyzeHtml';
import { analyzeJsxDocument, isJsxLanguage } from './html/jsxContext';
import { inlineSourcesFor } from './index/inlineStyles';
import { IndexManager } from './index/indexManager';
import { WorkspaceIndex } from './index/workspaceIndex';
import { Logger } from './log';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  logger.setLevel(getConfig().trace);
  context.subscriptions.push(logger);

  const analysisCache = new Map<string, { version: number; analysis: DocumentAnalysis }>();
  const managers = new Map<string, IndexManager>();
  const sessionIndex = new WorkspaceIndex();
  let suggestScheduled = false;

  const managerFor = (uri: vscode.Uri): IndexManager | undefined => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? managers.get(folder.uri.toString()) : undefined;
  };

  const analysisFor = (document: vscode.TextDocument): DocumentAnalysis | undefined => {
    const language = document.languageId;
    const isHtml = isHtmlLanguage(language);
    if (!isHtml && !isJsxLanguage(language)) return undefined;
    const key = document.uri.toString();
    const cached = analysisCache.get(key);
    if (cached && cached.version === document.version) return cached.analysis;
    const analysis = isHtml
      ? analyzeHtmlDocument(document.getText(), language as HtmlLanguage, document.version)
      : analyzeJsxDocument(document.getText(), document.fileName, document.version);
    analysisCache.set(key, { version: document.version, analysis });
    return analysis;
  };

  const createManager = (folder: vscode.WorkspaceFolder): IndexManager => {
    const manager = new IndexManager(folder, analysisFor, logger);
    managers.set(folder.uri.toString(), manager);
    context.subscriptions.push(manager);
    manager.watch();
    void manager.scan();
    return manager;
  };

  for (const folder of vscode.workspace.workspaceFolders ?? []) createManager(folder);

  const indexFor = (document: vscode.TextDocument): WorkspaceIndex | undefined => {
    const manager = managerFor(document.uri);
    if (manager) return manager.index;
    if (isHtmlLanguage(document.languageId)) return sessionIndex;
    return undefined;
  };

  const deps = {
    getAnalysis: analysisFor,
    getIndex: indexFor,
    getConfig: (scope: vscode.Uri) => getConfig(scope),
    logger,
  };
  const provider = new CssCompletionProvider(deps);
  const definitionProvider = new CssDefinitionProvider(deps);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(getConfig().languages, provider, '-', '_'),
    vscode.languages.registerDefinitionProvider(getConfig().languages, definitionProvider)
  );

  const maybeTriggerSuggest = (event: vscode.TextDocumentChangeEvent): void => {
    const config = getConfig(event.document.uri);
    if (!config.triggerSuggestAfterQuote) return;
    const change = event.contentChanges[0];
    if (!change || change.text.length === 0) return;
    const last = change.text[change.text.length - 1];
    if (last !== '"' && last !== "'") return;
    const language = event.document.languageId;
    const isJsx = isJsxLanguage(language);
    if (!isHtmlLanguage(language) && !isJsx) return;
    const insertedLines = change.text.split('\n');
    const line = change.range.start.line + insertedLines.length - 1;
    const character =
      insertedLines.length === 1
        ? change.range.start.character + change.text.length
        : insertedLines[insertedLines.length - 1]!.length;
    const prefix = event.document.lineAt(line).text.slice(0, character);
    const pattern = isJsx ? /className\s*=\s*["']$/ : /class\s*=\s*["']$/;
    if (!pattern.test(prefix)) return;
    if (suggestScheduled) return;
    suggestScheduled = true;
    setImmediate(() => {
      void vscode.commands.executeCommand('editor.action.triggerSuggest').then(
        () => {
          suggestScheduled = false;
        },
        () => {
          suggestScheduled = false;
        }
      );
    });
  };

  const indexOpenedDocument = (document: vscode.TextDocument, immediate: boolean): void => {
    const manager = managerFor(document.uri);
    if (manager) {
      void manager.handleDocumentChanged(document, immediate);
    } else if (isHtmlLanguage(document.languageId)) {
      sessionIndex.replaceDocument(
        document.uri.toString(),
        inlineSourcesFor(document, analysisFor(document))
      );
    }
  };

  for (const document of vscode.workspace.textDocuments) indexOpenedDocument(document, true);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => indexOpenedDocument(document, true)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      indexOpenedDocument(document, false);
      maybeTriggerSuggest(event);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const manager = managerFor(document.uri);
      if (manager) {
        void manager.handleDocumentClosed(document);
      } else if (isHtmlLanguage(document.languageId)) {
        sessionIndex.replaceDocument(document.uri.toString(), []);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      logger.setLevel(getConfig().trace);
      if (
        event.affectsConfiguration('cssIntellisense.cssGlobs') ||
        event.affectsConfiguration('cssIntellisense.excludeGlobs') ||
        event.affectsConfiguration('files.exclude') ||
        event.affectsConfiguration('search.exclude')
      ) {
        for (const manager of managers.values()) void manager.reconfigure();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const removed of event.removed) {
        const key = removed.uri.toString();
        managers.get(key)?.dispose();
        managers.delete(key);
      }
      for (const added of event.added) createManager(added);
    }),
    vscode.commands.registerCommand('cssIntellisense.rebuildIndex', async () => {
      sessionIndex.clear();
      for (const manager of managers.values()) await manager.reconfigure();
    }),
    vscode.commands.registerCommand('cssIntellisense.showIndexStats', async () => {
      if (managers.size === 0) {
        await vscode.window.showInformationMessage('CSS Intellisense: no workspace folder indexed');
        return;
      }
      const lines: string[] = [];
      for (const manager of managers.values()) {
        const stats = manager.stats();
        lines.push(
          `${manager.folder.name}: ${stats.files} files, ${stats.rules} rules, ${stats.classes} classes`
        );
      }
      await vscode.window.showInformationMessage(lines.join('\n'));
    })
  );
}

export function deactivate(): void {}
