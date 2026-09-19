import { describe, expect, it } from 'vitest';
import {
  analyzeHtmlDocument,
  ClassAttributeContext,
  HtmlLanguage,
} from '../../src/html/analyzeHtml';

const CURSOR = '|';

function context(html: string, language: HtmlLanguage = 'html'): ClassAttributeContext | undefined {
  const offset = html.indexOf(CURSOR);
  const text = html.slice(0, offset) + html.slice(offset + 1);
  return analyzeHtmlDocument(text, language, 7).contextAt(offset);
}

describe('analyzeHtml — cursor context', () => {
  it('handles double-quoted values', () => {
    const ctx = context('<div class="te|xt">')!;
    expect(ctx.partial).toBe('text');
    expect(ctx.value).toBe('text');
    expect(ctx.valueRange.start).toEqual({ line: 0, character: 12 });
    expect(ctx.valueRange.end).toEqual({ line: 0, character: 16 });
    expect(ctx.range.start).toEqual({ line: 0, character: 12 });
    expect(ctx.range.end).toEqual({ line: 0, character: 16 });
  });

  it('handles single-quoted values', () => {
    const ctx = context("<div class='te|xt'>")!;
    expect(ctx.partial).toBe('text');
  });

  it('handles unquoted values', () => {
    const ctx = context('<div class=te|xt>')!;
    expect(ctx.partial).toBe('text');
    expect(ctx.value).toBe('text');
  });

  it('finds the token mid-list', () => {
    const ctx = context('<div class="a te|xt b">')!;
    expect(ctx.partial).toBe('text');
    expect(ctx.range.start.character).toBe(14);
    expect(ctx.range.end.character).toBe(18);
    expect(ctx.value).toBe('a text b');
  });

  it('returns an empty partial between tokens', () => {
    const ctx = context('<div class="a | b">')!;
    expect(ctx.partial).toBe('');
    expect(ctx.range.start).toEqual(ctx.range.end);
  });

  it('takes the token when the cursor sits at its start', () => {
    const ctx = context('<div class="a |b">')!;
    expect(ctx.partial).toBe('b');
  });

  it('handles unterminated quoted values', () => {
    const ctx = context('<div class="te|xt')!;
    expect(ctx.partial).toBe('text');
  });

  it('returns undefined outside class attributes', () => {
    expect(context('<div cla|ss="x">')).toBeUndefined();
    expect(context('<div class="x">|')).toBeUndefined();
    expect(context('<div :class="|te">')).toBeUndefined();
    expect(context('<p>|</p>')).toBeUndefined();
  });

  it('is case-insensitive for tag and attribute names', () => {
    const ctx = context('<DIV CLASS="|te">')!;
    expect(ctx.subjectTag).toBe('div');
    expect(ctx.value).toBe('te');
  });
});

