import * as vscode from 'vscode';

export interface LoadedFile {
  uri: string;
  version: number;
  text: string;
}

export class FileLoader {
  private readonly cache = new Map<string, { mtimeMs: number; text: string }>();

  constructor(private readonly defaultMaxFileSizeKB: number) {}

  async load(uri: vscode.Uri, maxFileSizeKB = this.defaultMaxFileSizeKB): Promise<LoadedFile | undefined> {
    const key = uri.toString();
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }
    if (stat.type === vscode.FileType.Directory) return undefined;
    const cached = this.cache.get(key);
    if (cached && cached.mtimeMs === stat.mtime) {
      return { uri: key, version: stat.mtime, text: cached.text };
    }
    if (stat.size > maxFileSizeKB * 1024) return undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const raw = Buffer.from(bytes).toString('utf8');
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      this.cache.set(key, { mtimeMs: stat.mtime, text });
      return { uri: key, version: stat.mtime, text };
    } catch {
      return undefined;
    }
  }

  invalidate(uri: vscode.Uri | string): void {
    this.cache.delete(typeof uri === 'string' ? uri : uri.toString());
  }

  clear(): void {
    this.cache.clear();
  }
}
