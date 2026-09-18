import { describe, expect, it } from 'vitest';
import { DEFAULTS, fromRaw } from '../../src/configModel';

describe('config defaults', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULTS).toEqual({
      enabled: true,
      cssGlobs: ['**/*.css'],
      excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/out/**', '**/.git/**'],
      includeInlineStyles: true,
      languages: ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'],
      strictHierarchy: true,
      resolveImports: true,
      maxImportDepth: 10,
      maxFileSizeKB: 10240,
      triggerSuggestAfterQuote: true,
      hideAlreadyUsedClasses: true,
      trace: 'off',
    });
  });

  it('falls back to defaults when unset', () => {
    const raw = { get: <T,>(_section: string, defaultValue: T): T => defaultValue };
    expect(fromRaw(raw)).toEqual(DEFAULTS);
  });

  it('reads configured overrides', () => {
    const values: Record<string, unknown> = {
      enabled: false,
      strictHierarchy: false,
      trace: 'verbose',
      maxImportDepth: 3,
    };
    const raw = {
      get: <T,>(section: string, defaultValue: T): T =>
        section in values ? (values[section] as T) : defaultValue,
    };
    const cfg = fromRaw(raw);
    expect(cfg.enabled).toBe(false);
    expect(cfg.strictHierarchy).toBe(false);
    expect(cfg.trace).toBe('verbose');
    expect(cfg.maxImportDepth).toBe(3);
    expect(cfg.cssGlobs).toEqual(DEFAULTS.cssGlobs);
  });
});
