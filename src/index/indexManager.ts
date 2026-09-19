import * as vscode from 'vscode';
import picomatch from 'picomatch';
import { getConfig } from '../config';
import { ImportResolver, isWithinFolder, resolveImportUri } from '../css/importResolver';
import { parseCss } from '../css/parseCss';
import { ParsedSource } from '../css/selectorModel';
import { collectInlineSourcesFromText } from './inlineStyles';
import { Debouncer } from './debouncer';
import { FileLoader } from './fileLoader';
import { WorkspaceIndex } from './workspaceIndex';
import type { Logger } from '../log';

const INLINE_LANGUAGES = new Set(['html', 'vue', 'svelte']);
const DEBOUNCE_MS = 200;
const CHUNK_SIZE = 25;
const SCAN_CAP = 5000;

interface ExcludeSpec {
  pattern: string | undefined;
  matcher: ((path: string) => boolean) | undefined;
}

export class IndexManager implements vscode.Disposable {
  readonly index = new WorkspaceIndex();
  private readonly loader: FileLoader;
  private readonly resolver: ImportResolver;
  private readonly changeDebouncer = new Debouncer();
  private readonly watcherDebouncer = new Debouncer();
  private readonly globbed = new Set<string>();
  private readonly openDocuments = new Set<string>();
  private watchers: vscode.FileSystemWatcher[] = [];
  private disposed = false;

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    private readonly logger: Logger
  ) {
    this.loader = new FileLoader(getConfig(folder.uri).maxFileSizeKB);
    this.resolver = new ImportResolver(this.loader, this.logger);
  }

  async scan(): Promise<void> {
    const config = getConfig(this.folder.uri);
    const exclude = this.buildExclude(config.excludeGlobs);
    this.index.clear();
    this.globbed.clear();
    const collected = new Map<string, vscode.Uri>();
    for (const glob of config.cssGlobs) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.folder, glob),
        exclude.pattern
      );
      for (const uri of found) collected.set(uri.toString(), uri);
    }
    let count = 0;
    for (const [key, uri] of collected) {
      if (this.disposed) return;
      if (count >= SCAN_CAP) {
        this.logger.warn(`scan cap reached (${SCAN_CAP} files); some stylesheets were not indexed`);
        break;
      }
      if (exclude.matcher && exclude.matcher(this.folderRelativePath(uri))) continue;
      this.globbed.add(key);
      await this.reindexFile(uri);
      count++;
      if (count % CHUNK_SIZE === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    await this.updateReachability();
    this.logger.info(`indexed ${count} stylesheets in ${this.folder.name}`);
  }

  watch(): void {
    this.disposeWatchers();
    const config = getConfig(this.folder.uri);
    for (const glob of config.cssGlobs) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.folder, glob)
      );
      watcher.onDidCreate((uri) => this.scheduleWatcherEvent(uri));
      watcher.onDidChange((uri) => this.scheduleWatcherEvent(uri));
      watcher.onDidDelete((uri) => void this.handleDeletedFile(uri));
      this.watchers.push(watcher);
    }
  }

  async reconfigure(): Promise<void> {
    this.changeDebouncer.dispose();
    this.watcherDebouncer.dispose();
    this.disposeWatchers();
    this.loader.clear();
    await this.scan();
    this.watch();
    await this.refreshOpenDocuments();
  }

  async handleDocumentChanged(document: vscode.TextDocument, immediate = false): Promise<void> {
    if (this.disposed) return;
    const key = document.uri.toString();
    if (document.languageId === 'css') {
      if (immediate) await this.applyCssText(key, document.getText(), document.version);
      else this.changeDebouncer.schedule(key, DEBOUNCE_MS, () => void this.applyCssText(key, document.getText(), document.version));
      return;
    }
    if (!INLINE_LANGUAGES.has(document.languageId)) return;
    this.openDocuments.add(key);
    const text = document.getText();
    const version = document.version;
    const languageId = document.languageId;
    if (immediate) this.applyInlineDocument(key, text, languageId, version);
    else {
      this.changeDebouncer.schedule(key, DEBOUNCE_MS, () =>
        this.applyInlineDocument(key, text, languageId, version)
      );
    }
    await this.updateReachability();
  }

  async handleDocumentClosed(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    if (!this.openDocuments.has(key)) return;
    this.openDocuments.delete(key);
    if (document.languageId === 'css') return;
    if (!document.isDirty && document.uri.scheme === 'file') {
      const loaded = await this.loader.load(document.uri);
      if (loaded) {
        this.applyInlineDocument(key, loaded.text, document.languageId, loaded.version);
        await this.updateReachability();
        return;
      }
    }
    this.index.replaceDocument(key, []);
    await this.updateReachability();
  }

  stats() {
    return this.index.stats();
  }

  dispose(): void {
    this.disposed = true;
    this.changeDebouncer.dispose();
    this.watcherDebouncer.dispose();
    this.disposeWatchers();
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
  }

  private buildExclude(globs: string[]): ExcludeSpec {
    if (globs.length === 0) return { pattern: undefined, matcher: undefined };
    if (globs.some((glob) => glob.includes('{') || glob.includes('}') || glob.includes(','))) {
      const matcher = picomatch(globs, { dot: true });
      return { pattern: undefined, matcher: (path) => matcher(path) };
    }
    const pattern = globs.length === 1 ? globs[0]! : `{${globs.join(',')}}`;
    return { pattern, matcher: undefined };
  }

  private folderRelativePath(uri: vscode.Uri): string {
    const folderPath = this.folder.uri.path.endsWith('/')
      ? this.folder.uri.path
      : `${this.folder.uri.path}/`;
    return uri.path.startsWith(folderPath) ? uri.path.slice(folderPath.length) : uri.path;
  }

  private scheduleWatcherEvent(uri: vscode.Uri): void {
    const key = uri.toString();
    this.watcherDebouncer.schedule(key, DEBOUNCE_MS, () => void this.handleWatcherEvent(uri));
  }

  private isExcluded(uri: vscode.Uri): boolean {
    const exclude = this.buildExclude(getConfig(this.folder.uri).excludeGlobs);
    if (exclude.matcher) return exclude.matcher(this.folderRelativePath(uri));
    return false;
  }

  private async handleWatcherEvent(uri: vscode.Uri): Promise<void> {
    if (this.disposed || this.isExcluded(uri)) return;
    const key = uri.toString();
    if (!isWithinFolder(this.folder.uri, uri)) return;
    this.globbed.add(key);
    this.loader.invalidate(uri);
    await this.reindexFile(uri);
    await this.updateReachability();
  }

  private async handleDeletedFile(uri: vscode.Uri): Promise<void> {
    if (this.disposed) return;
    const key = uri.toString();
    this.globbed.delete(key);
    this.loader.invalidate(uri);
    this.index.remove(key);
    await this.updateReachability();
  }

  private async reindexFile(uri: vscode.Uri): Promise<void> {
    const config = getConfig(uri);
    const loaded = await this.loader.load(uri, config.maxFileSizeKB);
    if (!loaded) return;
    let parsed;
    try {
      parsed = parseCss(loaded.text, loaded.uri, {
        origin: 'global',
        onError: (message) => this.logger.verbose(`${loaded.uri}: ${message}`),
      });
    } catch (error) {
      this.logger.warn(
        `parse failed ${loaded.uri}: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    const source: ParsedSource = {
      uri: loaded.uri,
      version: loaded.version,
      rules: parsed.rules,
      imports: parsed.imports,
    };
    await this.replaceCssSource(source, config.resolveImports, config.maxImportDepth);
  }

  private async applyCssText(key: string, text: string, version: number): Promise<void> {
    const config = getConfig(this.folder.uri);
    let parsed;
    try {
      parsed = parseCss(text, key, {
        origin: 'global',
        onError: (message) => this.logger.verbose(`${key}: ${message}`),
      });
    } catch (error) {
      this.logger.warn(
        `parse failed ${key}: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    const source: ParsedSource = { uri: key, version, rules: parsed.rules, imports: parsed.imports };
    await this.replaceCssSource(source, config.resolveImports, config.maxImportDepth);
  }

  private async replaceCssSource(
    source: ParsedSource,
    resolveImports: boolean,
    maxImportDepth: number
  ): Promise<void> {
    this.index.replaceDocument(source.uri, [source]);
    if (resolveImports) {
      const imports = await this.resolver.collect(source, this.folder.uri, maxImportDepth);
      for (const imported of imports) this.index.apply(imported);
    }
    await this.updateReachability();
  }

  private applyInlineDocument(
    key: string,
    text: string,
    languageId: string,
    version: number
  ): void {
    const sources = collectInlineSourcesFromText(text, languageId, version, key);
    this.index.replaceDocument(key, sources);
  }

  private async refreshOpenDocuments(): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
      if (!isWithinFolder(this.folder.uri, document.uri)) continue;
      if (document.languageId === 'css' || INLINE_LANGUAGES.has(document.languageId)) {
        await this.handleDocumentChanged(document, true);
      }
    }
  }

  private async updateReachability(): Promise<void> {
    const reachable = new Set<string>(this.globbed);
    for (const documentUri of this.openDocuments) {
      for (const key of this.index.sourceKeysFor(documentUri)) reachable.add(key);
    }
    const queue = [...reachable];
    while (queue.length > 0) {
      const key = queue.pop()!;
      const parsed = this.index.parsedFor(key);
      if (!parsed) continue;
      for (const ref of parsed.imports) {
        const resolved = resolveImportUri(ref.fromUri, ref.specifier);
        if (!resolved) continue;
        const importedKey = resolved.toString();
        if (!reachable.has(importedKey)) {
          reachable.add(importedKey);
          queue.push(importedKey);
        }
      }
    }
    this.index.retain(reachable);
  }
}
