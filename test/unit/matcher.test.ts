import { describe, expect, it } from 'vitest';
import { parseCss } from '../../src/css/parseCss';
import { ClassRule, SourceRange } from '../../src/css/selectorModel';
import { ClassAttributeContext, ElementSnapshot, analyzeHtmlDocument } from '../../src/html/analyzeHtml';
import { matches } from '../../src/match/matcher';

interface ElDef {
  tag: string;
  id?: string;
  classes?: string[];
  children?: ElDef[];
}

const EMPTY_RANGE: SourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

function build(defs: ElDef[]): Map<ElDef, ElementSnapshot> {
  const snapshots = new Map<ElDef, ElementSnapshot>();
  const walk = (list: ElDef[]): void => {
    const parentChildren: ElementSnapshot[] = [];
    list.forEach((def, index) => {
      const snapshot: ElementSnapshot = {
        tag: def.tag,
        ...(def.id !== undefined ? { id: def.id } : {}),
        classes: new Set(def.classes ?? []),
        parentChildren,
        indexInParent: index,
      };
      parentChildren.push(snapshot);
      snapshots.set(def, snapshot);
      if (def.children) walk(def.children);
    });
  };
  walk(defs);
  return snapshots;
}

function ctxFor(
  subject: ElDef,
  path: ElDef[],
  snapshots: Map<ElDef, ElementSnapshot>
): ClassAttributeContext {
  const snapshot = snapshots.get(subject)!;
  return {
    partial: '',
    range: EMPTY_RANGE,
    value: '',
    valueRange: EMPTY_RANGE,
    subjectTag: snapshot.tag,
    subjectId: snapshot.id,
    path: path.map((def) => snapshots.get(def)!),
    subjectParentChildren: snapshot.parentChildren,
    subjectIndexInParent: snapshot.indexInParent,
    siblingDataAvailable: true,
  };
}

function rule(selector: string, className = 'text'): ClassRule {
  const { rules } = parseCss(`${selector} { }`, 'file:///t.css', { origin: 'global' });
  const found = rules.find((candidate) => candidate.className === className);
  if (!found) throw new Error(`no rule for ${selector} / ${className}`);
  return found;
}

function context(defs: ElDef[], subject: ElDef, path: ElDef[]): ClassAttributeContext {
  return ctxFor(subject, path, build(defs));
}

