import { describe, expect, it } from 'vitest';
import { parseCss, ParseFailure } from '../../src/css/parseCss';
import { ClassRule } from '../../src/css/selectorModel';

const URI = 'file:///w/style.css';

function parse(css: string, opts: { origin?: 'global' | 'inline'; documentUri?: string } = {}) {
  return parseCss(css, URI, {
    origin: opts.origin ?? 'global',
    ...(opts.documentUri !== undefined ? { documentUri: opts.documentUri } : {}),
  });
}

function rulesFor(css: string, className: string): ClassRule[] {
  return parse(css).rules.filter((rule) => rule.className === className);
}

describe('parseCss — selector compilation', () => {
  it('compiles a bare class', () => {
    const { rules } = parse('.text { color: red }');
    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    expect(rule.className).toBe('text');
    expect(rule.subject).toEqual({
      tag: undefined,
      id: undefined,
      classes: ['text'],
    });
    expect(rule.ancestors).toEqual([]);
    expect(rule.selectorText).toBe('.text');
    expect(rule.origin).toBe('global');
    expect(rule.range.start).toEqual({ line: 0, character: 0 });
  });

  it('keeps subject tag and class separate', () => {
    const rule = rulesFor('div.text { }', 'text')[0]!;
    expect(rule.subject.tag).toBe('div');
    expect(rule.subject.classes).toEqual(['text']);
  });

  it('compiles comma lists into independent rules', () => {
    const { rules } = parse('.a { } .b { }');
    expect(rules.map((rule) => rule.className).sort()).toEqual(['a', 'b']);
    expect(rules.every((rule) => rule.ancestors.length === 0)).toBe(true);
  });

  it('skips selectors whose rightmost compound has no class', () => {
    expect(rulesFor('.a, .b p { }', 'a')).toHaveLength(1);
    expect(rulesFor('.a, .b p { }', 'b')).toHaveLength(0);
    expect(rulesFor('.a div { }', 'a')).toHaveLength(0);
    expect(rulesFor('div .a > p { }', 'a')).toHaveLength(0);
  });

  it('resolves rules nested in rules (native CSS nesting)', () => {
    const rule = rulesFor('.foo { .bar { } }', 'bar')[0]!;
    expect(rule.selectorText).toBe('.foo .bar');
    expect(rule.ancestors).toEqual([
      {
        compound: { tag: undefined, id: undefined, classes: ['foo'] },
        combinator: 'descendant',
      },
    ]);
  });

  it('compiles descendants with nearest-first ancestors', () => {
    const rule = rulesFor('ul li.card > .text { }', 'text')[0]!;
    expect(rule.subject).toEqual({
      tag: undefined,
      id: undefined,
      classes: ['text'],
    });
    expect(rule.ancestors).toHaveLength(2);
    expect(rule.ancestors[0]).toEqual({
      compound: { tag: 'li', id: undefined, classes: ['card'] },
      combinator: 'child',
    });
    expect(rule.ancestors[1]).toEqual({
      compound: { tag: 'ul', id: undefined, classes: [] },
      combinator: 'descendant',
    });
  });

  it('compiles union selectors into separate rules', () => {
    const rules = rulesFor('div .text, section .text { }', 'text');
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.ancestors[0]!.compound.tag).sort()).toEqual(['div', 'section']);
  });

  it('decodes escaped class names', () => {
    expect(rulesFor('.foo\\:bar { }', 'foo:bar')).toHaveLength(1);
  });

  it('turns attribute-only compounds into unconstrained compounds', () => {
    const rule = rulesFor('[data-x] .text { }', 'text')[0]!;
    expect(rule.ancestors[0]!.compound).toEqual({
      tag: undefined,
      id: undefined,
      classes: [],
    });
  });

  it('strips pseudo classes but keeps the rest of the compound', () => {
    const rule = rulesFor('.a:hover .text { }', 'text')[0]!;
    expect(rule.ancestors[0]!.compound).toEqual({
      tag: undefined,
      id: undefined,
      classes: ['a'],
    });
  });

  it('handles universal compounds in chains', () => {
    const rule = rulesFor('.a > * .text { }', 'text')[0]!;
    expect(rule.ancestors[0]!.compound).toEqual({
      tag: undefined,
      id: undefined,
      classes: [],
    });
    expect(rule.ancestors[0]!.combinator).toBe('descendant');
    expect(rule.ancestors[1]!.compound.classes).toEqual(['a']);
    expect(rule.ancestors[1]!.combinator).toBe('child');
  });

  it('keeps id constraints', () => {
    const rule = rulesFor('#main .text { }', 'text')[0]!;
    expect(rule.ancestors[0]!.compound.id).toBe('main');
  });

  it('processes rules inside @media', () => {
    const rule = rulesFor('@media (min-width: 40em) { div .text { } }', 'text')[0]!;
    expect(rule.ancestors[0]!.compound.tag).toBe('div');
  });

  it('ignores @keyframes content', () => {
    expect(parse('@keyframes x { from { opacity: 0 } }').rules).toHaveLength(0);
  });

  it('skips nesting selectors', () => {
    expect(parse('&:hover { }').rules).toHaveLength(0);
    expect(parse('& .text { }').rules).toHaveLength(0);
  });

  it('emits one rule per class of the subject compound', () => {
    const { rules } = parse('div .a.b { }');
    expect(rules.map((rule) => rule.className).sort()).toEqual(['a', 'b']);
    expect(rules[0]!.subject.classes).toEqual(['a', 'b']);
  });

  it('deduplicates identical selectors', () => {
    expect(parse('.x { } .x { }').rules).toHaveLength(1);
  });

  it('reports malformed selectors and keeps valid rules', () => {
    const errors: string[] = [];
    const { rules } = parseCss('.a..b { } .ok { }', URI, {
      origin: 'global',
      onError: (message) => errors.push(message),
    });
    expect(rules.map((rule) => rule.className)).toEqual(['ok']);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('throws ParseFailure on syntax errors', () => {
    expect(() => parse('.a {')).toThrow(ParseFailure);
  });
});

