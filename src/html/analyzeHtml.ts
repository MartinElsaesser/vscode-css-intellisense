import { SourceRange, StyleBlock } from '../css/selectorModel';
import { computeLineStarts, rangeFromOffsets } from '../css/sourceRange';

export interface ElementSnapshot {
  tag: string;                              // lowercase
  id?: string;
  classes: ReadonlySet<string>;
  parentChildren: readonly ElementSnapshot[];
  indexInParent: number;
  attributes?: ReadonlyMap<string, string | undefined>;
  attributesUnknown?: boolean;
}

export interface ClassAttributeContext {
  partial: string;
  range: SourceRange;
  value: string;
  valueRange: SourceRange;
  subjectTag?: string;
  subjectId?: string;
  path: ElementSnapshot[];
  subjectParentChildren: readonly ElementSnapshot[];
  subjectIndexInParent: number;
  siblingDataAvailable: boolean;
  subjectAttributes?: ReadonlyMap<string, string | undefined>;
  subjectAttributesUnknown?: boolean;
}

export interface DocumentAnalysis {
  version: number;
  contextAt(offset: number): ClassAttributeContext | undefined;
  styleBlocks: StyleBlock[];
}

export type HtmlLanguage = 'html' | 'vue' | 'svelte';

const HTML_LANGUAGES: ReadonlySet<string> = new Set(['html', 'vue', 'svelte']);

export function isHtmlLanguage(languageId: string): boolean {
  return HTML_LANGUAGES.has(languageId);
}

interface ElementNode {
  tag: string;
  id?: string;
  classes: Set<string>;
  children: ElementNode[];
  parentChildren: ElementNode[];
  indexInParent: number;
  attributes: Map<string, string | undefined>;
}

interface ClassOccurrence {
  tag?: string;
  staticId?: string;
  idDynamic: boolean;
  valueStart: number;
  valueEnd: number;
  expressions: { start: number; end: number }[];
  path: ElementNode[];
  subjectParentChildren: ElementNode[];
  subjectIndexInParent: number;
  attributes: Map<string, string | undefined>;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const P_CLOSERS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'search',
  'section',
  'table',
  'ul',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea']);

function isWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r' ||
    character === '\f'
  );
}

function isPartialStop(character: string): boolean {
  return (
    isWhitespace(character) ||
    character === '"' ||
    character === "'" ||
    character === '>' ||
    character === '<' ||
    character === '=' ||
    character === '`'
  );
}

function staticClasses(value: string): Set<string> {
  const classes = new Set<string>();
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    if (token.includes('{') || token.includes('}')) continue;
    classes.add(token);
  }
  return classes;
}

function findExpressions(value: string, base: number): { start: number; end: number }[] {
  const expressions: { start: number; end: number }[] = [];
  let index = 0;
  while (index < value.length) {
    const open = value.indexOf('{', index);
    if (open === -1) break;
    const close = value.indexOf('}', open + 1);
    const end = close === -1 ? value.length : close + 1;
    expressions.push({ start: base + open, end: base + end });
    index = end;
  }
  return expressions;
}

