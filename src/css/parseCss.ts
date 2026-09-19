import postcss, { AtRule, Node, Rule } from 'postcss';
import selectorParser, { Node as SelectorNode, Selector } from 'postcss-selector-parser';
import { extractImportSpecifier } from './importSpecifier';
import {
  AncestorRequirement,
  ClassRule,
  Combinator,
  Compound,
  ImportRef,
  SourceRange,
} from './selectorModel';

export class ParseFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ParseFailure';
  }
}

export interface ParseCssOptions {
  origin: 'global' | 'inline';
  documentUri?: string;
  onError?: (message: string) => void;
}

export interface ParseCssResult {
  rules: ClassRule[];
  imports: ImportRef[];
}

const SKIP_AT_RULES = new Set([
  'keyframes',
  '-webkit-keyframes',
  '-moz-keyframes',
  'font-face',
  'page',
  'counter-style',
  'font-feature-values',
  'property',
  'viewport',
  '-ms-viewport',
]);

const MAX_RESOLVED_SELECTORS = 256;

interface MutableCompound {
  tag?: string;
  id?: string;
  classes: string[];
}

function normalizeCombinator(value: string): Combinator | undefined {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === ' ') return 'descendant';
  if (trimmed === '>') return 'child';
  if (trimmed === '+') return 'adjacent';
  if (trimmed === '~') return 'general';
  return undefined;
}

function finalizeCompound(compound: MutableCompound): Compound {
  return { tag: compound.tag, id: compound.id, classes: compound.classes };
}

function toRange(node: Rule | AtRule): SourceRange {
  const start = node.source?.start;
  const end = node.source?.end ?? start;
  return {
    start: { line: (start?.line ?? 1) - 1, character: (start?.column ?? 1) - 1 },
    end: { line: (end?.line ?? 1) - 1, character: (end?.column ?? 1) - 1 },
  };
}

function hasSkippedAtRuleAncestor(rule: Rule): boolean {
  let parent: Node | undefined = rule.parent;
  for (; parent; parent = parent.parent) {
    if (parent.type === 'atrule') {
      const name = (parent as AtRule).name.toLowerCase().replace(/^@/, '');
      if (SKIP_AT_RULES.has(name)) return true;
    }
  }
  return false;
}

function nearestRuleAncestor(rule: Rule): Rule | undefined {
  let parent: Node | undefined = rule.parent;
  for (; parent; parent = parent.parent) {
    if (parent.type === 'rule') return parent as Rule;
  }
  return undefined;
}

function parseSelectorList(text: string): Selector[] | undefined {
  try {
    return selectorParser().astSync(text).nodes;
  } catch {
    return undefined;
  }
}

function isSiblingCombinator(node: SelectorNode): boolean {
  if (node.type !== 'combinator') return false;
  const value = node.value.trim();
  return value === '+' || value === '~';
}

function hasUnrepresentableNesting(selector: Selector): boolean {
  let siblingSeen = false;
  for (const node of selector.nodes) {
    if (isSiblingCombinator(node)) siblingSeen = true;
    else if (node.type === 'nesting' && siblingSeen) return true;
  }
  return false;
}

function combineSelector(parent: Selector, own: Selector): Selector {
  const hasNesting = own.nodes.some((node) => node.type === 'nesting');
  const combined = selectorParser.selector({ value: '' });
  const first = own.nodes[0];
  if (!hasNesting) {
    for (const node of parent.nodes) combined.append(node.clone());
    if (first?.type !== 'combinator') combined.append(selectorParser.combinator({ value: ' ' }));
  }
  for (const node of own.nodes) {
    if (node.type === 'nesting') {
      for (const parentNode of parent.nodes) combined.append(parentNode.clone());
    } else {
      combined.append(node.clone());
    }
  }
  for (const node of combined.nodes) {
    if (node.type === 'combinator') {
      const spaced = node.value.trim() !== '';
      node.spaces = { before: spaced ? ' ' : '', after: spaced ? ' ' : '' };
    } else {
      node.spaces = { before: '', after: '' };
    }
  }
  return combined;
}

