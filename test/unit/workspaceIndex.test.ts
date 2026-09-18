import { describe, expect, it } from 'vitest';
import { parseCss } from '../../src/css/parseCss';
import { ParsedSource, SourceRange } from '../../src/css/selectorModel';
import { ClassAttributeContext, ElementSnapshot } from '../../src/html/analyzeHtml';
import { rank, WorkspaceIndex } from '../../src/index/workspaceIndex';

const EMPTY_RANGE: SourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

function source(
  uri: string,
  css: string,
  opts: { origin?: 'global' | 'inline'; documentUri?: string } = {}
): ParsedSource {
  const { rules, imports } = parseCss(css, uri, {
    origin: opts.origin ?? 'global',
    ...(opts.documentUri !== undefined ? { documentUri: opts.documentUri } : {}),
  });
  return { uri, version: 1, rules, imports };
}

function snapshot(tag: string): ElementSnapshot {
  return { tag, classes: new Set(), parentChildren: [], indexInParent: 0 };
}

function ctxFor(path: string[], subjectTag = 'p'): ClassAttributeContext {
  return {
    partial: '',
    range: EMPTY_RANGE,
    value: '',
    valueRange: EMPTY_RANGE,
    subjectTag,
    subjectId: undefined,
    path: path.map(snapshot),
    subjectParentChildren: [],
    subjectIndexInParent: 0,
  };
}

describe('WorkspaceIndex', () => {
  it('returns matching classes in strict mode', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', 'div .text { } .other { }'));
    const results = index.query(ctxFor(['div']), 'file:///w/page.html', {
      includeNonMatching: false,
    });
    expect(results.map((result) => result.className).sort()).toEqual(['other', 'text']);
    const text = results.find((result) => result.className === 'text')!;
    expect(text.best).toBeDefined();
    expect(text.matching).toHaveLength(1);
  });

  it('omits non-matching classes in strict mode', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', 'div .text { }'));
    const results = index.query(ctxFor(['section']), 'file:///w/page.html', {
      includeNonMatching: false,
    });
    expect(results).toHaveLength(0);
  });

  it('demotes non-matching classes when requested', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', 'div .text { }'));
    const results = index.query(ctxFor(['section']), 'file:///w/page.html', {
      includeNonMatching: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.best).toBeUndefined();
    expect(results[0]!.applicable).toHaveLength(1);
  });

  it('scopes inline rules to their document', () => {
    const index = new WorkspaceIndex();
    index.apply(
      source('file:///w/page.html#style:7', '.inline-class { }', {
        origin: 'inline',
        documentUri: 'file:///w/page.html',
      })
    );
    expect(index.query(ctxFor([]), 'file:///w/page.html', { includeNonMatching: false })).toHaveLength(1);
    expect(index.query(ctxFor([]), 'file:///w/other.html', { includeNonMatching: false })).toHaveLength(0);
  });

  it('replaces a source on reapply', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', '.before { }'));
    index.apply(source('file:///w/a.css', '.after { }'));
    const results = index.query(ctxFor([]), 'file:///w/page.html', { includeNonMatching: false });
    expect(results.map((result) => result.className)).toEqual(['after']);
    expect(index.stats()).toEqual({ files: 1, rules: 1, classes: 1 });
  });

  it('removes a source', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', '.text { }'));
    index.remove('file:///w/a.css');
    expect(index.query(ctxFor([]), 'file:///w/page.html', { includeNonMatching: false })).toHaveLength(0);
    expect(index.stats()).toEqual({ files: 0, rules: 0, classes: 0 });
  });

  it('keeps class buckets from other sources intact', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', '.text { }'));
    index.apply(source('file:///w/b.css', '.text { }'));
    index.remove('file:///w/a.css');
    const results = index.query(ctxFor([]), 'file:///w/page.html', { includeNonMatching: false });
    expect(results).toHaveLength(1);
    expect(results[0]!.applicable).toHaveLength(1);
    expect(results[0]!.applicable[0]!.sourceUri).toBe('file:///w/b.css');
  });

  it('picks the best rule by rank', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', '.text { }'));
    index.apply(source('file:///w/b.css', 'div .text { }'));
    const results = index.query(ctxFor(['div']), 'file:///w/page.html', {
      includeNonMatching: false,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.best!.sourceUri).toBe('file:///w/b.css');
    expect(results[0]!.matching).toHaveLength(2);
  });

  it('stops early when cancelled', () => {
    const index = new WorkspaceIndex();
    index.apply(source('file:///w/a.css', '.text { }'));
    const results = index.query(ctxFor([]), 'file:///w/page.html', { includeNonMatching: false }, {
      isCancellationRequested: true,
    });
    expect(results).toHaveLength(0);
  });
});

describe('rank', () => {
  function ruleFor(selector: string) {
    const { rules } = parseCss(`${selector} { }`, 'file:///w/a.css', { origin: 'global' });
    return rules[0]!;
  }

  it('counts hierarchy depth, tag, and id, capped at 9', () => {
    expect(rank(ruleFor('.text'))).toBe(0);
    expect(rank(ruleFor('div.text'))).toBe(1);
    expect(rank(ruleFor('div#x.text'))).toBe(2);
    expect(rank(ruleFor('.a .b .c .d .e .f .g .h .i .j div#x.text'))).toBe(9);
  });
});
