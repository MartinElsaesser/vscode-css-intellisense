
import { ClassRule, Compound, StructuralTest } from '../css/selectorModel';
import { ClassAttributeContext, ElementSnapshot } from '../html/analyzeHtml';

export function subjectClasses(ctx: ClassAttributeContext): Set<string> {
  const used = new Set(ctx.value.split(/\s+/).filter(Boolean));
  if (ctx.partial) used.delete(ctx.partial);
  return used;
}

function simpleCompoundMatches(compound: Compound, element: ElementSnapshot): boolean {
  if (compound.tag && compound.tag !== element.tag) return false;
  if (compound.id && compound.id !== element.id) return false;
  for (const className of compound.classes) {
    if (!element.classes.has(className)) return false;
  }
  return true;
}

interface SiblingView {
  index: number;
  count: number;
  indexOfType: number;
  countOfType: number;
}

function siblingView(
  tag: string | undefined,
  siblings: readonly ElementSnapshot[],
  index: number
): SiblingView {
  const inList = index < siblings.length;
  const count = inList ? siblings.length : index + 1;
  let indexOfType = 0;
  let countOfType = 0;
  for (let position = 0; position < Math.min(count, siblings.length); position++) {
    const sibling = siblings[position]!;
    if (sibling.tag !== tag) continue;
    countOfType += 1;
    if (position < index) indexOfType += 1;
  }
  if (!inList) countOfType += 1;
  return { index, count, indexOfType, countOfType };
}

function matchesNth(position: number, a: number, b: number): boolean {
  if (a === 0) return position === b;
  const n = (position - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function evaluateStructural(test: StructuralTest, view: SiblingView): boolean {
  switch (test.kind) {
    case 'first-child':
      return view.index === 0;
    case 'last-child':
      return view.index === view.count - 1;
    case 'only-child':
      return view.count === 1;
    case 'first-of-type':
      return view.indexOfType === 0;
    case 'last-of-type':
      return view.indexOfType === view.countOfType - 1;
    case 'only-of-type':
      return view.countOfType === 1;
    case 'nth-child':
      return test.nth !== undefined && matchesNth(view.index + 1, test.nth.a, test.nth.b);
    case 'nth-last-child':
      return (
        test.nth !== undefined && matchesNth(view.count - view.index, test.nth.a, test.nth.b)
      );
    case 'nth-of-type':
      return (
        test.nth !== undefined &&
        matchesNth(view.indexOfType + 1, test.nth.a, test.nth.b)
      );
    case 'nth-last-of-type':
      return (
        test.nth !== undefined &&
        matchesNth(view.countOfType - view.indexOfType, test.nth.a, test.nth.b)
      );
    default:
      return false;
  }
}

function elementStructuralMatches(test: StructuralTest, element: ElementSnapshot): boolean {
  if (test.kind === 'heading') return /^h[1-6]$/.test(element.tag);
  return evaluateStructural(test, siblingView(element.tag, element.parentChildren, element.indexInParent));
}

function subjectStructuralMatches(test: StructuralTest, ctx: ClassAttributeContext): boolean {
  if (test.kind === 'heading') {
    return ctx.subjectTag === undefined || /^h[1-6]$/.test(ctx.subjectTag);
  }
  if (test.kind.endsWith('of-type') && ctx.subjectTag === undefined) return true;
  if (!ctx.siblingDataAvailable) return false;
  return evaluateStructural(
    test,
    siblingView(ctx.subjectTag, ctx.subjectParentChildren, ctx.subjectIndexInParent)
  );
}

export function compoundMatches(compound: Compound, element: ElementSnapshot): boolean {
  if (!simpleCompoundMatches(compound, element)) return false;
  for (const excluded of compound.not ?? []) {
    if (simpleCompoundMatches(excluded, element)) return false;
  }
  for (const test of compound.structural ?? []) {
    if (!elementStructuralMatches(test, element)) return false;
  }
  return true;
}

function subjectExcludedMatches(
  compound: Compound,
  ctx: ClassAttributeContext,
  classes: ReadonlySet<string>
): boolean {
  if (compound.tag && ctx.subjectTag && compound.tag !== ctx.subjectTag) return false;
  if (compound.id && ctx.subjectId && compound.id !== ctx.subjectId) return false;
  for (const className of compound.classes) {
    if (!classes.has(className)) return false;
  }
  return true;
}

export function subjectMatches(subject: Compound, ctx: ClassAttributeContext): boolean {
  if (subject.tag && ctx.subjectTag && subject.tag !== ctx.subjectTag) return false;
  if (subject.id && ctx.subjectId && subject.id !== ctx.subjectId) return false;
  if (subject.not && subject.not.length > 0) {
    const classes = subjectClasses(ctx);
    for (const excluded of subject.not) {
      if (subjectExcludedMatches(excluded, ctx, classes)) return false;
    }
  }
  for (const test of subject.structural ?? []) {
    if (!subjectStructuralMatches(test, ctx)) return false;
  }
  return true;
}

interface Anchor {
  parentChildren: readonly ElementSnapshot[];
  indexInParent: number;
}

export function matches(rule: ClassRule, ctx: ClassAttributeContext): boolean {
  if (!subjectMatches(rule.subject, ctx)) return false;

  // Invariant: pathIdx points at the index in ctx.path of the PARENT of the
  // current anchor. Sibling matches keep the same parent, so pathIdx stays
  // valid for subsequent descendant/child requirements.
  let pathIdx = 0;
  let anchor: Anchor = {
    parentChildren: ctx.subjectParentChildren,
    indexInParent: ctx.subjectIndexInParent,
  };

  for (const requirement of rule.ancestors) {
    let found: ElementSnapshot | undefined;
    switch (requirement.combinator) {
      case 'descendant': {
        for (let index = pathIdx; index < ctx.path.length; index++) {
          const element = ctx.path[index];
          if (element && compoundMatches(requirement.compound, element)) {
            found = element;
            pathIdx = index + 1;
            break;
          }
        }
        break;
      }
      case 'child': {
        const element = pathIdx < ctx.path.length ? ctx.path[pathIdx] : undefined;
        if (element && compoundMatches(requirement.compound, element)) {
          found = element;
          pathIdx += 1;
        }
        break;
      }
      case 'adjacent': {
        const index = anchor.indexInParent - 1;
        const element = index >= 0 ? anchor.parentChildren[index] : undefined;
        if (element && compoundMatches(requirement.compound, element)) {
          found = element;
        }
        break;
      }
      case 'general': {
        for (let index = anchor.indexInParent - 1; index >= 0; index--) {
          const element = anchor.parentChildren[index];
          if (element && compoundMatches(requirement.compound, element)) {
            found = element;
            break;
          }
        }
        break;
      }
    }
    if (!found) return false;
    anchor = found;
  }
  return true;
}