function resolveRuleSelectors(
  rule: Rule,
  cache: Map<Rule, Selector[] | undefined>,
  report: (message: string) => void
): Selector[] | undefined {
  if (cache.has(rule)) return cache.get(rule);
  const ownSelectors = parseSelectorList(rule.selector);
  if (!ownSelectors) {
    report(`malformed selector "${rule.selector}"`);
    cache.set(rule, undefined);
    return undefined;
  }
  const parentRule = nearestRuleAncestor(rule);
  if (!parentRule) {
    const hasTopLevelNesting = ownSelectors.some((selector) =>
      selector.nodes.some((node) => node.type === 'nesting')
    );
    const resolved = hasTopLevelNesting ? undefined : ownSelectors;
    cache.set(rule, resolved);
    return resolved;
  }
  const parentSelectors = resolveRuleSelectors(parentRule, cache, report);
  if (!parentSelectors) {
    cache.set(rule, undefined);
    return undefined;
  }
  const resolved: Selector[] = [];
  for (const own of ownSelectors) {
    if (hasUnrepresentableNesting(own)) continue;
    for (const parent of parentSelectors) {
      resolved.push(combineSelector(parent, own));
      if (resolved.length > MAX_RESOLVED_SELECTORS) {
        report(`selector list too large after nesting resolution for "${rule.selector}"`);
        cache.set(rule, undefined);
        return undefined;
      }
    }
  }
  const result = resolved.length > 0 ? resolved : undefined;
  cache.set(rule, result);
  return result;
}

function compileSelector(
  selector: Selector,
  rule: Rule,
  sourceUri: string,
  opts: ParseCssOptions
): ClassRule[] {
  const report = opts.onError ?? (() => {});
  const compounds: MutableCompound[] = [];
  const combinators: Combinator[] = [];
  let current: MutableCompound | undefined;
  let invalid = false;
  let malformed = false;

  for (const node of selector.nodes) {
    if (node.type === 'combinator') {
      const combinator = normalizeCombinator(node.value);
      if (!combinator || !current) {
        invalid = true;
        break;
      }
      compounds.push(current);
      combinators.push(combinator);
      current = undefined;
      continue;
    }
    if (!current) current = { classes: [] };
    switch (node.type) {
      case 'tag':
        current.tag = node.value.toLowerCase();
        break;
      case 'class':
        if (node.value === '') malformed = true;
        else current.classes.push(node.value);
        break;
      case 'id':
        if (node.value === '') malformed = true;
        else current.id = node.value;
        break;
      case 'nesting':
        invalid = true;
        break;
      default:
        break;
    }
    if (invalid || malformed) break;
  }

  if (malformed) {
    report(`malformed selector "${selector.toString().trim()}": empty simple selector`);
    return [];
  }
  if (invalid || !current) return [];
  compounds.push(current);

  const subject = finalizeCompound(compounds[compounds.length - 1]!);
  if (subject.classes.length === 0) return [];

  const ancestors: AncestorRequirement[] = [];
  for (let index = compounds.length - 2; index >= 0; index--) {
    ancestors.push({
      compound: finalizeCompound(compounds[index]!),
      combinator: combinators[index]!,
    });
  }

  const range = toRange(rule);
  const selectorText = selector.toString().trim();
  return subject.classes.map((className) => ({
    className,
    subject,
    ancestors,
    sourceUri,
    range,
    selectorText,
    origin: opts.origin,
    ...(opts.documentUri !== undefined ? { documentUri: opts.documentUri } : {}),
  }));
}

export function parseCss(css: string, sourceUri: string, opts: ParseCssOptions): ParseCssResult {
  const report = opts.onError ?? (() => {});
  let root;
  try {
    root = postcss.parse(css, { from: sourceUri });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ParseFailure(message, { cause: error });
  }

  const rules: ClassRule[] = [];
  const seen = new Set<string>();
  const resolvedSelectors = new Map<Rule, Selector[] | undefined>();

  root.walkRules((rule) => {
    if (hasSkippedAtRuleAncestor(rule)) return;
    const selectors = resolveRuleSelectors(rule, resolvedSelectors, report);
    if (!selectors) return;
    for (const selector of selectors) {
      let compiled: ClassRule[];
      try {
        compiled = compileSelector(selector, rule, sourceUri, opts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report(`malformed selector "${selector.toString().trim()}": ${message}`);
        continue;
      }
      for (const classRule of compiled) {
        const key = [
          classRule.className,
          classRule.selectorText,
          JSON.stringify([classRule.subject, classRule.ancestors]),
        ].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push(classRule);
      }
    }
  });

  const imports: ImportRef[] = [];
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase() !== 'import') return;
    const specifier = extractImportSpecifier(atRule.params);
    if (!specifier) return;
    imports.push({
      specifier,
      fromUri: sourceUri,
      range: toRange(atRule),
    });
  });

  return { rules, imports };
}