describe('matcher — acceptance matrix (§7.4)', () => {
  it('div .text inside div', () => {
    const div: ElDef = { tag: 'div', children: [{ tag: 'p' }] };
    const p = div.children![0]!;
    expect(matches(rule('div .text'), context([div], p, [div]))).toBe(true);
  });

  it('div .text outside div', () => {
    const section: ElDef = { tag: 'section', children: [{ tag: 'p' }] };
    const p = section.children![0]!;
    expect(matches(rule('div .text'), context([section], p, [section]))).toBe(false);
  });

  it('div .text through intermediate elements', () => {
    const div: ElDef = { tag: 'div', children: [{ tag: 'span', children: [{ tag: 'p' }] }] };
    const span = div.children![0]!;
    const p = span.children![0]!;
    expect(matches(rule('div .text'), context([div], p, [span, div]))).toBe(true);
  });

  it('div > .text rejects deeper descendants', () => {
    const div: ElDef = { tag: 'div', children: [{ tag: 'span', children: [{ tag: 'p' }] }] };
    const span = div.children![0]!;
    const p = span.children![0]!;
    expect(matches(rule('div > .text'), context([div], p, [span, div]))).toBe(false);
  });

  it('div > .text accepts direct children', () => {
    const div: ElDef = { tag: 'div', children: [{ tag: 'p' }] };
    const p = div.children![0]!;
    expect(matches(rule('div > .text'), context([div], p, [div]))).toBe(true);
  });

  it('.a.b .text requires all ancestor classes', () => {
    const p: ElDef = { tag: 'p', classes: ['a', 'b'], children: [{ tag: 'span' }] };
    const span = p.children![0]!;
    expect(matches(rule('.a.b .text'), context([p], span, [p]))).toBe(true);
    const onlyA: ElDef = { tag: 'p', classes: ['a'], children: [{ tag: 'span' }] };
    const span2 = onlyA.children![0]!;
    expect(matches(rule('.a.b .text'), context([onlyA], span2, [onlyA]))).toBe(false);
  });

  it('div + .text requires the immediately preceding sibling', () => {
    const div: ElDef = { tag: 'div' };
    const p: ElDef = { tag: 'p' };
    expect(matches(rule('div + .text'), context([div, p], p, []))).toBe(true);
    const span: ElDef = { tag: 'span' };
    expect(matches(rule('div + .text'), context([div, span, p], p, []))).toBe(false);
  });

  it('div ~ .text scans all preceding siblings', () => {
    const div: ElDef = { tag: 'div' };
    const p: ElDef = { tag: 'p' };
    expect(matches(rule('div ~ .text'), context([div, { tag: 'span' }, p], p, []))).toBe(true);
  });

  it('ul li .text matches nested list paths', () => {
    const ul: ElDef = { tag: 'ul', children: [{ tag: 'li', children: [{ tag: 'p' }] }] };
    const li = ul.children![0]!;
    const p = li.children![0]!;
    expect(matches(rule('ul li .text'), context([ul], p, [li, ul]))).toBe(true);
  });

  it('ul li .text rejects a missing li', () => {
    const ul: ElDef = { tag: 'ul', children: [{ tag: 'p' }] };
    const p = ul.children![0]!;
    expect(matches(rule('ul li .text'), context([ul], p, [ul]))).toBe(false);
  });

  it('.text matches anywhere', () => {
    const p: ElDef = { tag: 'p' };
    expect(matches(rule('.text'), context([p], p, []))).toBe(true);
  });

  it('union selectors match if any rule matches', () => {
    const { rules } = parseCss('div .text, section .text { }', 'file:///t.css', {
      origin: 'global',
    });
    const section: ElDef = { tag: 'section', children: [{ tag: 'p' }] };
    const p = section.children![0]!;
    const ctx = context([section], p, [section]);
    expect(rules.some((candidate) => matches(candidate, ctx))).toBe(true);
  });

  it('subject tag constraints apply', () => {
    const div: ElDef = { tag: 'div' };
    const span: ElDef = { tag: 'span' };
    expect(matches(rule('div.text'), context([div], div, []))).toBe(true);
    expect(matches(rule('div.text'), context([span], span, []))).toBe(false);
  });

  it('#main .text requires a matching static id', () => {
    const main: ElDef = { tag: 'main', id: 'main', children: [{ tag: 'p' }] };
    const p = main.children![0]!;
    expect(matches(rule('#main .text'), context([main], p, [main]))).toBe(true);
    const other: ElDef = { tag: 'main', id: 'other', children: [{ tag: 'p' }] };
    const p2 = other.children![0]!;
    expect(matches(rule('#main .text'), context([other], p2, [other]))).toBe(false);
    const missing: ElDef = { tag: 'main', children: [{ tag: 'p' }] };
    const p3 = missing.children![0]!;
    expect(matches(rule('#main .text'), context([missing], p3, [missing]))).toBe(false);
  });

  it('dynamic subject ids are wildcards', () => {
    const p: ElDef = { tag: 'p' };
    const ctx = context([p], p, []);
    const dynamicCtx: ClassAttributeContext = { ...ctx, subjectId: undefined };
    expect(matches(rule('#x.y', 'y'), dynamicCtx)).toBe(true);
    expect(matches(rule('#x.y', 'y'), { ...ctx, subjectId: 'z' })).toBe(false);
  });

  it('ignores pseudos and attributes', () => {
    const p: ElDef = { tag: 'p', classes: ['a'] };
    const span: ElDef = { tag: 'span' };
    p.children = [span];
    expect(matches(rule('.a:hover .text'), context([p], span, [p]))).toBe(true);
    const plain: ElDef = { tag: 'p' };
    const inner: ElDef = { tag: 'span' };
    plain.children = [inner];
    expect(matches(rule('[data-x] .text'), context([plain], inner, [plain]))).toBe(true);
  });

  it('enforces :not() on ancestors', () => {
    const ab: ElDef = { tag: 'p', classes: ['a', 'b'], children: [{ tag: 'span' }] };
    const abSpan = ab.children![0]!;
    expect(matches(rule('.a:not(.b) .text'), context([ab], abSpan, [ab]))).toBe(false);
    const onlyA: ElDef = { tag: 'p', classes: ['a'], children: [{ tag: 'span' }] };
    const aSpan = onlyA.children![0]!;
    expect(matches(rule('.a:not(.b) .text'), context([onlyA], aSpan, [onlyA]))).toBe(true);
    const excluded: ElDef = { tag: 'p', classes: ['a'], children: [{ tag: 'span' }] };
    const excludedSpan = excluded.children![0]!;
    expect(matches(rule(':not(.a) .text'), context([excluded], excludedSpan, [excluded]))).toBe(
      false
    );
  });

  it('handles a long mixed chain', () => {
    const main: ElDef = {
      tag: 'main',
      children: [
        {
          tag: 'section',
          classes: ['a'],
          children: [
            { tag: 'b', classes: ['b'] },
            { tag: 'i', classes: ['c'], children: [{ tag: 'p' }] },
          ],
        },
      ],
    };
    const section = main.children![0]!;
    const i = section.children![1]!;
    const p = i.children![0]!;
    expect(matches(rule('main .a > .b + .c .text'), context([main], p, [i, section, main]))).toBe(
      true
    );
  });

  it('keeps pathIdx valid across sibling matches', () => {
    const x: ElDef = {
      tag: 'div',
      classes: ['x'],
      children: [
        { tag: 'b', classes: ['b'] },
        { tag: 'i', classes: ['c'], children: [{ tag: 'p' }] },
      ],
    };
    const c = x.children![1]!;
    const p = c.children![0]!;
    expect(matches(rule('.x > .b + .c > .text'), context([x], p, [c, x]))).toBe(true);
  });

  it('universal ancestors match any element', () => {
    const p: ElDef = { tag: 'p' };
    const span: ElDef = { tag: 'span' };
    p.children = [span];
    expect(matches(rule('* .text'), context([p], span, [p]))).toBe(true);
  });

  it('requires a full document for html body selectors', () => {
    const html: ElDef = {
      tag: 'html',
      children: [{ tag: 'body', children: [{ tag: 'p' }] }],
    };
    const body = html.children![0]!;
    const p = body.children![0]!;
    expect(matches(rule('html body .text'), context([html], p, [body, html]))).toBe(true);
  });

  it('never matches sibling combinators without sibling data', () => {
    const p: ElDef = { tag: 'p' };
    const ctx = context([p], p, []);
    const jsxCtx: ClassAttributeContext = {
      ...ctx,
      subjectParentChildren: [],
      subjectIndexInParent: 0,
      siblingDataAvailable: false,
    };
    expect(matches(rule('div + .text'), jsxCtx)).toBe(false);
    expect(matches(rule('div ~ .text'), jsxCtx)).toBe(false);
  });
});

