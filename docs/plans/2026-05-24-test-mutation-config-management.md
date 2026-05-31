# Implementation Plan: test rule manages Stryker + cargo-mutants config

**Branch/worktree:** main (user confirmed direct work on main for @nitra/cursor)
**Spec:** `docs/superpowers/specs/2026-05-24-test-rule-mutation-config-design.md`

---

## Task 1: Extract shared resolvers to `scripts/utils/`

Pull `resolveJsRoot` out of `js-lint/coverage/coverage.mjs` and `resolveCargoManifest` out of `rust/coverage/coverage.mjs` into shared utilities.

### Step 1.1: Create `scripts/utils/resolve-js-root.mjs`

Copy the existing inline `resolveJsRoot` function from `npm/rules/js-lint/coverage/coverage.mjs` (lines ~18–31) into a new file, export it.

**Files:**
`npm/scripts/utils/resolve-js-root.mjs` — NEW: exports `resolveJsRoot(cwd): Promise<string|null>`

**Verification:**

- File exists at `npm/scripts/utils/resolve-js-root.mjs`.

### Step 1.2: Create `scripts/utils/resolve-cargo-manifest.mjs`

Copy the existing inline `resolveCargoManifest` function from `npm/rules/rust/coverage/coverage.mjs` (lines ~37–55) into a new file, export it.

**Files:**
`npm/scripts/utils/resolve-cargo-manifest.mjs` — NEW: exports `resolveCargoManifest(cwd): Promise<string>` (throws if not found)

**Verification:**

- File exists at `npm/scripts/utils/resolve-cargo-manifest.mjs`.

### Step 1.3: Write tests for both resolvers

Create test files with these cases:

- `resolveJsRoot`: workspace-project → returns `workspaces[0]` path; single-package → returns cwd; no package.json → returns null.
- `resolveCargoManifest`: cwd has `Cargo.toml` → returns it; workspace with `ws/src-tauri/Cargo.toml` → returns that; workspace with `ws/Cargo.toml` → returns that; none → throws.

Use `mkdtemp` + real filesystem (no mocks needed, functions are pure fs readers).

**Files:**
`npm/scripts/utils/tests/resolve-js-root.test.mjs` — NEW
`npm/scripts/utils/tests/resolve-cargo-manifest.test.mjs` — NEW

**Verification:**

```bash
bun test scripts/utils/tests/resolve-js-root.test.mjs scripts/utils/tests/resolve-cargo-manifest.test.mjs
# Expect: all pass, 0 fail
```

### Step 1.4: Replace inline functions with imports in both coverage providers

In `npm/rules/js-lint/coverage/coverage.mjs`: remove the inline `resolveJsRoot` function; add `import { resolveJsRoot } from '../../../scripts/utils/resolve-js-root.mjs'`.

In `npm/rules/rust/coverage/coverage.mjs`: remove the inline `resolveCargoManifest` function; add `import { resolveCargoManifest } from '../../../scripts/utils/resolve-cargo-manifest.mjs'`.

**Files:**
`npm/rules/js-lint/coverage/coverage.mjs` — remove inline, add import
`npm/rules/rust/coverage/coverage.mjs` — remove inline, add import

**Verification:**

```bash
bun test rules/js-lint/coverage rules/rust/coverage
# Expect: 8+6 = 14 pass, 0 fail (existing tests still green)
```

---

## Task 2: Stryker config concern + baseline

### Step 2.1: Create baseline file

Create `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` with minimal working Stryker config:

```js
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'bun test' },
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  coverageAnalysis: 'off'
}
```

**Files:**
`npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs` — NEW

**Verification:**

- File exists.

### Step 2.2: Write failing test for `stryker_config.mjs`

Create `npm/rules/test/js/tests/stryker_config.test.mjs` with 5 test cases:

1. `js-lint` in rules + `stryker.config.mjs` missing → baseline copied, check returns 0.
2. `js-lint` in rules + `stryker.config.mjs` exists → pass, no copy, returns 0.
3. `.n-cursor.json` absent (`exists: false`) → silently skip (exit 0, no reporter output).
4. `js-lint` not in `.n-cursor.json#rules` → skip silently.
5. `js-lint` in `disable-rules` → skip silently.

Use `mkdtemp` for isolated temp dirs. Mock `resolveJsRoot` via injected dependency (pass `jsRootOverride` option to `check()`).

**Files:**
`npm/rules/test/js/tests/stryker_config.test.mjs` — NEW

