import { describe, expect, it } from 'vitest';
import {
  extractImportSpecifier,
  isPathWithin,
  resolveImportUri,
} from '../../src/css/importSpecifier';

describe('import specifiers', () => {
  it('accepts quoted, single-quoted, and url() forms', () => {
    expect(extractImportSpecifier('"./a.css"')).toBe('./a.css');
    expect(extractImportSpecifier("'./b.css'")).toBe('./b.css');
    expect(extractImportSpecifier('url(./c.css)')).toBe('./c.css');
    expect(extractImportSpecifier('url("./d.css") screen')).toBe('./d.css');
    expect(extractImportSpecifier('./e.css')).toBe('./e.css');
  });

  it('rejects remote and fragment specifiers', () => {
    expect(extractImportSpecifier('"https://x/y.css"')).toBeUndefined();
    expect(extractImportSpecifier('"//cdn/x.css"')).toBeUndefined();
    expect(extractImportSpecifier('url(data:text/css,x)')).toBeUndefined();
    expect(extractImportSpecifier('"a.css#frag"')).toBeUndefined();
    expect(extractImportSpecifier('')).toBeUndefined();
  });

  it('resolves relative to the importing file', () => {
    expect(resolveImportUri('file:///w/styles/main.css', './base.css')).toBe(
      'file:///w/styles/base.css'
    );
    expect(resolveImportUri('file:///w/styles/main.css', '../shared/x.css')).toBe(
      'file:///w/shared/x.css'
    );
    expect(resolveImportUri('file:///w/page.html', 'shared.css')).toBe('file:///w/shared.css');
  });
});

describe('isPathWithin', () => {
  it('accepts the root itself and descendants', () => {
    expect(isPathWithin('/w', '/w')).toBe(true);
    expect(isPathWithin('/w', '/w/a.css')).toBe(true);
    expect(isPathWithin('/w/', '/w/a/b.css')).toBe(true);
  });

  it('rejects escapes and sibling prefixes', () => {
    expect(isPathWithin('/w', '/other/a.css')).toBe(false);
    expect(isPathWithin('/w', '/w-other/a.css')).toBe(false);
    expect(isPathWithin('/w', '/')).toBe(false);
  });
});
