import * as path from 'path';
import * as vscode from 'vscode';

export const MARKER = '«cursor»';

let counter = 0;

export interface Fixture {
  document: vscode.TextDocument;
  position: vscode.Position;
}

export async function openFixture(relativePath: string): Promise<Fixture> {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  if (!folder) throw new Error('no workspace folder is open');
  const source = vscode.Uri.joinPath(folder.uri, relativePath);
  const raw = Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8');
  const markerIndex = raw.indexOf(MARKER);
  if (markerIndex === -1) throw new Error(`no cursor marker in ${relativePath}`);
  const text = raw.slice(0, markerIndex) + raw.slice(markerIndex + MARKER.length);
  const tmpDir = vscode.Uri.joinPath(folder.uri, '.tmp');
  await vscode.workspace.fs.createDirectory(tmpDir);
  const target = vscode.Uri.joinPath(tmpDir, `${counter++}-${path.basename(relativePath)}`);
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
  const document = await vscode.workspace.openTextDocument(target);
  return { document, position: document.positionAt(markerIndex) };
}

export async function completionsAt(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.CompletionItem[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    position
  );
  return list ? list.items : [];
}

export function labelOf(item: vscode.CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label.label;
}

export function find(
  items: vscode.CompletionItem[],
  className: string
): vscode.CompletionItem | undefined {
  return items.find((item) => labelOf(item) === className);
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for the expected completion');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
