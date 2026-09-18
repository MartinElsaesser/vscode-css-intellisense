export type Combinator = 'descendant' | 'child' | 'adjacent' | 'general';

export interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  universal: boolean;
}

export interface AncestorRequirement {
  compound: Compound;
  combinator: Combinator;
}

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface ClassRule {
  className: string;
  subject: Compound;
  ancestors: AncestorRequirement[];
  sourceUri: string;
  range: SourceRange;
  selectorText: string;
  origin: 'global' | 'inline';
  documentUri?: string;
}

export interface ImportRef {
  specifier: string;
  fromUri: string;
  sourceUri: string;
  range: SourceRange;
}

export interface StyleBlock {
  startOffset: number;
  endOffset: number;
  css: string;
}

export interface ParsedSource {
  uri: string;
  version: number;
  rules: ClassRule[];
  imports: ImportRef[];
  styleBlocks?: StyleBlock[];
}
