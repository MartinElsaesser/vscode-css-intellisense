import * as assert from 'assert';
import * as vscode from 'vscode';
import { openFixture, waitFor } from './helpers';

async function definitionsAt(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location[]> {
  const result = await vscode.commands.executeCommand<
    Array<vscode.Location | vscode.LocationLink>
  >('vscode.executeDefinitionProvider', document.uri, position);
  return (result ?? []).map((entry) =>
    'targetUri' in entry ? new vscode.Location(entry.targetUri, entry.targetRange) : entry
  );
}

async function lineOf(relativePath: string, needle: string): Promise<number> {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0]!;
  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  assert.ok(index >= 0, `missing "${needle}" in ${relativePath}`);
  return index;
}

suite('Go to definition', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('laborant.vscode-css-intellisense')?.activate();
  });

  test('jumps to the matching rule in a stylesheet', async () => {
    const { document, position } = await openFixture('matrix/definition.html');
    await waitFor(async () => (await definitionsAt(document, position)).length > 0);
    const first = (await definitionsAt(document, position))[0]!;
    assert.ok(first.uri.path.endsWith('styles/main.css'), `got ${first.uri.path}`);
    assert.strictEqual(first.range.start.line, await lineOf('styles/main.css', 'div .text'));
  });

  test('jumps to a nested rule', async () => {
    const { document, position } = await openFixture('matrix/definition-nested.html');
    await waitFor(async () => (await definitionsAt(document, position)).length > 0);
    const target = (await definitionsAt(document, position)).find((location) =>
      location.uri.path.endsWith('styles/nested.css')
    );
    assert.ok(target, 'expected a nested.css definition');
    assert.strictEqual(target.range.start.line, await lineOf('styles/nested.css', '.nav-link'));
  });

  test('returns definitions outside the matching context too', async () => {
    const { document, position } = await openFixture('matrix/definition-outside.html');
    await waitFor(async () => (await definitionsAt(document, position)).length > 0);
    assert.ok(
      (await definitionsAt(document, position)).some((location) =>
        location.uri.path.endsWith('styles/main.css')
      )
    );
  });

  test('returns nothing for unknown classes', async () => {
    const { document, position } = await openFixture('matrix/definition-unknown.html');
    assert.strictEqual((await definitionsAt(document, position)).length, 0);
  });
});
