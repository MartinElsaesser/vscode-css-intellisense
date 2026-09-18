# SPEC: `vscode-css-intellisense` — Hierarchy-Aware CSS Class Completion for HTML

**Status:** Draft v4 · **Target:** VS Code `^1.90.0`, extension host Node ≥ 20, Linux/macOS/Windows
**Changes in v4:** all 20 `FEEDBACK.md` items applied — ancestor `#id` semantics (§7.3, §7.4), `strictHierarchy:false` data path (§8.1, §9.2), native-nesting and rightmost-compound skips (§4.2), no partial prefilter (§8.1), JSX sibling policy (§6.2), full-document fixture + no tag synthesis (§5.2, §7.4), cacheable analysis APIs (§5.1, §6.1), inline-source lifecycle (§8.4), configurable watchers + `picomatch` (§8.4), inline `@import` base URI (§4.3), `ClassMatch`/multi-root (§8.1, §8.4), scanner wording (§5.2), `<p>` auto-close list (§5.2), `/>` per language (§5.2), `apply` precision (§8.1), whole-rule ranges (§3, §4.2), dependency/ESLint fixes (§13), Svelte directive note (§5.4).
**Purpose of this document:** implementation-ready specification. It defines exact data structures, algorithms, module boundaries, configuration, tests, and milestones. An implementer should be able to build the extension without further design decisions; remaining freedoms are marked "IMPLEMENTER MAY".

---

## 1. Overview

### 1.1 Problem

Editors suggest every class found in any stylesheet. With hierarchical selectors (`div .text`), a class is only *meaningful* inside a matching ancestor context. This extension restricts suggestions:

```html
<div>
  <p class="te▮">      <!-- suggests `text` from `div .text` -->
</div>
<section>
  <p class="te▮">      <!-- does NOT suggest `text` -->
</section>
```

### 1.2 Goals

1. Parse all CSS in the workspace into per-class *ancestor requirement* records.
2. At a `class` attribute value, compute the element's statically known context (tag, id, ancestor path, preceding siblings).
3. Offer a class iff at least one of its rules matches the context.
4. Work in plain HTML, Vue and Svelte templates, and JSX/TSX `className` attributes.
5. Never block the extension host: indexing is background/chunked, completion is O(classes × depth) with no parsing on the completion path.

### 1.3 Non-goals (v1)

Cascade/specificity resolution; dynamic classes (Vue `:class`, Svelte `class:foo`/`{expr}`, JSX `{expr}`); CSS-in-JS and CSS Modules name mapping; evaluating `:not()`, `:is()`, `:where()`, attribute selectors, `:has()`, `@scope`; resolving remote `@import`; SCSS/LESS source parsing (only compiled CSS); go-to-definition/hover/validation (future work).

### 1.4 Prior art

`zignd.html-css-class-completion` and `ecmel.vscode-html-css` perform flat class-name completion without hierarchy filtering. This extension's differentiator is context-aware filtering.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Compound** | A consecutive run of simple selectors with no combinator, e.g. `div.card.wide`. Conditions apply to one element. |
| **Combinator** | `descendant` (whitespace), `child` (`>`), `adjacent` (`+`), `general` (`~`). |
| **Subject** | The rightmost compound of a selector; the element the completed class is placed on. |
| **Ancestor requirement** | A compound to the left of the subject plus the combinator connecting it to the element on its right. |
| **Rule** | Compiled form of one selector for one subject class (see §3, §4). |
| **Path** | Static ancestor chain of the element being edited: `path[0]` = parent, `path[1]` = grandparent, … |
| **Origin** | `global` (CSS file, import) or `inline` (a `<style>` block, valid only in that document). |

---

## 3. Data model

All types in `src/css/selectorModel.ts` are plain TS (no `vscode` import) so they are unit-testable.

```ts
export type Combinator = 'descendant' | 'child' | 'adjacent' | 'general';

export interface Compound {
  tag?: string;            // lowercased; undefined = no tag constraint
  id?: string;             // exact match; undefined = no constraint
  classes: string[];       // exact, case-sensitive; empty = no constraint
  universal: boolean;      // true for `*`, or when all parts were stripped (pseudo/attr-only)
}

export interface AncestorRequirement {
  compound: Compound;
  combinator: Combinator;  // relation to the element matched by the requirement on its right
                           // (for index 0: relation to the subject element)
}

export interface SourceRange {
  start: { line: number; character: number };  // 0-based, VS Code convention
  end:   { line: number; character: number };
}

export interface ClassRule {
  className: string;
  subject: Compound;
  ancestors: AncestorRequirement[];  // [0] = compound immediately left of subject
  sourceUri: string;                 // uri.toString()
  range: SourceRange;                // whole-rule range (selector + block) as reported by postcss;
                                     // all ClassRules from one comma-list share it (per-selector range is future work)
  selectorText: string;              // original selector text of this list entry
  origin: 'global' | 'inline';
  documentUri?: string;              // present iff origin === 'inline'
}

export interface ImportRef {
  specifier: string;                 // e.g. "./base.css"
  fromUri: string;                   // importer (uri.toString())
  sourceUri: string;                 // resolved absolute uri.toString()
  range: SourceRange;                // @import at-rule position
}

export interface ParsedSource {
  uri: string;                       // file/document uri.toString()
  version: number;                   // doc.version or file mtimeMs
  rules: ClassRule[];
  imports: ImportRef[];
  styleBlocks?: { startOffset: number; endOffset: number; css: string }[]; // HTML/Vue/Svelte
}
```

**Example compilation** — `ul li.card > .text`:

```ts
{
  className: 'text',
  subject:   { tag: undefined, id: undefined, classes: ['text'], universal: false },
  ancestors: [
    { compound: { tag: 'li', classes: ['card'], universal: false }, combinator: 'child' },
    { compound: { tag: 'ul', classes: [], universal: false },       combinator: 'descendant' },
  ],
  selectorText: 'ul li.card > .text', origin: 'global', ...
}
```

---

## 4. Selector compilation (`src/css/parseCss.ts`)

### 4.1 API

```ts
export function parseCss(
  css: string,
  sourceUri: string,
  opts: { origin: 'global' | 'inline'; documentUri?: string }
): { rules: ClassRule[]; imports: ImportRef[] };
```

Synchronous, no I/O. Import resolution happens later (§8.3) so this function stays pure.

### 4.2 Pipeline

1. `postcss.parse(css, { from: sourceUri })`. On `CssSyntaxError`: throw a typed `ParseFailure` (caller handles, §8.5). Do not attempt partial recovery.
2. `root.walkRules(rule => …)`. `walkRules` already descends into at-rules. Before processing a rule, walk `rule.parent` chain; **skip the rule if any ancestor is a `rule` node** (native CSS nesting): postcss exposes `.foo { .bar {} }` as an ordinary rule with an implicit `&`, and compiling `.bar` as top-level would be a miscompile, not a miss. Also skip if any ancestor at-rule name (lowercased, without `@`) is in `SKIP_AT_RULES`.
   - `SKIP_AT_RULES = ['keyframes','-webkit-keyframes','-moz-keyframes','font-face','page','counter-style','font-feature-values','property','viewport','-ms-viewport']`
   - All other at-rules (`media`, `supports`, `layer`, `container`, `scope`, unknown) do not affect matching; their nested rules are processed normally.
3. Parse `rule.selector` with `postcss-selector-parser`:

   ```ts
   const selRoot = selectorParser().astSync(rule.selector);
   for (const sel of selRoot.nodes) { /* each `sel` is one comma-separated selector */ }
   ```

4. **Split `sel.nodes` into compounds/combinators.** Start a new compound array on `type === 'combinator'`; normalize the combinator:
   - trim `node.value`; `''`/`' '` → `descendant`; `'>'` → `child`; `'+'` → `adjacent`; `'~'` → `general`; anything else (named combinators like `/deep/`) → skip this selector.
   - A leading combinator (relative selector) → skip this selector.
5. **Map simple-selector nodes into compound fields:**

   | node type | effect |
   |---|---|
   | `tag` | `tag = value.toLowerCase()` |
   | `class` | push `value` into `classes` |
   | `id` | `id = value` |
   | `universal` | `universal = true` |
   | `pseudo` | **ignore node and its subtree entirely** (this is how `:hover`, `::before`, `:not(...)`, `:is(...)`, `:where(...)` are dropped) |
   | `attribute` | ignore; if the compound has no remaining parts, keep `universal = true` |
   | `nesting` (`&`) | **skip the whole selector** (unflattened CSS nesting unsupported) |
   | `comment` | ignore |
   | `string` | ignore (only occurs inside attributes) |

6. **Subject compound = the rightmost compound of the selector.** If it contains no `class`, skip the whole selector: `.a div` and `div .a > p` yield no rules (no class can be completed from them). Otherwise emit one `ClassRule` per distinct class in the subject; classes in non-rightmost compounds only constrain ancestors.
7. Emit one `ClassRule` per distinct class in the subject compound (so `div .a.b` emits rules for `.a` and `.b`, both with subject `a.b`).
8. `range` from `rule.source.start`/`rule.source.end` (postcss is 1-based line, 1-based column → subtract 1 from each). This is the whole rule including its block; every list entry of the same rule shares it. `selectorText = sel.toString().trim()`.
9. **Dedupe within file**: key `className + '\u0000' + selectorText + '\u0000' + subject/ancestors signature`.

### 4.3 `@import` extraction

For each `atRule.name.toLowerCase() === 'import'`, accept only local file specifiers:

```
/^\s*(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"()\s]+))\s*\)?/u
```

- Reject if specifier matches `/^(?:[a-z]+:|\/\/|data:)/i` or contains `#`.
- Store `ImportRef` with the specifier; resolution to absolute URIs is in §8.3.
- Media query text after the specifier is ignored (imported rules are always active, consistent with `@media` handling).
- For `origin:'inline'` (a `<style>` block), `ImportRef.fromUri` is the *containing document* URI, and resolution is relative to the document's directory — this matches HTML `<style>` base-URL behavior and Vue/Svelte build tooling.

### 4.4 Edge cases (must be covered by unit tests)

- `.text` → ancestors `[]`, subject tag/id undefined.
- `div.text` → subject tag `div`, class `text`; subject class not enforced at match time (§7.3).
- `.a, .b` → two independent selectors.
- `.a, .b p` → only `.a` yields a rule (rightmost compound `p` has no class).
- `.a div` / `div .a > p` → no rules (rightmost compound has no class).
- `.foo { .bar {} }` → no rules (native nesting: the inner rule has a `rule` ancestor).
- `div .text, section .text` → two rules for `text` (union semantics).
- `.foo\:bar` (Tailwind variant) → `className === 'foo:bar'`; escapes use the parser's decoded `value`.
- `[data-x] .text` → ancestor compound `universal` (attribute stripped).
- `.a:hover .text` → ancestor `.a` (pseudo stripped), not universal.
- `.a > * .text` → universal child compound, then `.a` descendant.
- `@media (min-width: 40em) { div .text {} }` → parsed, no media effect.
- `@keyframes x { from { opacity: 0 } }` → no rules, no parse attempt on `from`.
- `&:hover` / `& .text` → skipped.
- Malformed selector → `postcss-selector-parser` throws: catch per-selector, log, continue with other rules in the file.

