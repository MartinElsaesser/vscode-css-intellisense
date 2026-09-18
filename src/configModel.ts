export type TraceLevel = 'off' | 'messages' | 'verbose';

export interface CssIntellisenseConfig {
  enabled: boolean;
  cssGlobs: string[];
  excludeGlobs: string[];
  includeInlineStyles: boolean;
  languages: string[];
  strictHierarchy: boolean;
  resolveImports: boolean;
  maxImportDepth: number;
  maxFileSizeKB: number;
  triggerSuggestAfterQuote: boolean;
  hideAlreadyUsedClasses: boolean;
  trace: TraceLevel;
}

export interface ConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
}

export const DEFAULTS: CssIntellisenseConfig = {
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
};

export function fromRaw(raw: ConfigurationReader): CssIntellisenseConfig {
  return {
    enabled: raw.get('enabled', DEFAULTS.enabled),
    cssGlobs: raw.get('cssGlobs', DEFAULTS.cssGlobs),
    excludeGlobs: raw.get('excludeGlobs', DEFAULTS.excludeGlobs),
    includeInlineStyles: raw.get('includeInlineStyles', DEFAULTS.includeInlineStyles),
    languages: raw.get('languages', DEFAULTS.languages),
    strictHierarchy: raw.get('strictHierarchy', DEFAULTS.strictHierarchy),
    resolveImports: raw.get('resolveImports', DEFAULTS.resolveImports),
    maxImportDepth: raw.get('maxImportDepth', DEFAULTS.maxImportDepth),
    maxFileSizeKB: raw.get('maxFileSizeKB', DEFAULTS.maxFileSizeKB),
    triggerSuggestAfterQuote: raw.get('triggerSuggestAfterQuote', DEFAULTS.triggerSuggestAfterQuote),
    hideAlreadyUsedClasses: raw.get('hideAlreadyUsedClasses', DEFAULTS.hideAlreadyUsedClasses),
    trace: raw.get('trace', DEFAULTS.trace),
  };
}
