export type Combinator = 'descendant' | 'child' | 'adjacent' | 'general';

export type StructuralKind =
  | 'first-child'
  | 'last-child'
  | 'only-child'
  | 'first-of-type'
  | 'last-of-type'
  | 'only-of-type'
  | 'nth-child'
  | 'nth-last-child'
  | 'nth-of-type'
  | 'nth-last-of-type'
  | 'heading';

export interface StructuralTest {
  kind: StructuralKind;
  nth?: { a: number; b: number };
}

export interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  not?: Compound[];
  structural?: StructuralTest[];
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
  range: SourceRange;
}

export interface StyleBlock {
  startOffset: number;
  endOffset: number;
}

export interface ParsedSource {
  uri: string;
  version: number;
  rules: ClassRule[];
  imports: ImportRef[];
}