describe('matcher — nested selectors end to end', () => {
  function htmlContext(html: string): ClassAttributeContext {
    const offset = html.indexOf('|');
    const text = html.slice(0, offset) + html.slice(offset + 1);
    const ctx = analyzeHtmlDocument(text, 'html').contextAt(offset);
    if (!ctx) throw new Error('no class context');
    return ctx;
  }

  function deepRule(className: string): ClassRule {
    const { rules } = parseCss('.layout { .sidebar { .nav { .nav-link { } } } }', 'file:///deep.css', {
      origin: 'global',
    });
    return rules.find((candidate) => candidate.className === className)!;
  }

  it('matches when every nesting layer is present', () => {
    const ctx = htmlContext(
      '<div class="layout"><aside class="sidebar"><nav class="nav"><a class="|"></a></nav></aside></div>'
    );
    expect(matches(deepRule('nav-link'), ctx)).toBe(true);
  });

  it('fails when a middle nesting layer is missing', () => {
    const ctx = htmlContext('<div class="layout"><nav class="nav"><a class="|"></a></nav></div>');
    expect(matches(deepRule('nav-link'), ctx)).toBe(false);
  });

  it('fails when the outermost nesting layer is missing', () => {
    const ctx = htmlContext(
      '<aside class="sidebar"><nav class="nav"><a class="|"></a></nav></aside>'
    );
    expect(matches(deepRule('nav-link'), ctx)).toBe(false);
  });

  it('matches deep & chains only when the compound ancestor matches', () => {
    const { rules } = parseCss('.card { &.active { .title { } } }', 'file:///deep.css', {
      origin: 'global',
    });
    const title = rules.find((candidate) => candidate.className === 'title')!;
    expect(
      matches(title, htmlContext('<div class="card active"><h2 class="|"></h2></div>'))
    ).toBe(true);
    expect(matches(title, htmlContext('<div class="card"><h2 class="|"></h2></div>'))).toBe(false);
  });
});

