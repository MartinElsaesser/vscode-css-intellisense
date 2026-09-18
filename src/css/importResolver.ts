const REMOTE_SPECIFIER = /^(?:[a-z]+:|\/\/|data:)/i;

export const IMPORT_SPECIFIER = /^\s*(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"()\s]+))\s*\)?/u;

export function extractImportSpecifier(params: string): string | undefined {
  const match = IMPORT_SPECIFIER.exec(params);
  if (!match) return undefined;
  const specifier = match[1] ?? match[2] ?? match[3];
  if (!specifier) return undefined;
  if (REMOTE_SPECIFIER.test(specifier)) return undefined;
  if (specifier.includes('#')) return undefined;
  return specifier;
}

export function resolveImportUri(fromUri: string, specifier: string): string | undefined {
  try {
    return new URL(specifier, fromUri).toString();
  } catch {
    return undefined;
  }
}