---

## 5. Document analysis: HTML-like sources (`src/html/`)

We implement a **custom tolerant scanner** instead of `vscode-html-languageservice` because the latter does not expose preceding siblings, is intolerant of half-typed documents, and pulls in a large dependency. The scanner is pure TS, unit-testable, and reused for HTML, Vue, and Svelte.

### 5.1 API

```ts
export interface ElementSnapshot {
  tag: string;                              // lowercase
  id?: string;
  classes: ReadonlySet<string>;
  parentChildren: readonly ElementSnapshot[];  // shared sibling list, document order
  indexInParent: number;                    // position inside parentChildren
}

export interface ClassAttributeContext {
  partial: string;              // current whitespace-delimited token under cursor
  range: SourceRange;           // replace range of `partial`
  subjectTag?: string;          // undefined if tag name is incomplete/unknown
  subjectId?: string;           // static id= on the same start tag, if any
  path: ElementSnapshot[];      // [0] = parent
  subjectParentChildren: readonly ElementSnapshot[];
  subjectIndexInParent: number;
}

export interface DocumentAnalysis {
  version: number;
  contextAt(offset: number): ClassAttributeContext | undefined;
  styleBlocks: { startOffset: number; endOffset: number; css: string }[];
}

export function analyzeHtmlDocument(
  text: string,
  language: 'html' | 'vue' | 'svelte'
): DocumentAnalysis;
```

`parentChildren` is a shared array per parent, giving O(n) total memory and O(1) access to preceding siblings (`parentChildren[i-1]` for `+`, scan `0..i-1` backwards for `~`).

The builder parses the whole document once (snapshots + style blocks) and is the cacheable unit of §5.3; `contextAt(offset)` is O(depth) and may be called repeatedly for the same version. A one-shot `analyzeHtml(text, offset, language)` wrapper (`analyzeHtmlDocument(...).contextAt(offset)`) is optional.

### 5.2 Scanner states

`text`, `tagOpen` (`<`), `endTagOpen` (`</`), `tagName`, `beforeAttr`, `attrName`, `afterAttrName`, `beforeAttrValue`, `attrValueQuoted`, `attrValueUnquoted`, `comment` (`<!-- … -->`), `doctype`, `rawText` (inside `script`, `style`, `textarea`).

Rules:

- Track element stack; on open tag completion push unless void or self-closing. Void set: `area base br col embed hr img input link meta param source track wbr`. `/>` closes a non-void element only in `vue`/`svelte` mode; in `html` mode it is ignored for non-void elements (HTML spec), so `<div/>` keeps the div open.
- On `</name>`: pop until matching tag (case-insensitive); if no match, ignore.
- On `>` inside quoted attr value: not a tag end. On unquoted attr value: `>` ends both value and tag.
- `script` content is skipped entirely (allows `<` in strings). `style` content is skipped for structure and captured as an inline style block (§8.2). `textarea` content is skipped.
- Attribute parsing: name is case-insensitive; `class` matches for HTML/Vue/Svelte. `className` is handled only by the JSX analyzer (§6).
- Cursor inside a `class` value:
  - value bounds from quote or unquoted terminators;
  - `partial` = maximal run of characters around the cursor not in `{whitespace, '"', "'", '>', '<', '=', '`'}` clamped to value bounds;
  - `range` spans `partial`; if empty, an empty range at the cursor;
  - `subjectTag` = the start tag's parsed name (the whole start tag is parsed before context is queried); `undefined` only for malformed input where no tag name could be parsed (e.g. `< class="▮">`);
  - `subjectId` = static `id` attribute value **anywhere on that start tag** (attribute order does not matter; first duplicate wins); dynamic attributes (`:id`, `v-bind:id`, `{…}`) → `undefined`.
- Implied end tags (best effort): opening `li` closes an open `li`; `dt|dd` close each other; `tr` closes `tr` and `td|th`; `td|th` close `td|th`; `option` closes `option`; `p` closes an open `p` when one of these start tags opens: `address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre search section table ul`. Document the subset in code comments.
- No implicit `html`/`body`/`head` synthesis: markup is modeled exactly as written; fixtures that exercise `html body .text` must be full documents.
- Raw-text scan boundaries are case-insensitive.

### 5.3 Caching

`DocumentAnalysis` is cached per `(document.uri, document.version)` in a `WeakMap`/`Map`; recomputed on first completion after a change (documents are ≤ ~1 MB; scan is < 5 ms. No incremental scanner needed).

### 5.4 Vue and Svelte

- **Vue:** run the HTML scanner over the whole `.vue` file. `<script>` is skipped as raw text, `<style>` is captured, `<template>` content is scanned as normal markup. Dynamic `:class`/`v-bind:class` values are not `class` attributes → no completions inside them.
- **Svelte:** same scanner; `{…}` expression spans inside attribute values mean the attribute is treated as dynamic and skipped if the cursor is inside the expression; virtual `{#if}`/`{:else}` blocks are plain text and do not affect nesting. `class:foo` directives never enter an element's class set, so an element carrying `class:active` does not satisfy an `.active` ancestor requirement (documented false negative).

### 5.5 Style block capture

For HTML/Vue/Svelte documents, every `<style>` block is captured with `startOffset`/`endOffset` of its content and its `css`. It is parsed via `parseCss` with `origin:'inline'`, `documentUri = document.uri.toString()`, and the offsets added to the ranges.

---

## 6. Document analysis: JSX/TSX (`src/html/jsxContext.ts`)

### 6.1 API

```ts
export function analyzeJsxDocument(
  text: string,
  fileName: string
): DocumentAnalysis;
```

