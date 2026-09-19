import { z } from 'zod';

export const configSchema = z.object({
  enabled: z.boolean().catch(true),
  cssGlobs: z.array(z.string().min(1)).catch(['**/*.css']),
  excludeGlobs: z
    .array(z.string().min(1))
    .catch(['**/node_modules/**', '**/dist/**', '**/build/**', '**/out/**', '**/.git/**']),
  includeInlineStyles: z.boolean().catch(true),
  languages: z
    .array(z.string().min(1))
    .catch(['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact']),
  strictHierarchy: z.boolean().catch(true),
  resolveImports: z.boolean().catch(true),
  maxImportDepth: z.number().int().nonnegative().catch(10),
  maxFileSizeKB: z.number().int().positive().catch(10240),
  triggerSuggestAfterQuote: z.boolean().catch(true),
  hideAlreadyUsedClasses: z.boolean().catch(true),
  trace: z.enum(['off', 'messages', 'verbose']).catch('off'),
});

export type CssIntellisenseConfig = z.infer<typeof configSchema>;
export type TraceLevel = CssIntellisenseConfig['trace'];

export interface ConfigurationReader {
  get(key: string): unknown;
}

export function parseConfig(raw: ConfigurationReader): CssIntellisenseConfig {
  return configSchema.parse({
    enabled: raw.get('enabled'),
    cssGlobs: raw.get('cssGlobs'),
    excludeGlobs: raw.get('excludeGlobs'),
    includeInlineStyles: raw.get('includeInlineStyles'),
    languages: raw.get('languages'),
    strictHierarchy: raw.get('strictHierarchy'),
    resolveImports: raw.get('resolveImports'),
    maxImportDepth: raw.get('maxImportDepth'),
    maxFileSizeKB: raw.get('maxFileSizeKB'),
    triggerSuggestAfterQuote: raw.get('triggerSuggestAfterQuote'),
    hideAlreadyUsedClasses: raw.get('hideAlreadyUsedClasses'),
    trace: raw.get('trace'),
  });
}
