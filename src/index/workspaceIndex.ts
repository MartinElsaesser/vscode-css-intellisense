import { ClassRule, ParsedSource } from '../css/selectorModel';
import { ClassAttributeContext } from '../html/analyzeHtml';
import { matches } from '../match/matcher';

export interface ClassMatch {
  className: string;
  best?: ClassRule;
  fallback?: ClassRule;
}

export interface IndexStats {
  files: number;
  rules: number;
  classes: number;
}

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
}

export interface QueryOptions {
  includeNonMatching: boolean;
}

const MAX_DEFINITIONS = 32;

export function rank(rule: ClassRule): number {
  const depth =
    rule.ancestors.length + (rule.subject.tag ? 1 : 0) + (rule.subject.id ? 1 : 0);
  return Math.min(depth, 9);
}

export class WorkspaceIndex {
  private readonly byUri = new Map<string, ParsedSource>();
  private readonly byClass = new Map<string, ClassRule[]>();
  private readonly sourceKeysByDocument = new Map<string, Set<string>>();

  apply(parsed: ParsedSource): void {
    this.applySource(parsed);
    this.recordKey(parsed.uri, parsed.uri);
  }

  replaceDocument(documentUri: string, sources: ParsedSource[]): void {
    const previous = this.sourceKeysByDocument.get(documentUri);
    if (previous) {
      for (const key of [...previous]) this.removeSource(key);
    }
    for (const source of sources) {
      this.applySource(source);
      this.recordKey(documentUri, source.uri);
    }
  }

  remove(uri: string): void {
    this.removeSource(uri);
  }

  retain(reachable: ReadonlySet<string>): void {
    for (const uri of [...this.byUri.keys()]) {
      if (!reachable.has(uri)) this.removeSource(uri);
    }
  }

  sourceUris(): string[] {
    return [...this.byUri.keys()];
  }

  sourceKeysFor(documentUri: string): string[] {
    return [...(this.sourceKeysByDocument.get(documentUri) ?? [])];
  }

  clear(): void {
    this.byUri.clear();
    this.byClass.clear();
    this.sourceKeysByDocument.clear();
  }

  parsedFor(uri: string): ParsedSource | undefined {
    return this.byUri.get(uri);
  }

  private applySource(parsed: ParsedSource): void {
    this.removeSource(parsed.uri);
    for (const rule of parsed.rules) {
      let bucket = this.byClass.get(rule.className);
      if (!bucket) {
        bucket = [];
        this.byClass.set(rule.className, bucket);
      }
      bucket.push(rule);
    }
    this.byUri.set(parsed.uri, parsed);
  }

  private removeSource(uri: string): void {
    const parsed = this.byUri.get(uri);
    if (parsed && parsed.rules.length > 0) {
      const removed = new Set(parsed.rules);
      for (const rule of parsed.rules) {
        const bucket = this.byClass.get(rule.className);
        if (!bucket) continue;
        const remaining = bucket.filter((candidate) => !removed.has(candidate));
        if (remaining.length === 0) this.byClass.delete(rule.className);
        else this.byClass.set(rule.className, remaining);
      }
    }
    this.byUri.delete(uri);
    for (const [documentUri, keys] of this.sourceKeysByDocument) {
      if (keys.delete(uri) && keys.size === 0) this.sourceKeysByDocument.delete(documentUri);
    }
  }

  private recordKey(documentUri: string, sourceKey: string): void {
    let keys = this.sourceKeysByDocument.get(documentUri);
    if (!keys) {
      keys = new Set();
      this.sourceKeysByDocument.set(documentUri, keys);
    }
    keys.add(sourceKey);
  }

  query(
    ctx: ClassAttributeContext,
    documentUri: string,
    options: QueryOptions,
    token?: CancellationTokenLike
  ): ClassMatch[] {
    const results: ClassMatch[] = [];
    for (const [className, rules] of this.byClass) {
      if (token?.isCancellationRequested) return results;
      let best: ClassRule | undefined;
      let fallback: ClassRule | undefined;
      for (const rule of rules) {
        if (rule.origin === 'inline' && rule.documentUri !== documentUri) continue;
        if (fallback === undefined) fallback = rule;
        if (matches(rule, ctx) && (best === undefined || rank(rule) > rank(best))) {
          best = rule;
        }
      }
      if (best) {
        results.push({ className, best });
      } else if (options.includeNonMatching && fallback) {
        results.push({ className, fallback });
      }
    }
    return results;
  }

  definitionsFor(
    className: string,
    ctx: ClassAttributeContext,
    documentUri: string
  ): ClassRule[] {
    const rules = this.byClass.get(className);
    if (!rules) return [];
    const matching: ClassRule[] = [];
    const rest: ClassRule[] = [];
    for (const rule of rules) {
      if (rule.origin === 'inline' && rule.documentUri !== documentUri) continue;
      if (matches(rule, ctx)) matching.push(rule);
      else rest.push(rule);
    }
    const sortRules = (list: ClassRule[]): ClassRule[] =>
      list.sort(
        (left, right) =>
          rank(right) - rank(left) ||
          left.sourceUri.localeCompare(right.sourceUri) ||
          left.range.start.line - right.range.start.line ||
          left.range.start.character - right.range.start.character
      );
    const seen = new Set<string>();
    const results: ClassRule[] = [];
    for (const rule of [...sortRules(matching), ...sortRules(rest)]) {
      const key = `${rule.sourceUri}:${rule.range.start.line}:${rule.range.start.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(rule);
      if (results.length >= MAX_DEFINITIONS) break;
    }
    return results;
  }

  stats(): IndexStats {
    let rules = 0;
    for (const parsed of this.byUri.values()) rules += parsed.rules.length;
    return { files: this.byUri.size, rules, classes: this.byClass.size };
  }
}
