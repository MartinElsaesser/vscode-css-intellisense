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
    const divItems = await completionsAt(div.document, div.position);
    const text = find(divItems, 'text');
    assert.ok(text, 'expected `text`');
    assert.ok(text.detail?.includes('styles/main.css'), `detail: ${text.detail}`);
    assert.ok(!text.detail?.includes('file://'), `detail: ${text.detail}`);
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

  test('resolves native CSS nesting', async () => {
    const inside = await openFixture('matrix/nested.html');
    await waitFor(async () => {
      const items = await completionsAt(inside.document, inside.position);
      return find(items, 'nest-inner') !== undefined && find(items, 'nest-child') !== undefined;
    });
    const outside = await openFixture('matrix/nested-wrong.html');
    assert.ok(find(await completionsAt(outside.document, outside.position), 'bare'), 'positive control');
    assert.ok(!find(await completionsAt(outside.document, outside.position), 'nest-inner'));
    assert.ok(!find(await completionsAt(outside.document, outside.position), 'nest-child'));
  });

  test('covers the remaining acceptance matrix rows', async () => {
    const cases: [string, string, boolean][] = [
      ['matrix/sibling-general.html', 'general', true],
      ['matrix/compound-match.html', 'compound', true],
      ['matrix/compound-missing.html', 'compound', false],
      ['matrix/nested-match.html', 'nested', true],
      ['matrix/nested-wrong.html', 'nested', false],
      ['matrix/id-wrong.html', 'hashed', false],
      ['matrix/pseudo.html', 'pseudo', true],
      ['matrix/attr.html', 'attr', true],
      ['matrix/notpseudo.html', 'notpseudo', true],
      ['matrix/mixed.html', 'mixed', true],
    ];
    for (const [fixture, className, expected] of cases) {
      const { document, position } = await openFixture(fixture);
      const items = await completionsAt(document, position);
      assert.strictEqual(
        find(items, className) !== undefined,
        expected,
        `${fixture}: expected ${expected ? 'to find' : 'not to find'} \`${className}\``
      );
    }
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

suite('Inline styles, imports, and configuration', () => {
  test('scopes inline <style> rules to their document', async () => {
    const inline = await openFixture('matrix/inline.html');
    await waitFor(
      async () => find(await completionsAt(inline.document, inline.position), 'inline-only') !== undefined
    );
    const other = await openFixture('matrix/inline-other.html');
    assert.ok(find(await completionsAt(other.document, other.position), 'bare'), 'positive control');
    assert.ok(!find(await completionsAt(other.document, other.position), 'inline-only'));
  });

  test('follows @import when resolveImports is on', async () => {
    const config = vscode.workspace.getConfiguration('cssIntellisense');
    await config.update('cssGlobs', ['styles/importer.css'], vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('cssIntellisense.rebuildIndex');
      const { document, position } = await openFixture('matrix/imported.html');
      await waitFor(
        async () => find(await completionsAt(document, position), 'imported-only') !== undefined
      );
    } finally {
      await config.update('cssGlobs', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('cssIntellisense.rebuildIndex');
    }
  });

  test('does not follow @import when resolveImports is off', async () => {
    const config = vscode.workspace.getConfiguration('cssIntellisense');
    await config.update('cssGlobs', ['styles/importer.css'], vscode.ConfigurationTarget.Global);
    await config.update('resolveImports', false, vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('cssIntellisense.rebuildIndex');
      const { document, position } = await openFixture('matrix/imported.html');
      await waitFor(
        async () => find(await completionsAt(document, position), 'imported-only') === undefined
      );
    } finally {
      await config.update('resolveImports', undefined, vscode.ConfigurationTarget.Global);
      await config.update('cssGlobs', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('cssIntellisense.rebuildIndex');
    }
  });

  test('master switch disables completions', async () => {
    const config = vscode.workspace.getConfiguration('cssIntellisense');
    await config.update('enabled', false, vscode.ConfigurationTarget.Global);
    try {
      const { document, position } = await openFixture('matrix/div-descendant.html');
      assert.ok(!find(await completionsAt(document, position), 'text'));
    } finally {
      await config.update('enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('honors workspace files.exclude and search.exclude', async () => {
    const { document, position } = await openFixture('matrix/settings-hidden.html');
    const visible = async () =>
      find(await completionsAt(document, position), 'settings-hidden') !== undefined;
    await waitFor(visible);

    const files = vscode.workspace.getConfiguration('files');
    await files.update(
      'exclude',
      { '**/grouped/settings-hidden': true },
      vscode.ConfigurationTarget.Global
    );
    try {
      await waitFor(async () => !(await visible()));
    } finally {
      await files.update('exclude', undefined, vscode.ConfigurationTarget.Global);
    }
    await waitFor(visible);

    const search = vscode.workspace.getConfiguration('search');
    await search.update(
      'exclude',
      { '**/grouped/settings-hidden': true },
      vscode.ConfigurationTarget.Global
    );
    try {
      await waitFor(async () => !(await visible()));
    } finally {
      await search.update('exclude', undefined, vscode.ConfigurationTarget.Global);
    }
    await waitFor(visible);
  });

  test('scans Vue single-file components', async () => {
    const fixture = await openFixture('matrix/inline.vue');
    if (fixture.document.languageId !== 'vue') {
      await vscode.languages.setTextDocumentLanguage(fixture.document, 'vue');
    }
    await waitFor(
      async () => find(await completionsAt(fixture.document, fixture.position), 'vue-inline') !== undefined
    );
    assert.ok(find(await completionsAt(fixture.document, fixture.position), 'text'), 'global rule');
  });

  test('scans Svelte components', async () => {
    const fixture = await openFixture('matrix/inline.svelte');
    if (fixture.document.languageId !== 'svelte') {
      await vscode.languages.setTextDocumentLanguage(fixture.document, 'svelte');
    }
    await waitFor(
      async () =>
        find(await completionsAt(fixture.document, fixture.position), 'svelte-inline') !== undefined
    );
    assert.ok(find(await completionsAt(fixture.document, fixture.position), 'text'), 'global rule');
  });

  test('does not leak component styles to other documents', async () => {
    const other = await openFixture('matrix/inline-other.html');
    assert.ok(find(await completionsAt(other.document, other.position), 'bare'), 'positive control');
    assert.ok(!find(await completionsAt(other.document, other.position), 'vue-inline'));
    assert.ok(!find(await completionsAt(other.document, other.position), 'svelte-inline'));
  });
});

suite('JSX/TSX completions', () => {
  test('suggests hierarchy-aware classes in TSX', async () => {
    const { document, position } = await openFixture('matrix/classes.tsx');
    await waitFor(
      async () => find(await completionsAt(document, position), 'text') !== undefined
    );
  });

  test('never matches sibling combinators in JSX', async () => {
    const { document, position } = await openFixture('matrix/siblings.tsx');
    assert.ok(find(await completionsAt(document, position), 'bare'), 'positive control');
    assert.ok(!find(await completionsAt(document, position), 'sibling'));
    assert.ok(!find(await completionsAt(document, position), 'general'));
  });

  test('does not cross component boundaries', async () => {
    const { document, position } = await openFixture('matrix/component.tsx');
    assert.ok(find(await completionsAt(document, position), 'bare'), 'positive control');
    assert.ok(!find(await completionsAt(document, position), 'text'));
  });
});
