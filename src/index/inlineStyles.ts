import * as vscode from 'vscode';
import { parseCss } from '../css/parseCss';
import { ParsedSource, SourceRange } from '../css/selectorModel';
import { computeLineStarts, offsetAt, rangeFromOffsets } from '../css/sourceRange';
import { analyzeHtmlDocument, HtmlLanguage } from '../html/analyzeHtml';

export function collectInlineSourcesFromText(
  text: string,
  languageId: string,
  version: number,
  documentUri: string
): ParsedSource[] {
  const analysis = analyzeHtmlDocument(text, languageId as HtmlLanguage, version);
  const documentLineStarts = computeLineStarts(text);
  const sources: ParsedSource[] = [];
  for (const block of analysis.styleBlocks) {
    const css = text.slice(block.startOffset, block.endOffset);
    const parsed = parseCss(css, documentUri, { origin: 'inline', documentUri });
    const blockLineStarts = computeLineStarts(css);
    const shift = (range: SourceRange): SourceRange => {
      const start = block.startOffset + offsetAt(range.start, blockLineStarts);
      const end = block.startOffset + offsetAt(range.end, blockLineStarts);
      return rangeFromOffsets(start, end, documentLineStarts);
    };
    sources.push({
      uri: `${documentUri}#style:${block.startOffset}`,
      version,
      rules: parsed.rules.map((rule) => ({ ...rule, range: shift(rule.range) })),
      imports: parsed.imports.map((ref) => ({ ...ref, range: shift(ref.range) })),
    });
  }
  return sources;
}

export function collectInlineSources(document: vscode.TextDocument): ParsedSource[] {
  return collectInlineSourcesFromText(
    document.getText(),
    document.languageId,
    document.version,
    document.uri.toString()
  );
}