describe('matcher — structural pseudo-classes', () => {
  function listContext(liIndex: number, tags: string[] = ['li', 'li', 'li']): ClassAttributeContext {
    const items: ElDef[] = tags.map((tag) => ({ tag, classes: ['item'] }));
    const ul: ElDef = { tag: 'ul', children: items };
    const p: ElDef = { tag: 'p' };
    items[liIndex]!.children = [p];
    return ctxFor(p, [items[liIndex]!, ul], build([ul]));
  }

  it('evaluates :first-child, :last-child, and :only-child on ancestors', () => {
    expect(matches(rule('li:first-child .text'), listContext(0))).toBe(true);
    expect(matches(rule('li:first-child .text'), listContext(1))).toBe(false);
    expect(matches(rule('li:last-child .text'), listContext(2))).toBe(true);
    expect(matches(rule('li:last-child .text'), listContext(1))).toBe(false);
    expect(matches(rule('li:only-child .text'), listContext(0, ['li']))).toBe(true);
    expect(matches(rule('li:only-child .text'), listContext(0))).toBe(false);
  });

  it('evaluates An+B arguments', () => {
    expect(matches(rule('li:nth-child(2) .text'), listContext(1))).toBe(true);
    expect(matches(rule('li:nth-child(2) .text'), listContext(0))).toBe(false);
    expect(matches(rule('li:nth-child(odd) .text'), listContext(0))).toBe(true);
    expect(matches(rule('li:nth-child(2n + 1) .text'), listContext(2))).toBe(true);
    expect(matches(rule('li:nth-child(2n + 1) .text'), listContext(1))).toBe(false);
    expect(matches(rule('li:nth-last-child(1) .text'), listContext(2))).toBe(true);
    expect(matches(rule('li:nth-last-child(even) .text'), listContext(1))).toBe(true);
  });

  it('evaluates of-type variants', () => {
    const mixed = listContext(0, ['li', 'div', 'li']);
    expect(matches(rule('li:first-of-type .text'), mixed)).toBe(true);
    expect(matches(rule('div:first-of-type .text'), mixed)).toBe(false);
    const second = listContext(2, ['li', 'div', 'li']);
    expect(matches(rule('li:last-of-type .text'), second)).toBe(true);
    expect(matches(rule('li:nth-of-type(2) .text'), second)).toBe(true);
    expect(matches(rule('li:nth-of-type(2) .text'), mixed)).toBe(false);
    const only = listContext(0, ['li', 'div']);
    expect(matches(rule('li:only-of-type .text'), only)).toBe(true);
  });

  it('evaluates :heading on ancestors', () => {
    const heading: ElDef = { tag: 'h2', children: [{ tag: 'p' }] };
    const p = heading.children![0]!;
    expect(matches(rule(':heading .text'), context([heading], p, [heading]))).toBe(true);
    expect(matches(rule(':heading .text'), listContext(0))).toBe(false);
  });

  it('evaluates structural pseudo-classes on the subject', () => {
    const first: ElDef = { tag: 'p' };
    const second: ElDef = { tag: 'p' };
    const snapshots = build([first, second]);
    const firstCtx = ctxFor(first, [], snapshots);
    const secondCtx = ctxFor(second, [], snapshots);
    expect(matches(rule('.text:first-child'), firstCtx)).toBe(true);
    expect(matches(rule('.text:first-child'), secondCtx)).toBe(false);
    expect(matches(rule('.text:nth-child(2)'), secondCtx)).toBe(true);
    expect(matches(rule('.text:last-child'), secondCtx)).toBe(true);
  });

  it('fails structural pseudo-classes without sibling data (JSX)', () => {
    const p: ElDef = { tag: 'p' };
    const ctx = context([p], p, []);
    const jsxCtx: ClassAttributeContext = {
      ...ctx,
      subjectParentChildren: [],
      subjectIndexInParent: 0,
      siblingDataAvailable: false,
    };
    expect(matches(rule('.text:first-child'), jsxCtx)).toBe(false);
    expect(matches(rule('.text:only-child'), jsxCtx)).toBe(false);
  });

  it('enforces :not() on the subject against existing tokens', () => {
    const p: ElDef = { tag: 'p' };
    const ctx = context([p], p, []);
    expect(matches(rule('.text:not(.used)'), { ...ctx, value: 'used' })).toBe(false);
    expect(matches(rule('.text:not(.used)'), { ...ctx, value: 'other' })).toBe(true);
  });
});