**Verification:**

```bash
bun test rules/test/js/tests/stryker_config.test.mjs
# Expect: module not found error (stryker_config.mjs does not exist yet)
```

### Step 2.3: Implement `stryker_config.mjs`

Create `npm/rules/test/js/stryker_config.mjs` exporting `check(opts?)`.

Algorithm:

1. `const config = await readNCursorConfigLite(cwd)`.
2. `if (!isRuleEnabled(config, 'js-lint')) return 0` — silently skip, no reporter output.
3. `const jsRoot = opts?.jsRootOverride ?? await resolveJsRoot(cwd)`.
4. If `jsRoot === null` → `reporter.fail('test: js-lint enabled, але package.json не знайдено')` → return 1.
5. `const target = join(jsRoot, 'stryker.config.mjs')`.
6. If `existsSync(target)` → `reporter.pass('stryker.config.mjs існує')` → return 0.
7. `await copyFile(BASELINE_PATH, target)` → `reporter.pass('stryker.config.mjs створено з canonical baseline')` → return 0.

`BASELINE_PATH = new URL('./data/stryker_config/stryker.config.baseline.mjs', import.meta.url)`.
Import: `readNCursorConfigLite`, `isRuleEnabled` from `'../../../scripts/lib/read-n-cursor-config-lite.mjs'`, `resolveJsRoot` from `'../../../scripts/utils/resolve-js-root.mjs'`.

**Files:**
`npm/rules/test/js/stryker_config.mjs` — NEW

**Verification:**

```bash
bun test rules/test/js/tests/stryker_config.test.mjs
# Expect: 5 pass, 0 fail
```

---

## Task 3: cargo-mutants config concern + baseline

### Step 3.1: Create baseline file

Create `npm/rules/test/js/data/cargo_mutants_config/mutants.toml.baseline` with comment-only content:

```toml
# .cargo/mutants.toml — конфігурація cargo-mutants (опційно, defaults адекватні).
# Документація: https://mutants.rs/. Канон постачає test.mdc у @nitra/cursor.
```

**Files:**
`npm/rules/test/js/data/cargo_mutants_config/mutants.toml.baseline` — NEW

**Verification:**

- File exists.

### Step 3.2: Write failing test for `cargo_mutants_config.mjs`

Create `npm/rules/test/js/tests/cargo_mutants_config.test.mjs` with 5 test cases:

1. `rust` in rules + `.cargo/mutants.toml` missing → baseline copied, check returns 0.
2. `rust` in rules + `.cargo/mutants.toml` exists → pass, no copy.
3. `.n-cursor.json` absent → silently skip.
4. `rust` not in `.n-cursor.json#rules` → skip silently.
5. `rust` in `disable-rules` → skip silently.

Use `mkdtemp` + injected `cargoManifestOverride` option.

**Files:**
`npm/rules/test/js/tests/cargo_mutants_config.test.mjs` — NEW

**Verification:**

```bash
bun test rules/test/js/tests/cargo_mutants_config.test.mjs
# Expect: module not found error (cargo_mutants_config.mjs not created yet)
```

### Step 3.3: Implement `cargo_mutants_config.mjs`

Create `npm/rules/test/js/cargo_mutants_config.mjs` exporting `check(opts?)`.

Algorithm:

1. `const config = await readNCursorConfigLite(cwd)`.
2. `if (!isRuleEnabled(config, 'rust')) return 0`.
3. `const manifestPath = opts?.cargoManifestOverride ?? await resolveCargoManifest(cwd).catch(() => null)`.
4. If `manifestPath === null` → skip silently (rust enabled but no Cargo.toml in tree → resolveCargoManifest threw → not a rust project yet), return 0.
5. `const cargoDir = dirname(manifestPath)` — directory containing Cargo.toml.
6. `const dotCargoDir = join(cargoDir, '.cargo')` → `await mkdir(dotCargoDir, { recursive: true })`.
7. `const target = join(dotCargoDir, 'mutants.toml')`.
8. If `existsSync(target)` → `reporter.pass('.cargo/mutants.toml існує')` → return 0.
9. `await copyFile(BASELINE_PATH, target)` → `reporter.pass('.cargo/mutants.toml створено з canonical baseline')` → return 0.

`BASELINE_PATH = new URL('./data/cargo_mutants_config/mutants.toml.baseline', import.meta.url)`.

**Files:**
`npm/rules/test/js/cargo_mutants_config.mjs` — NEW

**Verification:**

