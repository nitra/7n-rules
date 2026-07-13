---
type: layered-translation
source: eslint.config.md
lang: en
sourceFileCrc: f886a128
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# `eslint.config.js`

## Core Idea

This document defines a centralized linting system for the monorepo using the ESLint Flat Config format. It ensures consistency of rules for JavaScript and Vue components, automatically integrating common configuration logic. The main guarantee is the correct exclusion of generated artifacts from analysis, such as coverage reports and documentation. It also ensures correct handling of specific environments by providing necessary global variables for Node.js across different file types.

## Overview

The `eslint.config.js` file is the root ESLint flat-config for the `nitra/cursor` monorepo. It sets JavaScript/Vue code linting rules by composing the common configuration from `@nitra/eslint-config` and several local overrides. The file exports an array of config objects in the ESLint Flat Config format (supported by ESLint >= 9).

The main tasks of this file are:

1. To exclude generated/side artifacts from linting (`docs/**`, `coverage`, Stryker output, `auto-imports.d.ts`, `COVERAGE.md`).
2. To include the common configuration `@nitra/eslint-config` specifying that `npm/**` is Node code, and `demo` is a Vue project.
3. To add Node globals (`globals.node`) for files `npm/**/*.mjs` and `npm/**/*.cjs`, which `@nitra/eslint-config` does not cover by default.
4. To add an exception for the `n/no-extraneous-import` rule in `npm/**/*.{js,mjs,cjs}` — allowing the import of `vitest`, `@vitest/coverage-v8`, `@stryker-mutator/vitest-runner` from the root `package.json` (via bun hoisted `node_modules`), because these packages are prohibited as devDependencies in `npm/package.json`.

## Exports / API

### `export default` (array)

The file has one named export — `default`. This is an array of four ESLint Flat Config format objects:

| Index | Object Type | Purpose |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `0`    | `{ ignores: string[] }`                                 | Global ignore patterns for all linting |
| `1..N` | `...getConfig({ node: ['npm'], vue: ['demo'] })`        | Spread array of the base `@nitra/eslint-config` configuration (number of elements determined by `getConfig`) |
| `N+1`  | `{ files, languageOptions: { globals } }`               | Adding Node globals for `npm/**/*.{mjs,cjs}` |
| `N+2`  | `{ files, rules: { 'n/no-extraneous-import': [...] } }` | Override `n/no-extraneous-import` rules for `npm/**/*.{js,mjs,cjs}` |

ESLint applies the array elements sequentially: later objects can override/augment earlier ones if their `files` pattern matches the specific file being linted.

## Functions

There are no functions declared within `eslint.config.js`. It only uses a call to the external function `getConfig` from the `@nitra/eslint-config` package and the spread operator `...` for its result.

### Calling `getConfig({ node, vue })`

- **Signature (as used here):** `getConfig(options: { node?: string[]; vue?: string[] }): FlatConfigItem[]`
- **Parameters:**
  - `node: ['npm']` — array of directory/workspace prefix names for which the base configuration enables Node mode (Node globals, `eslint-plugin-n` rules, etc.). Here, only `npm` (i.e., `npm/**/*.js` according to the comment).
  - `vue: ['demo']` — array of directory names for which the base configuration enables Vue mode (parser `vue-eslint-parser`, `eslint-plugin-vue` rules). Here, it is `demo`.
- **What it returns:** An array `FlatConfigItem[]` — ready flat-config objects that are then spread into the final export array.
- **Side effects:** None at the level of `eslint.config.js`; the internal behavior of `getConfig` is outside this file.

An important note from the comment in the file: `getConfig({ node: ['npm'] })` inside `@nitra/eslint-config` sets Node globals only for the glob `npm/**/*.js`, **not** for `.mjs` and `.cjs`. This is why there is an additional override in `eslint.config.js` that adds `globals.node` for `npm/**/*.{mjs,cjs}` (otherwise ESLint would report `no-undef` on `process` and `console`).

## Dependencies

### External npm packages (imports)