Returns the same `DocumentAnalysis` shape as §5.1 with `styleBlocks: []`; it is the cacheable unit for TSX files, and `contextAt(offset)` may be called repeatedly for the same version.

### 6.2 Implementation

1. `ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TSX)` (dependency: `typescript`).
2. Find the innermost node with `node.pos <= cursorOffset <= node.end`; iterate children to descend.
3. Accept only:
   - `JsxAttribute` with name `className` and initializer `StringLiteral`, cursor inside the literal (range = literal content, quotes excluded), **or**
   - initializer `JsxExpressionContainer` wrapping a single `StringLiteral` (i.e. `className={"a b"}`), cursor inside the literal.
4. Compute `partial`/`range` the same way as §5.2.
5. Build `path`: walk parents from the attribute's `JsxElement`/`JsxSelfClosingElement` upward. Each ancestor JSX element becomes an `ElementSnapshot` with:
   - tag: `JsxTagNameExpression` text;
   - classes: static `className` string split on whitespace (dynamic ones → empty set);
   - id: static `id` string literal if present;
   - **capitalized tags (components) are skipped entirely** (not pushed into `path`); their rendered DOM is unknowable, so hierarchy chains do not cross component boundaries (documented).
6. **Sibling combinators never match in JSX, at any level.** Every snapshot built here — subject and ancestors — gets `parentChildren: []`, `indexInParent: 0`, so the matcher naturally fails `+`/`~` requirements. Rationale: JSX sibling order only approximates DOM sibling order (components may render wrappers), and strict mode prefers false negatives. Do not special-case.

### 6.3 Scope

Language IDs `javascriptreact` and `typescriptreact` only. Plain `.js`/`.ts` files are not scanned for JSX.

---

## 7. Matching (`src/match/matcher.ts`)

### 7.1 API

```ts
export function matches(rule: ClassRule, ctx: ClassAttributeContext): boolean;
```

Pure, no `vscode`, no mutation.

### 7.2 Algorithm

```
matches(rule, ctx):
  if !subjectMatches(rule.subject, ctx) return false
  pathIdx = 0                       // invariant: index in ctx.path of the PARENT of the current anchor
  anchor  = subjectAnchor(ctx)      // { parentChildren: ctx.subjectParentChildren,
                                    //   indexInParent: ctx.subjectIndexInParent }
  for req of rule.ancestors:        // nearest-first
    found = undefined
    switch req.combinator:
      case descendant:
        for i = pathIdx .. ctx.path.length - 1:
          if compoundMatches(req.compound, ctx.path[i]):
            found = ctx.path[i]; pathIdx = i + 1; break
      case child:
        if pathIdx < ctx.path.length && compoundMatches(req.compound, ctx.path[pathIdx]):
          found = ctx.path[pathIdx]; pathIdx = pathIdx + 1
      case adjacent:
        i = anchor.indexInParent - 1
        if i >= 0 && compoundMatches(req.compound, anchor.parentChildren[i]):
          found = anchor.parentChildren[i]
      case general:
        for i = anchor.indexInParent - 1 down to 0:
          if compoundMatches(req.compound, anchor.parentChildren[i]):
            found = anchor.parentChildren[i]; break
    if !found return false
    anchor = found
  return true
```

**Correctness invariant** (why `pathIdx` need not change on sibling matches): the parent of a matched sibling equals the parent of the previously matched element, so `pathIdx`, which points at that parent, remains valid for subsequent `descendant`/`child` requirements. Add a comment with this invariant and unit tests for mixed chains such as `main .a > .b + .c .text` and `.a > .b + .c`.

### 7.3 Primitive predicates

```ts
function compoundMatches(c: Compound, el: ElementSnapshot): boolean {
  if (c.tag && c.tag !== el.tag) return false;       // el.tag is already lowercase
  if (c.id && c.id !== el.id) return false;
  for (const cls of c.classes) if (!el.classes.has(cls)) return false;
  return true;
}

function subjectMatches(subject: Compound, ctx: ClassAttributeContext): boolean {
  if (subject.tag && ctx.subjectTag && subject.tag !== ctx.subjectTag) return false;
  if (subject.id  && ctx.subjectId  && subject.id  !== ctx.subjectId)  return false;
  return true;   // subject.classes deliberately NOT enforced: they are being typed
}
```

- Unknown **subject** tag/id (undefined) ⇒ wildcard, not a failure — the user may still be typing them.
- For **ancestors**, a missing `id` is a known absence: `#main .text` does not match `<main>` without `id="main"`. Dynamic ids (`:id`, `v-bind:id`, JSX `id={x}`) are also treated as absent in v1 (see §15).
- `compoundMatches` ignores `universal` (already encoded as empty constraints).

### 7.4 Acceptance matrix (exact expected results)

Cursor position is marked `▮`.

