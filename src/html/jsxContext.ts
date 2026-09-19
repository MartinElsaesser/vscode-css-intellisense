import ts from 'typescript';
import { computeLineStarts, rangeFromOffsets } from '../css/sourceRange';
import { ClassAttributeContext, DocumentAnalysis, ElementSnapshot } from './analyzeHtml';

const JSX_LANGUAGES = new Set(['javascriptreact', 'typescriptreact']);

function isPartialStop(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r' ||
    character === '\f' ||
    character === '"' ||
    character === "'" ||
    character === '>' ||
    character === '<' ||
    character === '=' ||
    character === '`'
  );
}

function isCapitalizedTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

function staticStringValue(
  sourceFile: ts.SourceFile,
  attributes: ts.JsxAttributes,
  attributeName: string
): string | undefined {
  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    if (property.name.getText(sourceFile) !== attributeName) continue;
    const initializer = property.initializer;
    if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
    return undefined;
  }
  return undefined;
}

function collectAttributes(
  sourceFile: ts.SourceFile,
  attributes: ts.JsxAttributes
): { attributes: Map<string, string | undefined>; attributesUnknown: boolean } {
  const result = new Map<string, string | undefined>();
  let attributesUnknown = false;
  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      attributesUnknown = true;
      continue;
    }
    if (!ts.isJsxAttribute(property)) continue;
    const name = property.name.getText(sourceFile).toLowerCase();
    const key = name === 'classname' ? 'class' : name;
    if (result.has(key)) continue;
    const initializer = property.initializer;
    if (initializer && ts.isStringLiteral(initializer)) result.set(key, initializer.text);
    else result.set(key, undefined);
  }
  return { attributes: result, attributesUnknown };
}

function elementSnapshot(
  sourceFile: ts.SourceFile,
  element: ts.JsxElement | ts.JsxSelfClosingElement
): ElementSnapshot | undefined {
  const tagName = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
  const tag = tagName.getText(sourceFile);
  if (isCapitalizedTag(tag)) return undefined;
  const attributeNodes = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
  const classes = new Set<string>();
  const className = staticStringValue(sourceFile, attributeNodes, 'className');
  if (className !== undefined) {
    for (const token of className.split(/\s+/)) {
      if (token) classes.add(token);
    }
  }
  const id = staticStringValue(sourceFile, attributeNodes, 'id');
  const collected = collectAttributes(sourceFile, attributeNodes);
  return {
    tag,
    ...(id !== undefined ? { id } : {}),
    classes,
    parentChildren: [],
    indexInParent: 0,
    attributes: collected.attributes,
    ...(collected.attributesUnknown ? { attributesUnknown: true } : {}),
  };
}

function findInnermost(sourceFile: ts.SourceFile, offset: number): ts.Node {
  let current: ts.Node = sourceFile;
  outer: for (;;) {
    for (const child of current.getChildren(sourceFile)) {
      if (child.pos <= offset && offset <= child.end) {
        current = child;
        continue outer;
      }
    }
    return current;
  }
}

function classNameLiteral(attribute: ts.JsxAttribute): ts.StringLiteral | undefined {
  const initializer = attribute.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    return initializer.expression;
  }
  return undefined;
}

export function analyzeJsxDocument(
  text: string,
  fileName: string,
  version = 0
): DocumentAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
  const lineStarts = computeLineStarts(text);

  const contextAt = (offset: number): ClassAttributeContext | undefined => {
    if (offset < 0 || offset > text.length) return undefined;
    let node: ts.Node | undefined = findInnermost(sourceFile, offset);
    while (node && !ts.isJsxAttribute(node)) node = node.parent;
    if (!node) return undefined;
    if (node.name.getText(sourceFile) !== 'className') return undefined;
    const literal = classNameLiteral(node);
    if (!literal) return undefined;
    const contentStart = literal.getStart(sourceFile) + 1;
    const contentEnd = literal.getEnd() - 1;
    if (offset < contentStart || offset > contentEnd) return undefined;

    let start = offset;
    while (start > contentStart && !isPartialStop(text[start - 1]!)) start--;
    let end = offset;
    while (end < contentEnd && !isPartialStop(text[end]!)) end++;

    const ownerOpening = node.parent.parent;
    const subjectElement: ts.JsxElement | ts.JsxSelfClosingElement = ts.isJsxOpeningElement(
      ownerOpening
    )
      ? ownerOpening.parent
      : ownerOpening;
    const subjectAttributeNodes = ts.isJsxElement(subjectElement)
      ? subjectElement.openingElement.attributes
      : subjectElement.attributes;
    const subjectTagNode = ts.isJsxElement(subjectElement)
      ? subjectElement.openingElement.tagName
      : subjectElement.tagName;
    const subjectTag = subjectTagNode.getText(sourceFile);
    const subjectId = staticStringValue(sourceFile, subjectAttributeNodes, 'id');
    const subjectCollected = collectAttributes(sourceFile, subjectAttributeNodes);

    const path: ElementSnapshot[] = [];
    for (let parent = subjectElement.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
        const snapshot = elementSnapshot(sourceFile, parent);
        if (snapshot) path.push(snapshot);
      }
    }

    return {
      partial: text.slice(start, end),
      range: rangeFromOffsets(start, end, lineStarts),
      value: text.slice(contentStart, contentEnd),
      valueRange: rangeFromOffsets(contentStart, contentEnd, lineStarts),
      subjectTag,
      ...(subjectId !== undefined ? { subjectId } : {}),
      path,
      subjectParentChildren: [],
      subjectIndexInParent: 0,
      siblingDataAvailable: false,
      subjectAttributes: subjectCollected.attributes,
      ...(subjectCollected.attributesUnknown ? { subjectAttributesUnknown: true } : {}),
    };
  };

  return { version, contextAt, styleBlocks: [] };
}

export function isJsxLanguage(languageId: string): boolean {
  return JSX_LANGUAGES.has(languageId);
}
