
import { ClassRule, Compound } from '../css/selectorModel';
import { ClassAttributeContext, ElementSnapshot } from '../html/analyzeHtml';

export function compoundMatches(compound: Compound, element: ElementSnapshot): boolean {
  if (compound.tag && compound.tag !== element.tag) return false;
  if (compound.id && compound.id !== element.id) return false;
  for (const className of compound.classes) {
    if (!element.classes.has(className)) return false;
  }
  return true;
}

export function subjectMatches(subject: Compound, ctx: ClassAttributeContext): boolean {
  if (subject.tag && ctx.subjectTag && subject.tag !== ctx.subjectTag) return false;
  if (subject.id && ctx.subjectId && subject.id !== ctx.subjectId) return false;
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
