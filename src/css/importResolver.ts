import * as vscode from 'vscode';
import type { Logger } from '../log';
import type { FileLoader } from '../index/fileLoader';
import { isPathWithin } from './importSpecifier';
import { parseCss } from './parseCss';
import { ParsedSource } from './selectorModel';

export function isWithinFolder(folder: vscode.Uri, candidate: vscode.Uri): boolean {
  return candidate.scheme === folder.scheme && isPathWithin(folder.path, candidate.path);
}

export class ImportResolver {
  constructor(
    private readonly loader: FileLoader,
    private readonly logger: Logger
  ) {}

  async collect(
    entry: ParsedSource,
    folder: vscode.Uri,
    maxDepth: number
  ): Promise<ParsedSource[]> {
    const visited = new Set<string>([entry.uri]);
    const results: ParsedSource[] = [];
    await this.walk(entry, folder, maxDepth, 0, visited, results);
    return results;
  }

  private async walk(
    source: ParsedSource,
    folder: vscode.Uri,
    maxDepth: number,
    depth: number,
    visited: Set<string>,
    results: ParsedSource[]
  ): Promise<void> {
    if (depth >= maxDepth) return;
    for (const ref of source.imports) {
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(ref.sourceUri);
      } catch {
        continue;
      }
      if (!isWithinFolder(folder, uri)) continue;
      const key = uri.toString();
      if (visited.has(key)) continue;
      visited.add(key);
      const loaded = await this.loader.load(uri);
      if (!loaded) {
        this.logger.warn(`unresolved import "${ref.specifier}" from ${source.uri}`);
        continue;
      }
      let parsed;
      try {
        parsed = parseCss(loaded.text, key, {
          origin: 'global',
          onError: (message) => this.logger.verbose(`${key}: ${message}`),
        });
      } catch (error) {
        this.logger.warn(
          `parse failed ${key}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
      const imported: ParsedSource = {
        uri: key,
        version: loaded.version,
        rules: parsed.rules,
        imports: parsed.imports,
      };
      results.push(imported);
      await this.walk(imported, folder, maxDepth, depth + 1, visited, results);
    }
  }
}