describe('parseCss — native CSS nesting', () => {
  it('resolves nested comma lists', () => {
    const base = rulesFor('.hero { .base, .framework, .vite { } }', 'base')[0]!;
    expect(base.selectorText).toBe('.hero .base');
    const vite = rulesFor('.hero { .base, .framework, .vite { } }', 'vite')[0]!;
    expect(vite.selectorText).toBe('.hero .vite');
  });

  it('substitutes & in compounds', () => {
    const active = rulesFor('.hero { &.active { } }', 'active')[0]!;
    expect(active.selectorText).toBe('.hero.active');
    expect(active.subject.classes).toEqual(['hero', 'active']);
    const hover = rulesFor('.hero { &:hover { } }', 'hero').find(
      (rule) => rule.selectorText === '.hero:hover'
    )!;
    expect(hover.ancestors).toEqual([]);
  });

  it('resolves relative selectors', () => {
    const rule = rulesFor('.hero { > .base { } }', 'base')[0]!;
    expect(rule.selectorText).toBe('.hero > .base');
    expect(rule.ancestors[0]!.combinator).toBe('child');
  });

  it('substitutes mid-selector &', () => {
    const rule = rulesFor('.hero { .dark & { } }', 'hero').find(
      (candidate) => candidate.selectorText === '.dark .hero'
    )!;
    expect(rule.ancestors[0]!.compound.classes).toEqual(['dark']);
  });

  it('resolves recursively', () => {
    const rule = rulesFor('.a { .b { .c { } } }', 'c')[0]!;
    expect(rule.selectorText).toBe('.a .b .c');
    expect(rule.ancestors.map((requirement) => requirement.compound.classes[0])).toEqual([
      'b',
      'a',
    ]);
  });

  it('cross-products parent selector lists', () => {
    const rules = rulesFor('.a, .b { .c { } }', 'c');
    expect(rules.map((rule) => rule.selectorText).sort()).toEqual(['.a .c', '.b .c']);
  });

  it('passes through nested at-rules at any depth', () => {
    const single = rulesFor('.a { @media (min-width: 40em) { .b { } } }', 'b')[0]!;
    expect(single.selectorText).toBe('.a .b');
    const deep = rulesFor(
      '.a { @media (min-width: 40em) { .b { @supports (display: grid) { .c { } } } } }',
      'c'
    )[0]!;
    expect(deep.selectorText).toBe('.a .b .c');
  });

  it('supports nested sibling relative selectors', () => {
    const relative = rulesFor('.hero { + .base { } }', 'base')[0]!;
    expect(relative.selectorText).toBe('.hero + .base');
    expect(relative.ancestors[0]!.combinator).toBe('adjacent');
    const explicit = rulesFor('.hero { & + .base { } }', 'base')[0]!;
    expect(explicit.selectorText).toBe('.hero + .base');
  });

  it('skips nesting preceded by sibling combinators', () => {
    expect(rulesFor('.a { .x + & { } }', 'a')).toHaveLength(1);
    expect(rulesFor('.a { & + & { } }', 'a')).toHaveLength(1);
  });

  it('propagates unresolvable parents to descendants', () => {
    expect(rulesFor('.a { & + & { .c { } } }', 'c')).toHaveLength(0);
  });

  it('caps cross-product growth', () => {
    const list = Array.from({ length: 20 }, (_, index) => `.p${index}`).join(', ');
    const css = `${list} { ${list} { .x { } } }`;
    expect(rulesFor(css, 'x')).toHaveLength(0);
  });
});

describe('parseCss — origin and imports', () => {
  it('marks inline rules with their document uri', () => {
    const { rules } = parse('.text { }', { origin: 'inline', documentUri: 'file:///w/page.html' });
    expect(rules[0]!.origin).toBe('inline');
    expect(rules[0]!.documentUri).toBe('file:///w/page.html');
  });

  it('extracts local imports without resolving them', () => {
    const { imports } = parse(
      '@import "./base.css"; @import url(theme.css); @import "https://x/y.css"; @import "a.css#frag";'
    );
    expect(imports.map((ref) => ref.specifier)).toEqual(['./base.css', 'theme.css']);
    expect(imports[0]!.fromUri).toBe(URI);
    expect(imports[0]!.range.start).toEqual({ line: 0, character: 0 });
  });

  it('uses the containing document as the import base for inline styles', () => {
    const { imports } = parseCss('@import "shared.css";', 'file:///w/page.html', {
      origin: 'inline',
      documentUri: 'file:///w/page.html',
    });
    expect(imports[0]!.specifier).toBe('shared.css');
    expect(imports[0]!.fromUri).toBe('file:///w/page.html');
  });

  it('records whole-rule ranges', () => {
    const { rules } = parse('.text {\n  color: red;\n}');
    expect(rules[0]!.range.start.line).toBe(0);
    expect(rules[0]!.range.end.line).toBe(2);
  });
});
