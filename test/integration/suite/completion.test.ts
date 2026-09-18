import * as assert from 'assert';
import * as vscode from 'vscode';
import { completionsAt, find, openFixture, waitFor } from './helpers';

suite('Completion matrix (HTML)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('laborant.vscode-css-intellisense')?.activate();
    const warmup = await openFixture('matrix/bare.html');
    await waitFor(
      async () => find(await completionsAt(warmup.document, warmup.position), 'bare') !== undefined
    );
  });

  test('suggests descendant classes inside a matching ancestor', async () => {
    const div = await openFixture('matrix/div-descendant.html');
    assert.ok(find(await completionsAt(div.document, div.position), 'text'));
    const section = await openFixture('matrix/section-match.html');
    assert.ok(find(await completionsAt(section.document, section.position), 'text'));
  });

  test('hides descendant classes outside a matching ancestor', async () => {
    const { document, position } = await openFixture('matrix/section-wrong.html');
    const items = await completionsAt(document, position);
    assert.ok(find(items, 'bare'), 'expected `bare` as a positive control');
    assert.ok(!find(items, 'text'), 'did not expect `text`');
  });

  test('honors child combinators', async () => {
    const direct = await openFixture('matrix/child-direct.html');
    assert.ok(find(await completionsAt(direct.document, direct.position), 'direct'));
    const deep = await openFixture('matrix/child-deep.html');
    assert.ok(!find(await completionsAt(deep.document, deep.position), 'direct'));
  });

  test('honors adjacent siblings', async () => {
    const match = await openFixture('matrix/sibling-adjacent.html');
    assert.ok(find(await completionsAt(match.document, match.position), 'sibling'));
    const wrong = await openFixture('matrix/sibling-wrong.html');
    assert.ok(!find(await completionsAt(wrong.document, wrong.position), 'sibling'));
  });

  test('enforces subject tag constraints', async () => {
    const div = await openFixture('matrix/tag-subject.html');
    assert.ok(find(await completionsAt(div.document, div.position), 'text'));
    const span = await openFixture('matrix/tag-subject-wrong.html');
    assert.ok(!find(await completionsAt(span.document, span.position), 'text'));
  });

  test('requires ancestor ids', async () => {
    const match = await openFixture('matrix/id-ancestor.html');
    assert.ok(find(await completionsAt(match.document, match.position), 'hashed'));
    const missing = await openFixture('matrix/id-ancestor-missing.html');
    assert.ok(!find(await completionsAt(missing.document, missing.position), 'hashed'));
  });

  test('matches html body selectors in full documents', async () => {
    const { document, position } = await openFixture('matrix/full-doc.html');
    assert.ok(find(await completionsAt(document, position), 'fulldoc'));
  });

  test('replaces only the token under the cursor', async () => {
    const { document, position } = await openFixture('matrix/range.html');
    const item = find(await completionsAt(document, position), 'text');
    assert.ok(item?.range, 'expected a replace range');
    const range = item.range as vscode.Range;
    assert.strictEqual(range.start.character, position.character - 2);
    assert.strictEqual(range.end.character, position.character);
  });

  test('hides already used classes', async () => {
    const { document, position } = await openFixture('matrix/used-class.html');
    assert.ok(!find(await completionsAt(document, position), 'bare'));
  });

  test('demotes non-matching classes when strictHierarchy is false', async () => {
    const config = vscode.workspace.getConfiguration('cssIntellisense');
    await config.update('strictHierarchy', false, vscode.ConfigurationTarget.Global);
    try {
      const { document, position } = await openFixture('matrix/strict-off.html');
      const items = await completionsAt(document, position);
      const text = find(items, 'text');
      assert.ok(text, 'expected demoted `text`');
      assert.ok(
        text.sortText?.startsWith('zz'),
        `expected a zz sort prefix, got ${text.sortText}`
      );
      assert.ok(text.detail?.includes('(context mismatch)'), `got detail: ${text.detail}`);
    } finally {
      await config.update('strictHierarchy', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
