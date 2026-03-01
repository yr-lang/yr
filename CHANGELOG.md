# Changelog

## [0.2.0] - 2026-03-01

### Fixed

- **Wrapper-only section closure** — Sections containing nested wrappers no longer require an
  explicit `_` to close. The parser now correctly closes open layers when a wrapper is terminated
  by indentation, producing balanced HTML in all nesting scenarios. Resolves the issue documented
  in `BUGS.md`.

- **Multiple wrapper closure on a single line** — When an element's indentation requires closing
  more than one wrapper at once, the parser now closes all of them (changed `if` to `while` in
  the html parser wrapper check). Previously only the innermost wrapper was closed, causing
  sibling elements to be rendered inside the wrong wrapper.

- **Section change leaves wrappers open** — When a namespace token (e.g. `><` → `##`) was
  encountered while one or more wrappers were active, only the outermost wrapper was cleaned up
  via `shift()`. Now all open wrappers are properly closed innermost-first.

- **Closing tag indentation** — `getWhiteSpace()` was designed to receive a hierarchy level but
  was called with a raw character-count indentation, producing increasingly wrong whitespace for
  deeper elements. Closing tags now mirror the indentation of their opening tags.

- **`throw -1` loses file/project context** — A stray semicolon caused the error message for
  odd-indentation errors to drop the filename and project name. The `-1` error message now
  matches the `-2` error message in completeness.

- **`getElementAttributes` spurious empty key** — When an `att={{}}` block ended with a trailing
  comma, an empty string key was unconditionally added to the parsed attributes object. Now only
  added if `parseKey` is non-empty.

- **Self-importing wrapper causes infinite recursion** — A wrapper that listed itself via `!!`
  in its own `++` section would loop indefinitely. The extension is now registered in
  `sections.extensions` before its content is parsed, so the guard fires correctly on
  re-entry.

- **Wrapper without `++` section does not invoke JS function** — A wrapper that had a
  `_@wrapper(Category, Option)` function in `@>` but no `++` body would have its div created
  but the JS function never called. The `wrapperjs` entry is now added independently of whether
  a `++` section exists.

## [0.1.1] - prior

Initial public releases.
