# test rule — Mutation Config Management Design

## Goal

Правило `test` автоматично розміщує canonical mutation configs у відповідних коренях:

- `stryker.config.mjs` у `jsRoot`, якщо `js-lint` активне в `.n-cursor.json#rules`
- `.cargo/mutants.toml` у `rustRoot`, якщо `rust` активне в `.n-cursor.json#rules`

Обидва концерни self-gate через `readNCursorConfigLite` — `test.mdc` лишається `alwaysApply: true`, бо `location` концерн завжди актуальний.

## Scope

- **In scope:** JS/Stryker config management + Rust/cargo-mutants config management у правилі `test`.
- **Out of scope:** Stryker score threshold enforcement; `scripts.mutation` у `package.json`.

## Architecture

П'ять нових файлів у правилі `test`:

```
npm/rules/test/js/stryker_config.mjs             ← JS-концерн (copy-on-absent logic)
npm/rules/test/js/stryker.config.canonical.mjs   ← canonical Stryker baseline
npm/rules/test/js/tests/stryker_config.test.mjs  ← unit-тести JS-концерну
npm/rules/test/js/cargo_mutants_config.mjs        ← Rust-концерн
npm/rules/test/js/mutants.toml.canonical          ← canonical cargo-mutants baseline
npm/rules/test/js/tests/cargo_mutants_config.test.mjs ← unit-тести Rust-концерну
```

Wiring — через `fix.mjs` правила `test`. Обидва нових концерни додаються до масиву JS-concerns поруч із `location`.

## Components

### `test/js/stryker_config.mjs`

Єдиний export: `checkStrykerConfig({ cwd, ncursorConfig? })`.

**Логіка (слідує `js-lint/js/tooling.mjs::checkKnipConfig` патерну):**

1. `readNCursorConfigLite(cwd)` → якщо `js-lint` не в `rules` → return `0` (silently skip, no output)
2. Визначити `jsRoot`: workspace, де живе `package.json` з `test:coverage` або `scripts.test`. Алгоритм ідентичний `js-lint/coverage/coverage.mjs::findJsRoot(cwd)`.
3. Якщо `stryker.config.mjs` відсутній у `jsRoot`:
   - копіює `stryker.config.canonical.mjs` → `{jsRoot}/stryker.config.mjs`
   - звітує: `✅ {jsRoot}/stryker.config.mjs створено (baseline — відредагуй commandRunner.command)`
4. Якщо існує: `✅ {jsRoot}/stryker.config.mjs OK`

**Interface:**

```js
/** @returns {Promise<number>} 0 = ok, 1 = error (fs failure) */
export async function checkStrykerConfig({ cwd })
```

### `test/js/stryker.config.canonical.mjs`

Generic baseline для Bun-монорепо. Повна форма, без абревіатур:

```js
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: {
    command: 'bun test'
  },
  // inPlace: true avoids hoisted-node_modules issues in a Bun monorepo sandbox
  inPlace: true
}
```

**Після копіювання:** розробник редагує `commandRunner.command` під свій workspace (наприклад `bun test src` або `bun test --preload ./test/setup.js`).

### `test/fix.mjs` (модифікація)

Додати `checkStrykerConfig` до списку JS-concerns. Конкретна позиція — після `checkLocation` (логічний порядок: спочатку перевірка розміщення тестів, потім конфіг mutation-інструменту).

## Data Flow

```
n-cursor fix test
  └─ fix.mjs
       └─ runStandardRule([checkLocation, checkStrykerConfig, checkCargoMutantsConfig], ...)
            ├─ checkStrykerConfig({ cwd })
            │    ├─ readNCursorConfigLite(cwd) → js-lint not in rules? → return 0
            │    ├─ findJsRoot(cwd)
            │    └─ exists? → ✅ OK / absent? → copyFile(canonical → jsRoot/stryker.config.mjs)
            └─ checkCargoMutantsConfig({ cwd })
                 ├─ readNCursorConfigLite(cwd) → rust not in rules? → return 0
                 ├─ findCargoTomlDir(cwd) ← reuses hasCargoTomlInTree from lib/
                 └─ exists? → ✅ OK / absent? → mkdir .cargo + copyFile(canonical → rustRoot/.cargo/mutants.toml)
```

## Error Handling

- `fs.copyFile` / `fs.mkdir` failure → log error → return `1`
- `.n-cursor.json` відсутній → `readNCursorConfigLite` → `rules:[]` → `js-lint`/`rust` не в rules → skip (return 0)
- `findJsRoot` не знаходить `package.json` → skip з warning `⚠ не знайдено package.json у {cwd} — stryker config пропущено`
- `findCargoTomlDir` не знаходить `Cargo.toml` → skip з warning `⚠ не знайдено Cargo.toml у {cwd} — cargo-mutants config пропущено`

## Testing

### JS-концерн (`stryker_config.test.mjs`)

| Тест               | Умова                                                   | Очікуваний результат                       |
| ------------------ | ------------------------------------------------------- | ------------------------------------------ |
| skip без js-lint   | `rules: ['test']`                                       | return 0, no output, no copy               |
| copy absent config | `rules: ['js-lint', 'test']`, no stryker.config.mjs     | copyFile called, ✅ created, return 0      |
| no-op if exists    | `rules: ['js-lint', 'test']`, stryker.config.mjs exists | copyFile NOT called, ✅ OK, return 0       |
| correct jsRoot     | monorepo з `app/package.json`                           | copyFile target = `app/stryker.config.mjs` |
| copyFile failure   | fs throws                                               | return 1                                   |

### Rust-концерн (`cargo_mutants_config.test.mjs`)

| Тест               | Умова                                                 | Очікуваний результат                                  |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| skip без rust      | `rules: ['test']`                                     | return 0, no output, no copy                          |
| copy absent config | `rules: ['rust', 'test']`, no .cargo/mutants.toml     | mkdir + copyFile called, ✅ created, return 0         |
| no-op if exists    | `rules: ['rust', 'test']`, .cargo/mutants.toml exists | copyFile NOT called, ✅ OK, return 0                  |
| correct rustRoot   | monorepo з `app/src-tauri/Cargo.toml`                 | copyFile target = `app/src-tauri/.cargo/mutants.toml` |

Ін'єкція залежностей — через `runner` об'єкт (як `defaultRunner` pattern у `js-lint/coverage/coverage.mjs`):

```js
export async function checkStrykerConfig({ cwd, runner = defaultRunner })
export async function checkCargoMutantsConfig({ cwd, runner = defaultRunner })
```

## Baselines

### `stryker.config.canonical.mjs`

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

### `mutants.toml.canonical`

```toml
# .cargo/mutants.toml — конфігурація cargo-mutants (опційно).
# Документація: https://mutants.rs/. Канон постачає test.mdc.
```

## Version Impact

- `npm/package.json`: `1.17.1 → 1.18.0` (minor: нова автоматична поведінка)
- `npm/CHANGELOG.md`: секція `[1.18.0]` — Added
- `test.mdc`: version `1.2 → 1.3`, додати параграф про Stryker + cargo-mutants config management
