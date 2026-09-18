import { describe, expect, it } from 'vitest';
import { parseCss } from '../../src/css/parseCss';
import { ClassAttributeContext } from '../../src/html/analyzeHtml';
import { analyzeJsxDocument } from '../../src/html/jsxContext';
import { matches } from '../../src/match/matcher';

const CURSOR = '|';

function context(source: string, fileName = 'component.tsx'): ClassAttributeContext | undefined {
  const offset = source.indexOf(CURSOR);
  const text = source.slice(0, offset) + source.slice(offset + 1);
  return analyzeJsxDocument(text, fileName, 7).contextAt(offset);
}

function rule(selector: string, className = 'text') {
  const { rules } = parseCss(`${selector} { }`, 'file:///t.css', { origin: 'global' });
  return rules.find((candidate) => candidate.className === className)!;
}

describe('analyzeJsxDocument', () => {
  it('reads a string literal className', () => {
    const ctx = context('const x = <div className="a |b"></div>;')!;
    expect(ctx.partial).toBe('b');
    expect(ctx.value).toBe('a b');
    expect(ctx.subjectTag).toBe('div');
    expect(ctx.path).toEqual([]);
  });

  it('reads a single-string expression container', () => {
    const ctx = context('const x = <div className={"a |b"}></div>;')!;
    expect(ctx.partial).toBe('b');
    expect(ctx.value).toBe('a b');
  });

  it('ignores dynamic class names', () => {
    expect(context('const x = <div className={value}></div>;')).toBeUndefined();
    expect(context('const x = <div className={`a ${b}`}></div>;')).toBeUndefined();
  });

  it('ignores other attributes and positions outside the literal', () => {
    expect(context('const x = <div class="|x"></div>;')).toBeUndefined();
    expect(context('const x = <div id="|x"></div>;')).toBeUndefined();
    expect(context('const x = <div className="a">|</div>;')).toBeUndefined();
  });

  it('builds ancestor snapshots without sibling data', () => {
    const ctx = context(
      'const x = <section id="main" className="a b"><p className="|x"></p></section>;'
    )!;
    expect(ctx.path).toHaveLength(1);
    const section = ctx.path[0]!;
    expect(section.tag).toBe('section');
    expect(section.id).toBe('main');
    expect([...section.classes].sort()).toEqual(['a', 'b']);
    expect(ctx.subjectParentChildren).toEqual([]);
    expect(ctx.subjectIndexInParent).toBe(0);
  });

  it('stops at component boundaries', () => {
    const ctx = context('const x = <Wrapper><div className="|x"></div></Wrapper>;')!;
    expect(ctx.path).toEqual([]);
  });

  it('handles self-closing subjects and ancestors', () => {
    const ctx = context('const x = <div><input className="|x" /></div>;')!;
    expect(ctx.subjectTag).toBe('input');
    expect(ctx.path.map((element) => element.tag)).toEqual(['div']);
  });

  it('keeps capitalized subject tags', () => {
    const ctx = context('const x = <Foo className="|x" />;')!;
    expect(ctx.subjectTag).toBe('Foo');
  });

  it('still matches ancestor hierarchy', () => {
    const ctx = context('const x = <div><p className="|x"></p></div>;')!;
    expect(matches(rule('div .text'), ctx)).toBe(true);
    const component = context('const x = <Wrapper><p className="|x"></p></Wrapper>;')!;
    expect(matches(rule('section .text'), component)).toBe(false);
  });

  it('never matches sibling combinators', () => {
    const ctx = context(
      'const x = <div><div></div><p className="|x"></p></div>;'
    )!;
    expect(matches(rule('div + .text'), ctx)).toBe(false);
    expect(matches(rule('div ~ .text'), ctx)).toBe(false);
  });

  it('carries the requested version', () => {
    const analysis = analyzeJsxDocument('const x = 1;', 'a.tsx', 11);
    expect(analysis.version).toBe(11);
    expect(analysis.styleBlocks).toEqual([]);
  });
});
