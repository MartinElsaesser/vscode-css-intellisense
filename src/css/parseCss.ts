import postcss, { AtRule, Node, Rule } from 'postcss';
import selectorParser, { Selector } from 'postcss-selector-parser';
import { extractImportSpecifier, resolveImportUri } from './importResolver';
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

interface MutableCompound {
  tag?: string;
  id?: string;
  classes: string[];
  universal: boolean;
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
  const hasParts = Boolean(compound.tag) || Boolean(compound.id) || compound.classes.length > 0;
  return {
    tag: compound.tag,
    id: compound.id,
    classes: compound.classes,
    universal: compound.universal || !hasParts,
  };
}

function toRange(node: Rule | AtRule): SourceRange {
  const start = node.source?.start;
  const end = node.source?.end ?? start;
  return {
    start: { line: (start?.line ?? 1) - 1, character: (start?.column ?? 1) - 1 },
    end: { line: (end?.line ?? 1) - 1, character: (end?.column ?? 1) - 1 },
  };
}

function hasSkippedAncestor(rule: Rule): boolean {
  let parent: Node | undefined = rule.parent;
  for (; parent; parent = parent.parent) {
    if (parent.type === 'rule') return true;
    if (parent.type === 'atrule') {
      const name = (parent as AtRule).name.toLowerCase().replace(/^@/, '');
      if (SKIP_AT_RULES.has(name)) return true;
    }
  }
  return false;
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
    if (!current) current = { classes: [], universal: false };
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
      case 'universal':
        current.universal = true;
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

  root.walkRules((rule) => {
    if (hasSkippedAncestor(rule)) return;
    let selectorRoot;
    try {
      selectorRoot = selectorParser().astSync(rule.selector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report(`malformed selector "${rule.selector}": ${message}`);
      return;
    }
    for (const selector of selectorRoot.nodes) {
      let compiled: ClassRule[];
      try {
        compiled = compileSelector(selector, rule, sourceUri, opts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report(`malformed selector "${rule.selector}": ${message}`);
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
    const resolved = resolveImportUri(sourceUri, specifier);
    if (!resolved) return;
    imports.push({
      specifier,
      fromUri: sourceUri,
      sourceUri: resolved,
      range: toRange(atRule),
    });
  });

  return { rules, imports };
}