describe('matcher — pseudo-classes end to end', () => {
  function htmlContext(html: string): ClassAttributeContext {
    const offset = html.indexOf('|');
    const text = html.slice(0, offset) + html.slice(offset + 1);
    const ctx = analyzeHtmlDocument(text, 'html').contextAt(offset);
    if (!ctx) throw new Error('no class context');
    return ctx;
  }

  it('matches :is() alternatives', () => {
    const { rules } = parseCss(':is(.a, .b) .text { }', 'file:///t.css', { origin: 'global' });
    expect(rules.some((candidate) => matches(candidate, htmlContext('<div class="b"><p class="|"></p></div>')))).toBe(true);
    expect(rules.some((candidate) => matches(candidate, htmlContext('<div class="c"><p class="|"></p></div>')))).toBe(false);
  });

  it('enforces :not() against scanned ancestors', () => {
    const rule0 = parseCss('.a:not(.b) .text { }', 'file:///t.css', { origin: 'global' }).rules[0]!;
    expect(matches(rule0, htmlContext('<div class="a"><p class="|"></p></div>'))).toBe(true);
    expect(matches(rule0, htmlContext('<div class="a b"><p class="|"></p></div>'))).toBe(false);
  });

  it('evaluates structural pseudo-classes against scanned siblings', () => {
    const rule0 = parseCss('li:nth-child(2) .text { }', 'file:///t.css', { origin: 'global' }).rules[0]!;
    expect(
      matches(rule0, htmlContext('<ul><li></li><li><p class="|"></p></li></ul>'))
    ).toBe(true);
    expect(
      matches(rule0, htmlContext('<ul><li><p class="|"></p></li><li></li></ul>'))
    ).toBe(false);
  });
});