| Selector | Context (element being edited in **bold**) | Result |
|---|---|---|
| `div .text` | `<div><p class="**▮**">` | match |
| `div .text` | `<section><p class="**▮**">` | no match |
| `div .text` | `<div class="x"><span><p class="**▮**">` | match |
| `div > .text` | `<div><span><p class="**▮**">` | no match |
| `div > .text` | `<div><p class="**▮**">` | match |
| `.a.b .text` | `<p class="a b"><span class="**▮**">` | match |
| `.a.b .text` | `<p class="a"><span class="**▮**">` | no match |
| `div + .text` | `<div></div><p class="**▮**">` | match |
| `div + .text` | `<div></div><span></span><p class="**▮**">` | no match |
| `div ~ .text` | `<div></div><span></span><p class="**▮**">` | match |
| `ul li .text` | `<ul><li><p class="**▮**">` | match |
| `ul li .text` | `<ul><p class="**▮**">` | no match |
| `.text` | anywhere | match |
| `div .text, section .text` | `<section><p class="**▮**">` | match |
| `div.text` | `<div class="**▮**">` | match |
| `div.text` | `<span class="**▮**">` | no match |
| `#main .text` | `<main id="main"><p class="**▮**">` | match |
| `#main .text` | `<main id="other"><p class="**▮**">` | no match |
| `#main .text` | `<main><p class="**▮**">` (no id attr) | no match (missing id is a known absence) |
| `.a:hover .text` | `<p class="a"><span class="**▮**">` | match (pseudo ignored) |
| `[data-x] .text` | `<p><span class="**▮**">` | match (attr ignored) |
| `.a:not(.b) .text` | `<p class="a b"><span class="**▮**">` | match (documented limitation) |
| `main .a > .b + .c .text` | `<main><section class="a"><b class="b"></b><i class="c"><p class="**▮**">` | match |
| `* .text` | `<p><span class="**▮**">` | match |
| `html body .text` | `<html><body><p class="**▮**"></p></body></html>` | match (full document; no implicit tag synthesis) |

---

## 8. Index (`src/index/`)

### 8.1 State

```ts
export interface ClassMatch {
  className: string;
  best?: ClassRule;        // highest-ranked matching rule; undefined if none matched
  matching: ClassRule[];   // matching rules applicable to this document
  applicable: ClassRule[]; // all applicable rules (origin filter passed)
}

class WorkspaceIndex {
  private byUri = new Map<string, ParsedSource>();
  private byClass = new Map<string, ClassRule[]>();          // all rules, global + inline
  private classNamesByUri = new Map<string, Set<string>>();  // reverse index for O(1) eviction
  private importGraph = new Map<string, Set<string>>();      // resolved imports per file
  private folderIndex = new Map<string /*folderUri*/, WorkspaceIndex>(); // multi-root
}
```

Operations:

- `apply(parsed: ParsedSource)`: evict only this source's rules (looked up via `classNamesByUri`), drop now-empty `byClass` buckets, then insert the new rules and refresh `classNamesByUri`. Buckets are shared across sources — never clear a class bucket wholesale.
- `remove(uri)`: alias for `apply` with empty rules.
- `query(ctx: ClassAttributeContext, documentUri: string, opts: { includeNonMatching: boolean }, token?): ClassMatch[]`:

  ```
  for (className, rules) of byClass:
    best = undefined
    matching = []
    applicable = []
    for rule of rules:
      if rule.origin === 'inline' && rule.documentUri !== documentUri: continue
      applicable.push(rule)
      if matches(rule, ctx):
        matching.push(rule)
        if best === undefined || rank(rule) > rank(best): best = rule
    if best: results.push({ className, best, matching, applicable })
    else if opts.includeNonMatching && applicable.length:
      results.push({ className, matching: [], applicable })
  return results
  ```

  **Do not prefilter on `ctx.partial`.** VS Code performs case-insensitive, fuzzy filtering via `filterText`, so a case-sensitive `startsWith` filter would drop valid matches (e.g. `txt` → `text`, `Te` → `text`). The matcher is cheap; filtering is the UI's job.

- `stats()`: counts for the `showIndexStats` command.

`rank(rule) = min(rule.ancestors.length + (subject.tag ? 1 : 0) + (subject.id ? 1 : 0), 9)` — used only for sort order.

### 8.2 Inline styles

