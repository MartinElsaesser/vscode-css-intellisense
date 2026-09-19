import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { configSchema, parseConfig } from '../../src/configModel';

function reader(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('config schema', () => {
  it('supplies every default when settings are absent', () => {
    expect(parseConfig(reader({}))).toEqual({
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

  it('keeps valid overrides', () => {
    const config = parseConfig(
      reader({ enabled: false, strictHierarchy: false, trace: 'verbose', maxImportDepth: 3 })
    );
    expect(config.enabled).toBe(false);
    expect(config.strictHierarchy).toBe(false);
    expect(config.trace).toBe('verbose');
    expect(config.maxImportDepth).toBe(3);
    expect(config.cssGlobs).toEqual(['**/*.css']);
  });

  it('falls back per field for malformed hand-edited values', () => {
    const config = parseConfig(
      reader({
        enabled: 42,
        cssGlobs: 'not-an-array',
        languages: ['html', 42],
        maxImportDepth: -1,
        maxFileSizeKB: 0,
        trace: 'loud',
      })
    );
    expect(config.enabled).toBe(true);
    expect(config.cssGlobs).toEqual(['**/*.css']);
    expect(config.languages).toEqual([
      'html',
      'vue',
      'svelte',
      'javascriptreact',
      'typescriptreact',
    ]);
    expect(config.maxImportDepth).toBe(10);
    expect(config.maxFileSizeKB).toBe(10240);
    expect(config.trace).toBe('off');
  });
});

describe('package.json drift guard', () => {
  const packageSchema = z.object({
    contributes: z.object({
      configuration: z.object({
        properties: z.record(z.string(), z.object({ default: z.unknown() })),
      }),
    }),
  });

  it('contributes exactly the schema fields with the schema defaults', () => {
    const packageJson = packageSchema.parse(
      JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    );
    const properties = packageJson.contributes.configuration.properties;
    const defaults = configSchema.parse({});
    const expectedKeys = Object.keys(defaults)
      .map((field) => `cssIntellisense.${field}`)
      .sort();
    expect(Object.keys(properties).sort()).toEqual(expectedKeys);
    for (const [field, value] of Object.entries(defaults)) {
      expect(properties[`cssIntellisense.${field}`]!.default).toEqual(value);
    }
  });
});