```bash
bun test rules/test/js/tests/cargo_mutants_config.test.mjs
# Expect: 5 pass, 0 fail
```

---

## Task 4: Update coverage provider hints

### Step 4.1: Update JS coverage provider error message

In `npm/rules/js-lint/coverage/coverage.mjs`, find the error thrown when `mutation.json` is missing (in `collect()`). Replace the existing throw/error with:

```
js-lint coverage: stryker не залишив mutation.json — запусти `npx @nitra/cursor fix test` для встановлення canonical stryker.config.mjs, або налаштуй вручну.
```

Keep as a thrown `Error` (not process.exit) so the orchestrator can catch and surface it.

**Files:**
`npm/rules/js-lint/coverage/coverage.mjs` — update error message

**Verification:**

```bash
bun test rules/js-lint/coverage/tests/coverage.test.mjs
# Expect: 8 pass, 0 fail (existing tests still green — they mock the runner)
```

---

## Task 5: Update `test.mdc`, version bump, CHANGELOG

### Step 5.1: Update `test.mdc`

Open `npm/rules/test/test.mdc` and apply:

- Frontmatter: `alwaysApply: true` → `alwaysApply: false`; add `globs: "**/{.n-cursor.json,package.json,Cargo.toml,stryker.config.mjs},**/.cargo/mutants.toml,**/*.test.mjs"`.
- Version: `'1.2'` → `'2.0'`.
- Add new section **«Mutation testing config»** after the existing «Покриття + мутаційне тестування» section:

```markdown
## Mutation testing config

Правило `test` автоматично створює baseline конфіги, якщо активовані суміжні правила:

- **`js-lint` у `.n-cursor.json#rules`** → якщо `stryker.config.mjs` відсутній у `jsRoot`, правило копіює мінімальний canonical baseline: `testRunner: 'command'`, `commandRunner.command: 'bun test'`, JSON-репортер у `reports/stryker/mutation.json`.
- **`rust` у `.n-cursor.json#rules`** → якщо `.cargo/mutants.toml` відсутній поряд із `Cargo.toml`, правило копіює baseline-placeholder (cargo-mutants має розумні defaults без конфігу).

Baseline файли надані пакетом `@nitra/cursor`; локальний вміст після scaffold не валідується — налаштовуй за потребою.
```

**Files:**
`npm/rules/test/test.mdc` — update frontmatter + version + new section

**Verification:**

- `grep 'alwaysApply' npm/rules/test/test.mdc` → `alwaysApply: false`
- `grep 'version' npm/rules/test/test.mdc` → `version: '2.0'`

### Step 5.2: Version bump + CHANGELOG

In `npm/package.json`: bump `"version": "1.17.1"` → `"version": "1.18.0"`.

In `npm/CHANGELOG.md`: prepend new `## [1.18.0] - 2026-05-24` section with:

```markdown
### Added

- **`test/js/stryker_config.mjs`** — новий JS-концерн: якщо `js-lint` у `.n-cursor.json#rules` і `stryker.config.mjs` відсутній у jsRoot — копіює canonical baseline (mінімум: `testRunner: 'command'`, `commandRunner.command: 'bun test'`, JSON-репортер).
- **`test/js/cargo_mutants_config.mjs`** — новий JS-концерн: якщо `rust` у `.n-cursor.json#rules` і `.cargo/mutants.toml` відсутній — копіює comment-only baseline.
- **`scripts/utils/resolve-js-root.mjs`** + **`scripts/utils/resolve-cargo-manifest.mjs`** — спільні модулі визначення (DRY: реюзяться концернами й coverage-провайдерами).

### Changed

- **`test.mdc`** `1.2 → 2.0`: `alwaysApply: false`, явні globs, нова секція «Mutation testing config».
- **`js-lint/coverage/coverage.mjs`**: error message при відсутньому `mutation.json` тепер вказує на `npx @nitra/cursor fix test`.
```

**Files:**
`npm/package.json` — version bump
`npm/CHANGELOG.md` — new section

**Verification:**

```bash
npx @nitra/cursor fix changelog
# Expect: ✅ npm: @nitra/cursor — нова локальна версія (1.17.1 → 1.18.0)
```

### Step 5.3: Full test suite

```bash
bun test
# Expect: ~1001+ pass, 0 fail, ≤2 skip

bun run lint-rego 2>&1 | tail -5
# Expect: 0 violations, conftest tests pass
```

Do `git status && git diff` and stop — developer decides when to commit.