export function analyzeHtmlDocument(
  text: string,
  language: HtmlLanguage,
  version = 0
): DocumentAnalysis {
  const roots: ElementNode[] = [];
  const stack: { tag: string; node: ElementNode }[] = [];
  const occurrences: ClassOccurrence[] = [];
  const styleBlocks: StyleBlock[] = [];
  const lineStarts = computeLineStarts(text);
  const lowerText = text.toLowerCase();
  const length = text.length;
  let index = 0;

  const currentChildren = (): ElementNode[] =>
    stack.length > 0 ? stack[stack.length - 1]!.node.children : roots;

  const closeElement = (name: string): void => {
    for (let depth = stack.length - 1; depth >= 0; depth--) {
      if (stack[depth]!.tag === name) {
        stack.length = depth;
        return;
      }
    }
  };

  const closeImplied = (tag: string): void => {
    const top = stack.length > 0 ? stack[stack.length - 1]!.tag : undefined;
    if (top) {
      if (tag === 'li' && top === 'li') {
        stack.pop();
      } else if ((tag === 'dt' || tag === 'dd') && (top === 'dt' || top === 'dd')) {
        stack.pop();
      } else if (tag === 'tr') {
        const currentTop = stack.length > 0 ? stack[stack.length - 1]!.tag : undefined;
        if (currentTop === 'td' || currentTop === 'th') stack.pop();
        if (stack.length > 0 && stack[stack.length - 1]!.tag === 'tr') stack.pop();
      } else if ((tag === 'td' || tag === 'th') && (top === 'td' || top === 'th')) {
        stack.pop();
      } else if (tag === 'option' && top === 'option') {
        stack.pop();
      }
    }
    if (
      P_CLOSERS.has(tag) &&
      stack.length > 0 &&
      stack[stack.length - 1]!.tag === 'p'
    ) {
      stack.pop();
    }
  };

  const parseStartTag = (start: number): number => {
    let position = start + 1;
    const nameStart = position;
    while (position < length && !isWhitespace(text[position]!) && text[position] !== '/' && text[position] !== '>') {
      position++;
    }
    const rawTag = text.slice(nameStart, position);
    const tag = rawTag.toLowerCase();

    let staticId: string | undefined;
    let idSeen = false;
    let idDynamic = false;
    let occurrence: ClassOccurrence | undefined;
    let selfClosing = false;
    let tagClosed = false;
    const attributes = new Map<string, string | undefined>();

    while (position < length) {
      while (position < length && isWhitespace(text[position]!)) position++;
      if (position >= length) break;
      if (text[position] === '>') {
        position++;
        tagClosed = true;
        break;
      }
      if (text[position] === '/' && text[position + 1] === '>') {
        position += 2;
        selfClosing = true;
        tagClosed = true;
        break;
      }

      const attributeStart = position;
      while (
        position < length &&
        !isWhitespace(text[position]!) &&
        text[position] !== '=' &&
        text[position] !== '/' &&
        text[position] !== '>'
      ) {
        position++;
      }
      const attributeName = text.slice(attributeStart, position);
      const attributeLower = attributeName.toLowerCase();

      while (position < length && isWhitespace(text[position]!)) position++;
      let valueStart = position;
      let valueEnd = position;
      if (text[position] === '=') {
        position++;
        while (position < length && isWhitespace(text[position]!)) position++;
        const quote = text[position];
        if (quote === '"' || quote === "'") {
          position++;
          valueStart = position;
          const close = text.indexOf(quote, position);
          if (close === -1) {
            valueEnd = length;
            position = length;
          } else {
            valueEnd = close;
            position = close + 1;
          }
        } else {
          valueStart = position;
          while (position < length && !isWhitespace(text[position]!) && text[position] !== '>') {
            position++;
          }
          valueEnd = position;
        }
      }
      const value = text.slice(valueStart, valueEnd);
      const dynamic =
        attributeName.startsWith(':') ||
        attributeLower.startsWith('v-bind:') ||
        attributeName.includes('{') ||
        value.includes('{');

      const bound = attributeName.startsWith(':') || attributeLower.startsWith('v-bind:');
      const attributeKey = bound
        ? attributeLower.replace(/^:|^v-bind:/, '')
        : attributeLower.startsWith('@') ||
            attributeLower.startsWith('#') ||
            attributeLower.startsWith('v-on:') ||
            attributeName.includes('{')
          ? undefined
          : attributeLower;
      if (attributeKey && !attributes.has(attributeKey)) {
        attributes.set(attributeKey, bound || value.includes('{') ? undefined : value);
      }

      if (attributeLower === 'id' && !idSeen) {
        idSeen = true;
        if (dynamic) idDynamic = true;
        else if (value) staticId = value;
      }

      if (attributeLower === 'class' && !occurrence) {
        occurrence = {
          tag: tag || undefined,
          idDynamic: false,
          valueStart,
          valueEnd,
          expressions: findExpressions(value, valueStart),
          path: [],
          subjectParentChildren: [],
          subjectIndexInParent: 0,
          attributes,
        };
      }
    }

    closeImplied(tag);

    if (occurrence) {
      const parentChildren = currentChildren();
      occurrence.staticId = staticId;
      occurrence.idDynamic = idDynamic;
      occurrence.path = stack.map((entry) => entry.node).reverse();
      occurrence.subjectParentChildren = parentChildren;
      occurrence.subjectIndexInParent = parentChildren.length;
      occurrences.push(occurrence);
    }

    if (!tagClosed) return length;

    const foreign = stack.some((entry) => entry.tag === 'svg' || entry.tag === 'math');
    const selfCloses = selfClosing && (language !== 'html' || foreign);
    if (!VOID_ELEMENTS.has(tag) && !selfCloses) {
      const parentChildren = currentChildren();
      const node: ElementNode = {
        tag,
        id: staticId,
        classes: occurrence ? staticClasses(text.slice(occurrence.valueStart, occurrence.valueEnd)) : new Set(),
        children: [],
        parentChildren,
        indexInParent: parentChildren.length,
        attributes,
      };
      parentChildren.push(node);
      stack.push({ tag, node });
    }

    if (!VOID_ELEMENTS.has(tag) && !selfCloses && RAW_TEXT_ELEMENTS.has(tag)) {
      const closeIndex = lowerText.indexOf(`</${tag}`, position);
      if (tag === 'style') {
        const end = closeIndex === -1 ? length : closeIndex;
        styleBlocks.push({ startOffset: position, endOffset: end });
      }
      return closeIndex === -1 ? length : closeIndex;
    }

    return position;
  };

  while (index < length) {
    const tagOpen = text.indexOf('<', index);
    if (tagOpen === -1) break;

    if (text.startsWith('<!--', tagOpen)) {
      const close = text.indexOf('-->', tagOpen + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (text.startsWith('<!', tagOpen)) {
      const close = text.indexOf('>', tagOpen + 2);
      index = close === -1 ? length : close + 1;
      continue;
    }
    if (text.startsWith('</', tagOpen)) {
      const close = text.indexOf('>', tagOpen + 2);
      const name = text.slice(tagOpen + 2, close === -1 ? length : close).trim().toLowerCase();
      if (name) closeElement(name);
      index = close === -1 ? length : close + 1;
      continue;
    }
    const next = text[tagOpen + 1];
    if (next && /[a-zA-Z]/.test(next)) {
      index = parseStartTag(tagOpen);
      continue;
    }
    index = tagOpen + 1;
  }

  const contextAt = (offset: number): ClassAttributeContext | undefined => {
    for (const occurrence of occurrences) {
      if (offset < occurrence.valueStart || offset > occurrence.valueEnd) continue;
      if (
        language === 'svelte' &&
        occurrence.expressions.some((span) => offset > span.start && offset <= span.end)
      ) {
        return undefined;
      }
      let start = offset;
      while (start > occurrence.valueStart && !isPartialStop(text[start - 1]!)) start--;
      let end = offset;
      while (end < occurrence.valueEnd && !isPartialStop(text[end]!)) end++;
      return {
        partial: text.slice(start, end),
        range: rangeFromOffsets(start, end, lineStarts),
        value: text.slice(occurrence.valueStart, occurrence.valueEnd),
        valueRange: rangeFromOffsets(occurrence.valueStart, occurrence.valueEnd, lineStarts),
        subjectTag: occurrence.tag,
        subjectId: occurrence.idDynamic ? undefined : occurrence.staticId,
        path: occurrence.path,
        subjectParentChildren: occurrence.subjectParentChildren,
        subjectIndexInParent: occurrence.subjectIndexInParent,
        siblingDataAvailable: true,
        subjectAttributes: occurrence.attributes,
        subjectAttributesUnknown: false,
      };
    }
    return undefined;
  };

  return { version, contextAt, styleBlocks };
}
