# CSS Class Intellisense

Hierarchy-aware CSS class name completion for HTML, Vue, Svelte, and JSX/TSX.

Unlike flat class-name providers, this extension only offers a class when the
selector's ancestor requirements match the element's statically known context:

```html
<div>
  <p class="te█">      <!-- suggests `text` from `div .text` -->
</div>
<section>
  <p class="te█">      <!-- does not suggest `text` -->
</section>
```

## Features

- Parses all CSS in the workspace (configurable globs) plus inline `<style>`
  blocks, and follows local `@import`s.
- Understands descendant, child (`>`), adjacent (`+`), and general (`~`)
  sibling combinators, tag and `#id` requirements, and multi-class compounds.
- Hover/inspect detail shows the matching selector and its stylesheet; the
  resolved documentation links to the rule.
- Works in plain HTML, Vue and Svelte single-file components, and JSX/TSX
  `className` attributes.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `cssIntellisense.enabled` | `true` | Master switch. |
| `cssIntellisense.cssGlobs` | `["**/*.css"]` | Stylesheets to index. |
| `cssIntellisense.excludeGlobs` | `["**/node_modules/**","**/dist/**","**/build/**","**/out/**","**/.git/**"]` | Excluded paths. |
| `cssIntellisense.includeInlineStyles` | `true` | Index `<style>` blocks. |
| `cssIntellisense.languages` | `["html","vue","svelte","javascriptreact","typescriptreact"]` | Where completions are offered; changing requires a window reload. |
| `cssIntellisense.strictHierarchy` | `true` | When `false`, non-matching classes are shown demoted. |
| `cssIntellisense.resolveImports` | `true` | Follow local `@import`. |
| `cssIntellisense.maxImportDepth` | `10` | Import recursion cap. |
| `cssIntellisense.maxFileSizeKB` | `10240` | Skip larger CSS files. |
| `cssIntellisense.triggerSuggestAfterQuote` | `true` | Open suggestions right after typing `class="`. |
| `cssIntellisense.hideAlreadyUsedClasses` | `true` | Skip classes already present in the attribute. |
| `cssIntellisense.trace` | `"off"` | Output channel verbosity (`off`, `messages`, `verbose`). |

Commands: `CSS Intellisense: Rebuild Index` and `CSS Intellisense: Show Index Stats`.

## Notes and limitations

- Indexing is workspace-wide. Strict matching keeps unrelated classes out, but
  classes defined for another page in the same workspace can still be offered
  when the hierarchy happens to match. Link-scoped indexing is planned.
- Because VS Code merges completion providers, the built-in HTML provider or
  flat class-name extensions may still contribute items alongside this one.
- Pseudo-classes, `:not()`/`:is()`/`:where()`, and attribute selectors are
  ignored for matching; `[data-x] .text` is treated like `* .text`.
- Dynamic classes (`:class`, Svelte `class:foo`/expressions, JSX `{expr}`) are
  not modeled. JSX chains stop at components, and sibling combinators never
  match in JSX because component-rendered DOM structure is unknowable.
- Native CSS nesting, `@scope`, and rightmost compounds without a class are
  skipped rather than mis-compiled.
- Auto-triggering after typing a quote is a workaround; Ctrl+Space always works
  and the behavior can be disabled with `cssIntellisense.triggerSuggestAfterQuote`.

## Development

```sh
npm ci
npm run typecheck
npm run test:unit          # vitest, pure modules
npm run compile            # esbuild bundle -> dist/extension.js
npm run test:integration   # headless VS Code in Docker (recommended here)
npm run test:integration:host   # requires Xvfb on Linux
npm run package            # vsce package -> .vsix
npm run install:local      # package and install the VSIX into the local VS Code (requires `code` on PATH)
```

Integration tests open the fixture workspace under
`test/integration/fixtures/workspace` in a real VS Code instance and assert the
completion matrix end to end. The Docker harness installs the Vue and Svelte
language extensions into the test host so `.vue`/`.svelte` completion tests can
run.
