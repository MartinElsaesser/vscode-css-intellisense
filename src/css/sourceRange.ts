import { SourceRange } from './selectorModel';

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

export function positionAt(
  offset: number,
  lineStarts: number[]
): { line: number; character: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: offset - lineStarts[low]! };
}

export function offsetAt(
  position: { line: number; character: number },
  lineStarts: number[]
): number {
  return (lineStarts[position.line] ?? 0) + position.character;
}

export function rangeFromOffsets(start: number, end: number, lineStarts: number[]): SourceRange {
  return { start: positionAt(start, lineStarts), end: positionAt(end, lineStarts) };
}