describe('analyzeHtml — hierarchy', () => {
  it('builds the parent path', () => {
    const ctx = context('<div><section><p class="|te"></p></section></div>')!;
    expect(ctx.path.map((element) => element.tag)).toEqual(['section', 'div']);
    expect(ctx.subjectTag).toBe('p');
  });

  it('exposes preceding siblings and index', () => {
    const ctx = context('<div></div><span></span><p class="|x">')!;
    expect(ctx.subjectIndexInParent).toBe(2);
    expect(
      ctx.subjectParentChildren.slice(0, ctx.subjectIndexInParent).map((element) => element.tag)
    ).toEqual(['div', 'span']);
    expect(ctx.subjectParentChildren.map((element) => element.tag)).toEqual(['div', 'span', 'p']);
  });

  it('tracks classes on ancestors', () => {
    const ctx = context('<div class="a b"><p class="|x">')!;
    expect([...ctx.path[0]!.classes].sort()).toEqual(['a', 'b']);
  });

  it('exposes static subject id regardless of attribute order', () => {
    expect(context('<p class="|x" id="main">')!.subjectId).toBe('main');
    expect(context('<p id="main" class="|x">')!.subjectId).toBe('main');
  });

  it('treats dynamic ids as absent', () => {
    expect(context('<p :id="main" class="|x">')!.subjectId).toBeUndefined();
    expect(context('<p v-bind:id="main" class="|x">')!.subjectId).toBeUndefined();
    expect(context('<p id="{main}" class="|x">')!.subjectId).toBeUndefined();
  });

  it('handles comments and doctypes', () => {
    const ctx = context('<!doctype html><!-- <div class="x"> --><p class="|te">')!;
    expect(ctx.path).toHaveLength(0);
  });

  it('ignores markup inside script and textarea', () => {
    const ctx = context('<script>const x = "<div class=\'a\'>";</script><p class="|te">')!;
    expect(ctx.path).toHaveLength(0);
    const textarea = context('<textarea><div></textarea><p class="|te">')!;
    expect(textarea.path).toHaveLength(0);
  });

  it('captures style blocks with offsets', () => {
    const html = '<style>.a { color: red }</style><p class="x">';
    const analysis = analyzeHtmlDocument(html, 'html');
    expect(analysis.styleBlocks).toHaveLength(1);
    const block = analysis.styleBlocks[0]!;
    expect(html.slice(block.startOffset, block.endOffset)).toBe('.a { color: red }');
  });

  it('applies implied end tags for li', () => {
    const ctx = context('<ul><li class="a"><li class="|b">')!;
    expect(ctx.path.map((element) => element.tag)).toEqual(['ul']);
    expect(ctx.subjectIndexInParent).toBe(1);
  });

  it('applies implied end tags for p and td', () => {
    expect(context('<p><div class="|te">')!.path).toHaveLength(0);
    const table = context('<table><tr><td class="a"><td class="|b">')!;
    expect(table.path.map((element) => element.tag)).toEqual(['tr', 'table']);
  });

  it('does not synthesize html or body', () => {
    expect(context('<p class="|te">')!.path).toHaveLength(0);
    const full = context('<html><body><p class="|te"></p></body></html>')!;
    expect(full.path.map((element) => element.tag)).toEqual(['body', 'html']);
  });

  it('handles SVG class attributes', () => {
    const ctx = context('<svg><circle class="|te"></circle></svg>')!;
    expect(ctx.subjectTag).toBe('circle');
    expect(ctx.path.map((element) => element.tag)).toEqual(['svg']);
  });
});

describe('analyzeHtml — self-closing and foreign elements', () => {
  it('ignores /> for non-void elements in html mode', () => {
    const ctx = context('<div/><p class="|te">')!;
    expect(ctx.path.map((element) => element.tag)).toEqual(['div']);
  });

  it('honors /> in vue and svelte modes', () => {
    expect(context('<div/><p class="|te">', 'vue')!.path).toHaveLength(0);
    expect(context('<div/><p class="|te">', 'svelte')!.path).toHaveLength(0);
  });

  it('honors /> for foreign elements in html mode', () => {
    const siblings = context('<svg><path/><circle class="|x"></circle></svg>')!;
    expect(siblings.path.map((element) => element.tag)).toEqual(['svg']);
    const after = context('<svg><path/></svg><p class="|te">')!;
    expect(after.path).toHaveLength(0);
  });
});

describe('analyzeHtml — Vue and Svelte specifics', () => {
  it('scans Vue templates and ignores :class', () => {
    const vue = context('<template><div><p class="|te"></p></div></template>', 'vue')!;
    expect(vue.path.map((element) => element.tag)).toEqual(['div', 'template']);
    expect(context('<div :class="{ active: x }">|</div>', 'vue')).toBeUndefined();
  });

  it('captures scoped Vue style blocks', () => {
    const html = '<template><p class="x"></p></template><style scoped>.a { }</style>';
    const analysis = analyzeHtmlDocument(html, 'vue');
    expect(analysis.styleBlocks).toHaveLength(1);
    const block = analysis.styleBlocks[0]!;
    expect(html.slice(block.startOffset, block.endOffset)).toBe('.a { }');
  });

  it('ignores Svelte block syntax for nesting', () => {
    const ctx = context('<div>{#if x}<p class="|te">{/if}</div>', 'svelte')!;
    expect(ctx.path.map((element) => element.tag)).toEqual(['div']);
  });

  it('skips the cursor inside Svelte expressions', () => {
    expect(context('<div class="a {|b} c">', 'svelte')).toBeUndefined();
    const outside = context('<div class="a |b c">', 'svelte')!;
    expect(outside.partial).toBe('b');
  });

  it('does not add Svelte class directives to the class set', () => {
    const ctx = context('<div class:active><p class="|te">', 'svelte')!;
    expect(ctx.path[0]!.classes.has('active')).toBe(false);
  });
});

describe('analyzeHtml — version and cacheability', () => {
  it('carries the version and can be queried repeatedly', () => {
    const analysis = analyzeHtmlDocument('<div class="x"><p class="y">', 'html', 42);
    expect(analysis.version).toBe(42);
    expect(analysis.contextAt(13)).toBeDefined();
    expect(analysis.contextAt(13)).toBeDefined();
  });
});