When a CSS/HTML/Vue/Svelte document is parsed, each `<style>` block becomes its own `ParsedSource` keyed `documentUri + '#style:' + startOffset` with `origin:'inline'` and `documentUri` set, and its `range` fields offset by `startOffset` in line/column terms (compute via the document's line index; alternatively keep offsets and convert at documentation-render time — **IMPLEMENTER MAY**).

### 8.3 Import resolution

- `resolveImport(fromUri, specifier)`: `posix`-normalize `dirname(fromUri.path) + '/' + specifier`; reject if it escapes the root of the containing workspace folder; produce a `vscode.Uri`. For `origin:'inline'` rules the base is the containing document URI (§4.3).
- Parse each resolved file once (memoized by URI + mtime), recursively, with a visited set (cycle-safe) and `maxImportDepth` (default 10).
- Imported rules keep `origin:'global'` and their own `sourceUri`; range points into the imported file.
- Missing/unreadable imports: log once, no error.

### 8.4 Lifecycle

- `activate()`:
  - build the index per workspace folder;
  - start a background scan: for each glob in `cssGlobs`, call `workspace.findFiles(new vscode.RelativePattern(folder, glob), excludeGlobs)` and merge results, deduping by URI; process in chunks of 25 files; between chunks `await new Promise(r => setImmediate(r))`; cap at 5000 files per folder with a logged warning;
  - read with `vscode.workspace.fs.readFile` (works in remote/untitled contexts), decode UTF-8, strip BOM;
  - text documents that are open but not yet indexed are parsed on demand.
- `onDidChangeTextDocument` for indexed document kinds: debounce 200 ms per URI; parse from `doc.getText()` with `version = doc.version`.
- Watchers: one `createFileSystemWatcher` per glob in `cssGlobs`; create/change → reparse from disk, delete → `remove`. On each event, ignore URIs whose workspace-relative path matches any `excludeGlobs` pattern (match with `picomatch`; the watcher API has no exclude parameter). Changing `cssGlobs`/`excludeGlobs` recreates the watchers and reindexes (§10.1).
- Inline sources (`<style>` blocks) are keyed by their document URI and stay in sync: debounced reparse on edit; on `onDidCloseTextDocument`, reparse from disk if the document was clean and the file exists, otherwise remove the entries; untitled documents are analyzed for context/inline styles only in-session.
- Multi-root: each workspace folder owns an index built from its own config/globs. A completion queries `workspace.getWorkspaceFolder(document.uri)`; documents outside any folder (untitled, loose files) use a session-only index containing only open documents' inline styles.
- Commands `cssIntellisense.rebuildIndex` and `cssIntellisense.showIndexStats` registered; all disposables pushed to `context.subscriptions`.

### 8.5 Error handling

- A parse failure on update keeps the previous `ParsedSource` and records the error for the stats command (do not drop good data because of a temporarily broken file).
- Per-file try/catch; log with URI and message at most once per URI per session unless verbose.
- Files larger than `cssIntellisense.maxFileSizeKB` (default 10240) are skipped with one log line.

---

## 9. Completion provider (`src/completion/provider.ts`)

### 9.1 Registration

- One `DocumentSelector` array for the configured languages: default `html`, `vue`, `svelte`, `javascriptreact`, `typescriptreact`.
- `registerCompletionItemProvider(selector, provider, '-', '_')`. Do **not** declare `"` or space as trigger characters (space is rejected by the API; quote behavior is version-dependent).
- Auto-trigger: in `onDidChangeTextDocument`, if the last typed character is `"` or `'` and the line prefix matches (`/class\s*=\s*["']$/` for HTML/Vue/Svelte, `/className\s*=\s*["']$/` for JSX) and `triggerSuggestAfterQuote` is true, schedule `commands.executeCommand('editor.action.triggerSuggest')` via `setImmediate`. Guard with a re-entrancy flag to avoid loops.

### 9.2 Handler

```
provideCompletionItems(document, position, token):
  if !config(document).enabled: return
  if token.isCancellationRequested: return
  ctx = analysisFor(document).contextAt(offset)   // §5/§6
  if !ctx: return
  strict = config(document).strictHierarchy
  results = indexFor(document).query(ctx, document.uri.toString(),
                                     { includeNonMatching: !strict }, token)
  return results.map(postProcess).filter(Boolean)
```

`postProcess`:

- if `hideAlreadyUsedClasses`, drop candidates whose className is already a whitespace-delimited token in the attribute value (excluding the token being replaced);
- construct the `CompletionItem`:
  - `label = className`, `kind = CompletionItemKind.Class`, `insertText = className`, `filterText = className`, `range = ctx.range`;
  - `detail = selectorText + ' — ' + workspaceRelativePath(sourceUri)`;
  - `sortText = String(9 - rank(rule)).padStart(2, '0') + className.toLowerCase() + '\u0000' + className` (case-insensitive ordering, deterministic tiebreak);
  - `data = { sourceUri, range }` for `resolveCompletionItem`.
- Non-matching classes (only present when `strictHierarchy === false`; `best === undefined`, `applicable` non-empty): emit with `sortText` prefixed `'zz'` and `detail = first applicable selectorText + ' — ' + path + ' (context mismatch)'`. In strict mode they never reach `postProcess`.
- Never return duplicate labels: one item per class name; if several rules match, merge selectors into the docs.

`resolveCompletionItem`:

```ts
const md = new vscode.MarkdownString();
md.appendCodeblock(rule.selectorText, 'css');
md.appendMarkdown(`\n[${relativePath}:${line}](${commandLink})`);
md.isTrusted = { enabledCommands: ['vscode.open'] };
item.documentation = md;
```

where `commandLink = 'command:vscode.open?' + encodeURIComponent(JSON.stringify([sourceUri, { selection: range }]))`.

### 9.3 Interaction with other providers

- Return `undefined` (not `[]`) when the cursor is not in a class value, to avoid suppressing other providers.
- The built-in HTML provider and flat-class extensions may still contribute items; VS Code generally merges identical labels. The README documents this and the integration tests assert only our labels' presence/absence (not exclusivity).

---

## 10. Configuration and commands

### 10.1 Settings (`contributes.configuration`)

| Setting | Type | Default | Scope | Description |
|---|---|---|---|---|
| `cssIntellisense.enabled` | boolean | `true` | window | Master switch. |
| `cssIntellisense.cssGlobs` | string[] | `["**/*.css"]` | resource | Stylesheets to index. |
| `cssIntellisense.excludeGlobs` | string[] | `["**/node_modules/**","**/dist/**","**/build/**","**/out/**","**/.git/**"]` | resource | Excluded paths. |
| `cssIntellisense.includeInlineStyles` | boolean | `true` | window | Index `<style>` blocks. |
| `cssIntellisense.languages` | string[] | `["html","vue","svelte","javascriptreact","typescriptreact"]` | window | Where completions are offered; changing requires window reload (README note). |
| `cssIntellisense.strictHierarchy` | boolean | `true` | resource | `false` shows non-matching classes demoted. |
| `cssIntellisense.resolveImports` | boolean | `true` | resource | Follow local `@import`. |
| `cssIntellisense.maxImportDepth` | number | `10` | resource | Import recursion cap. |
| `cssIntellisense.maxFileSizeKB` | number | `10240` | resource | Skip larger CSS files. |
| `cssIntellisense.triggerSuggestAfterQuote` | boolean | `true` | window | Auto-open suggestions after typing `class="`. |
| `cssIntellisense.hideAlreadyUsedClasses` | boolean | `true` | window | Skip classes already in the attribute. |
| `cssIntellisense.trace` | `"off"\|"messages"\|"verbose"` | `"off"` | window | Output channel verbosity. |

Runtime `workspace.getConfiguration('cssIntellisense', documentUri)` is read per completion and per index mutation; changing `cssGlobs`/`excludeGlobs` recreates watchers and reindexes via `onDidChangeConfiguration`; other settings take effect on the next read.

### 10.2 Commands and UI

- `cssIntellisense.rebuildIndex` — drops all caches, rescans.
- `cssIntellisense.showIndexStats` — prints files, rules, classes, inline rules, parse errors, last scan duration.
- Optional status bar item showing `CSS ⟨N⟩` (**IMPLEMENTER MAY**, off by default).

---

## 11. Performance requirements

| Operation | Budget |
|---|---|
| Completion (10k classes, 20 levels, 100 KB document) | ≤ 50 ms p95, excluding VS Code UI |
| HTML document scan | ≤ 5 ms per 100 KB, cached per document version |
| CSS file parse | ≤ 10 ms per typical file; chunked background scan never blocks > 50 ms |
| Initial scan, 1000 files | ≤ 2 s wall clock, non-blocking |
| Memory | ≤ 1 KB per rule; warn in stats above 200k rules |

Rules: no CSS parsing inside `provideCompletionItems`; the import resolver is memoized; `byClass` iteration is the only completion-loop cost.

---

## 12. Testing

### 12.1 Unit tests (host, vitest)

- Pure modules (`parseCss`, `matcher`, `analyzeHtmlDocument`, `analyzeJsxDocument`, import resolver core, config defaults) import no `vscode` APIs.
- Table-driven matcher tests: every row of §7.4 plus mixed-chain cases and the invariant tests from §7.2.
- Scanner tests: quote styles, unquoted values, cursor mid-list, empty partial, malformed HTML, omitted `</li>`, comments, `<script>` with `<div>` inside a string, `<style>` capture offsets, SVG class, case-insensitive tag/attr names, cursor in attr name (no context), `/>` in `html` vs `vue`, dynamic id treated as absent.
- Index query tests (pure query over a fixture index): case-insensitive/fuzzy partials (`Te`, `txt`) still return `text`; strict mode omits non-matching classes, `strictHierarchy:false` emits them with `zz` sort prefix.
- JSX tests: `className="a |b"`, `className={"a |b"}`, dynamic `className={x}` (no context), component ancestors, `+`/`~` never match at subject or ancestor level.
- Parser tests: all §4.4 cases, including native-nesting skip and rightmost-compound-without-class skip; a malformed selector alongside valid ones yields the valid rules and one logged error.
- Import resolver: relative paths, inline-style base URI, cycles, depth cap, remote rejection, missing file.

### 12.2 Integration tests (headless Docker, default)

```
test/integration/
  Dockerfile            # FROM mcr.microsoft.com/playwright:v1.63.0-noble
  run-docker.js         # build + run, propagates exit code
  run-host.js           # @vscode/test-electron runTests()
  suite/index.ts        # mocha runner (run(): Promise<void>)
  suite/completion.test.ts
  fixtures/workspace/   # label CSS files + HTML/Vue/Svelte/TSX fixtures
```

- Fixtures use a unique cursor marker `«cursor»`; the harness computes the offset and strips the marker before opening.
- Assertions via `vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, position)`; check label presence/absence, `range`, and `sortText` ordering; for `strictHierarchy:false`, check labels present with `zz` sort prefix.
- `launchArgs`: `['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--disable-workspace-trust']`; `extensionTestsPath`/`extensionDevelopmentPath` resolved from repo root.
- `run-docker.js`:
  1. `docker info` → if it fails: print `integration tests skipped: docker unavailable` and exit 0 unless `REQUIRE_INTEGRATION=1`.
  2. `docker build -t css-intellisense-it test/integration`.
  3. `docker run --rm -v <repo>:/work -v css-intellisense-it-nm:/work/node_modules -v css-intellisense-it-vscode:/root/.vscode-test -w /work css-intellisense-it bash -lc "npm ci --no-audit --no-fund && xvfb-run -a npm run test:integration:suite"`.
  4. Forward the exit code.
- npm scripts:

  ```jsonc
  "compile": "node esbuild.js",
  "test:unit": "vitest run",
  "test": "npm run compile && npm run test:unit",
  "test:integration:suite": "npm run compile && node ./test/integration/run-host.js",
  "test:integration": "node ./test/integration/run-docker.js",
  "test:integration:host": "npm run compile && xvfb-run -a node ./test/integration/run-host.js",
  "lint": "eslint src test",
  "typecheck": "tsc --noEmit",
  "package": "vsce package"
  ```

- CI (GitHub Actions): `unit` matrix ubuntu/macos/windows running `npm ci && npm run typecheck && npm run test:unit`; `integration` on ubuntu-latest running `xvfb-run -a npm run test:integration:host` (runners have Xvfb + all libs); optional Docker job mirroring `test:integration`.

### 12.3 Manual verification (not required in this environment)

F5 Extension Development Host, open `test/integration/fixtures/workspace/index.html`, type inside `class="…"`.

---

## 13. Project layout, build, dependencies

```
.vscode/launch.json, tasks.json
src/
  extension.ts                  # activate/deactivate, wiring, commands
  config.ts                     # read/validate settings
  log.ts                        # OutputChannel, trace levels
  css/selectorModel.ts
  css/parseCss.ts
  css/importResolver.ts
  index/workspaceIndex.ts
  index/fileLoader.ts           # reads/debounces, mtime+version
  html/analyzeHtml.ts           # scanner (§5)
  html/jsxContext.ts            # (§6)
  match/matcher.ts              # (§7)
  completion/provider.ts        # (§9)
test/
  unit/*.test.ts
  integration/{Dockerfile,run-docker.js,run-host.js,suite/**,fixtures/**}
esbuild.js  package.json  tsconfig.json  vitest.config.ts  eslint.config.js
SPEC.md  README.md  CHANGELOG.md  LICENSE
```

- **Build**: esbuild bundles to `dist/extension.js` (`platform: node`, `format: cjs`, `external: ['vscode']`, `target: 'node20'`, sourcemap). `typescript` is bundled because the extension host does not provide it, so expect a multi-MB bundle (~10 MB); **IMPLEMENTER MAY** split it into a lazily-imported chunk if size becomes a problem.
- **Runtime deps**: `postcss` (^8), `postcss-selector-parser` (^7), `typescript` (^5; runtime + bundled only, listed here and not under dev deps), `picomatch` (^4; `excludeGlobs` matching for watcher events). No native modules.
- **Dev deps**: `@types/vscode ^1.90`, `@types/node ^20`, `@types/mocha`, `esbuild`, `typescript`, `vitest`, `mocha`, `@vscode/test-electron ^3`, `@vscode/vsce`, `eslint ^9` (flat config), `typescript-eslint ^8`.
- **package.json essentials**: `"main": "./dist/extension.js"`, `"engines": { "vscode": "^1.90.0" }`, `"extensionKind": ["workspace"]`, activation events:

  ```jsonc
  ["onLanguage:html","onLanguage:vue","onLanguage:svelte",
   "onLanguage:javascriptreact","onLanguage:typescriptreact",
   "onCommand:cssIntellisense.rebuildIndex","onCommand:cssIntellisense.showIndexStats"]
  ```

  (`workspaceContains:**/*.css` is deliberately omitted: indexing starts when a supported editor opens, keeping activation light.)

---

## 14. Milestones and exit criteria

| # | Deliverable | Exit criteria (all automated) |
|---|---|---|
| M1 | Extension skeleton; `parseCss`; HTML scanner; matcher; provider for `html` | §7.4 rows for HTML pass in unit + integration; `npm run typecheck`, `npm run lint`, `npm run test:unit` green |
| M2 | Index lifecycle, watchers, imports, inline styles, config, commands | unit tests for imports/scanner/caching; integration for inline scoping and config toggles |
| M3 | Vue + Svelte analysis | integration fixtures for `.vue`/`.svelte` including component `<style>` scoping |
| M4 | JSX/TSX | §6 unit tests + TSX integration |
| M5 | Docker harness, CI, README, `.vsix` | `npm run test:integration` green on this machine; `vsce package` produces an installable VSIX |

Definition of done for the project: all §7.4 acceptance rows pass in integration tests on a clean checkout using only `npm ci` + Docker.

---

## 15. Risks, limitations, future work

| Risk / limitation | Mitigation |
|---|---|
| Docker image pull ≈ 1.5 GB | Persistent named volumes; host-Xvfb fallback documented; unit tests don't need Docker. |
| Container networking for `npm ci` | Mount host `node_modules` instead if registry is blocked. |
| Auto-trigger after quote is a workaround | Guarded, configurable, Ctrl+Space always works. |
| Duplicate items with built-in/HTML-class extensions | Verified in integration tests that our labels appear; README documents overlap; `filterText` adjustable. |
| Workspace-wide index yields cross-project false candidates | Strict matching mitigates; link-scoped mode (only `<link>`-reachable CSS) is planned. |
| Pseudo/attr/`:not()` ignored → false positives | Documented; §7.4 rows encode the behavior. |
| JSX hierarchy ≠ runtime DOM across components | Chains stop at components; documented; flat classes unaffected. |
| Implied-end-tag subset incomplete | Tests for common cases (`li`, `p`, `td`); scanner is best-effort. |
| Dynamic ids (`:id`, `v-bind:id`, JSX `id={x}`) treated as absent | Strict static analysis in v1; documented; avoids `#id` ancestor false positives. |
| Svelte `class:foo` not modeled | Conditional class; documented false negative when such an element must satisfy `.foo` as an ancestor. |
| JSX `+`/`~` never match | Sibling order across components is unreliable; strictness over approximation. |
| No implicit `html`/`body`/`head` synthesis | Markup modeled as written; full-document fixtures required for those tags. |
| Native CSS nesting, `@scope`, rightmost-compound-without-class selectors | Skipped rather than miscompiled (§4.2). |
| Minified single-line CSS yields coarse ranges | Acceptable; docs link uses the rule start. |

Future: link-scoped indexing, `:is()`/`:where()` expansion, `:not()` negation, go-to-definition for classes, "no matching ancestor" diagnostic/quick-fix, SCSS/LESS.

---

## Appendix A — Verified environment (this machine)

| Check | Result |
|---|---|
| OS / virt | Ubuntu 24.04.4 LTS, KVM guest, 4 cores, 7.8 GiB RAM, 39 GB free |
| Node / npm | v26.8.1 / 11.19.0 (nvm) |
| Toolchain | vitest 5 (engines `^22.12 \|\| ^24 \|\| >=26`), mocha 12 (`>=22`), @vscode/test-electron 3.1 (`>=22`) — all support Node 26 |
| Network | npm registry 200, VS Code update server 200, Docker Hub 401 (reachable), MCR 200 |
| Docker | 29.7.2 client+server, overlayfs, cgroup v2; user in `docker` group; buildx 0.36.1; no cached images |
| Headless | No host Xvfb/VNC/Wayland/xpra; `mcr.microsoft.com/playwright:v1.63.0-noble` provides Node + Chromium libs + `xvfb-run` |
| Host fallback packages | `xvfb libgbm1 libasound2t64 libxss1 libxshmfence1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxtst6 libx11-xcb1 libdrm2` — all have archive candidates; `sudo` passwordless |