| Import | Source | Purpose |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConfig` | `@nitra/eslint-config` | Factory that generates the base array of flat-config objects for the monorepo (rules, parsers, plugins for Node/Vue) |
| `globals` | `globals` | Standard npm package with sets of global variables for different environments; here `globals.node` (`process`, `console`, `Buffer`, `__dirname`, etc.) is used |

### Implicit dependencies (via `@nitra/eslint-config`)

The base configuration `@nitra/eslint-config` brings along plugins/parsers that `getConfig` uses. These names are not explicitly imported in `eslint.config.js`, but are present through the result of `getConfig`:

- `eslint-plugin-n` — provider of the `n/no-extraneous-import` rule, which is overridden in the fourth element of the array.
- (Others — parsers for Vue, base rules, etc. — depend on the implementation of `@nitra/eslint-config`.)

### Files/Global artifacts referenced by the config

- `**/auto-imports.d.ts` — generated TypeScript file (e.g., from `unplugin-auto-import`).
- `docs/**` — documentation directory (e.g., this `docs/eslint.config.md` will be ignored).
- `.claude/worktrees/**` — protected Claude Code worktrees directory.
- `**/coverage/**` — test coverage reports.
- `**/reports/stryker/**` — Stryker mutation testing sandbox/output.
- `COVERAGE.md`, `**/COVERAGE.md` — generated coverage markdown report (contains JS-snippets).

## Execution Flow / Usage

### How ESLint applies this file

1. ESLint (via `bun run lint` or direct `eslint .` execution) looks for `eslint.config.js` in the project root (Flat Config — standard in ESLint >= 9, activated via `package.json` `type: "module"` or via `.mjs`).
2. ESLint imports the `default` export of this file — the array of config objects.
3. For every candidate file in ESLint:
   - It checks the first array element — `{ ignores: [...] }`. If the file path matches any of the global patterns, the file is completely excluded from linting.
   - Otherwise, it applies all array elements whose `files` pattern (or absence of `files`) matches the file, in order from first to last. Later rules may override earlier ones.

### Specific Scenarios

- **File `npm/foo/bar.js`** — falls under `getConfig({ node: ['npm'] })` (Node globals, `n/` rules), plus the `n/no-extraneous-import` override (permission for `vitest`/`@vitest/coverage-v8`/`@stryker-mutator/vitest-runner`).
- **File `npm/foo/bar.mjs`** — does NOT receive Node globals from `getConfig` (per comment in the file), so it receives them via the override `{ files: ['npm/**/*.{mjs,cjs}'], languageOptions: { globals: { ...globals.node } } }`. It also receives the `n/no-extraneous-import` override.
- **File `npm/foo/bar.cjs`** — behavior is identical to the `.mjs` case: Node globals via override, `n/no-extraneous-import` via override.
- **File `demo/src/App.vue`** — is linted in Vue mode (via `getConfig({ vue: ['demo'] })`). `npm/**` overrides do not affect it.
- **File `docs/eslint.config.md`** — is ignored globally by `ignores: ['docs/**']`.
- **File `COVERAGE.md`** (in the root or nested `**/COVERAGE.md`) — is ignored.
- **Files under `**/coverage/**` and `**/reports/stryker/**`** — are ignored (generated artifacts, gitignored).

### Commands Using This Config

Any ESLint run in the root of the `nitra/cursor` monorepo automatically reads `eslint.config.js`. Typical commands (per monorepo conventions):

- `bun run lint` — root alias that runs ESLint (and likely other linters) for the whole project.
- `bun run lint-js` — subcommand that lints only JavaScript/Vue.
- `eslint <path>` — direct execution.

Rules on parallelism with the root `CLAUDE.md`: launching `eslint` in parallel in different tasks/sub-agents is forbidden — one sequential run per session.

### Rebuild Test (Recreating logic from the document)

To reproduce `eslint.config.js` from this document, you need:

1. Import `getConfig` from `@nitra/eslint-config` and `globals` from `globals`.
2. Export the default array consisting of four elements:
   - **Element 1.** An object `{ ignores: [...] }` with an array of patterns: `'**/auto-imports.d.ts'`, `'docs/**'`, `'.claude/worktrees/**'`, `'**/coverage/**'`, `'**/reports/stryker/**'`, `'COVERAGE.md'`, `'**/COVERAGE.md'`.
   - **Elements 2..N.** Spread the result of `getConfig({ node: ['npm'], vue: ['demo'] })`.
   - **Element N+1.** An object `{ files: ['npm/**/*.{mjs,cjs}'], languageOptions: { globals: { ...globals.node } } }`.
   - **Element N+2.** An object `{ files: ['npm/**/*.{js,mjs,cjs}'], rules: { 'n/no-extraneous-import': ['error', { allowModules: ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner'] }] } }`.

There are no other side effects, logic execution, or module mutations — it is a declarative config.
