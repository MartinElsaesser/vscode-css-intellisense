# Changelog

## 0.0.1

- Initial release.
- Workspace-wide CSS indexing (files, inline `<style>`, local `@import`) with
  atomic per-document replacement and import-reachability eviction.
- Hierarchy-aware matching: descendant, child, adjacent, and general sibling
  combinators; tag, `#id`, and multi-class compounds.
- Completion provider for HTML, Vue, Svelte, and JSX/TSX with strict/demoted
  modes, already-used-class filtering, and resolve-time documentation links.
- 12 settings and `rebuildIndex` / `showIndexStats` commands.
