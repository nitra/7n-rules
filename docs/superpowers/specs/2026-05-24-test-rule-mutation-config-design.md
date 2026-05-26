---
type: spec
title: 'правило test керує mutation-testing config (Stryker + cargo-mutants)'
---

# Правило `test` керує Stryker config + cargo-mutants baseline — design

**Дата:** 2026-05-24
**Автор:** brainstorm-сесія (vitaliytv ↔ Claude)
**Статус:** draft, очікує review перед `writing-plans`

## Мотивація

Після релізу [2026-05-24-coverage-rule-design.md](2026-05-24-coverage-rule-design.md) `n-cursor coverage` потребує `stryker.config.mjs` у jsRoot для JS-провайдера (Stryker не запускається без `testRunner` config; без mutation.json provider кидає помилку). У `@nitra/cursor` цього файлу нема — `bun run coverage` падає з `js-lint coverage: stryker не залишив mutation.json`.

Аналогічно для Rust: `cargo-mutants` має робочі defaults, але корисно мати `.cargo/mutants.toml` як точку customization (timeout, exclude-патерни тощо).

**Архітектурна директива:** правило `test` саме керує цими config-файлами, активуючись лише коли відповідне правило мови у `.n-cursor.json#rules`:

- `js-lint` присутнє → ensure `stryker.config.mjs` в jsRoot.
- `rust` присутнє → ensure `.cargo/mutants.toml` у Cargo-manifest dir.

Це дотримує single-source-of-truth і дозволяє `npx @nitra/cursor fix test` готувати проєкт до `n-cursor coverage` без ручного scaffolding.

## Прийняті рішення (підсумок brainstorm)

| #   | Рішення                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Активація — **per-concern self-gating через `readNCursorConfigLite`**. Концерн читає `.n-cursor.json#rules`; якщо dependent rule (`js-lint` / `rust`) не enabled — silently skip (`exit 0`, без `pass`/`fail` повідомлень). Не міняємо rule-level applies(), бо `location` концерн має активуватись завжди. |
| M2  | Baseline — **мінімум (варіант Б)**. Stryker config містить лише обов'язковий мінімум для запуску (`testRunner`, `commandRunner`, `jsonReporter.fileName`). cargo-mutants — комент-плейсхолдер (defaults достатні). Customization (`mutate` patterns тощо) — відповідальність проєкту-споживача.             |
| M3  | Резолвери (`resolveJsRoot`, `resolveCargoManifest`) — **екстрактимо у `npm/scripts/utils/`** як generic shared utilities. Замінюють локальні копії в `js-lint/coverage/coverage.mjs` і `rust/coverage/coverage.mjs`. DRY + reuse в нових концернах.                                                         |
| M4  | `test.mdc` — `alwaysApply: true → false`, явні `globs` для активації за артефактами проєкту. Версія `1.2 → 2.0` (major bump — зміна activation semantics).                                                                                                                                                  |
| M5  | Coverage provider hints оновлюємо **у тій самій PR**. JS provider error при missing `mutation.json` тепер вказує на `npx @nitra/cursor fix test`. Rust provider hint — без змін (`cargo install cargo-mutants` лишається install-hint, бо `.cargo/mutants.toml` опційний).                                  |
| M6  | Скоуп — лише Stryker + cargo-mutants config management. **Не змінюємо** behaviour провайдерів (як вони парсять виводи), не додаємо нових концернів окрім двох mutation-config.                                                                                                                              |
| M7  | Version bump `1.17.1 → 1.18.0` (новий feature = minor).                                                                                                                                                                                                                                                     |

## Архітектура

### Структура каталогів у `@nitra/cursor`

```
npm/scripts/utils/
├── resolve-js-root.mjs                       ← НОВИЙ generic helper (workspaces[0] або cwd)
├── resolve-cargo-manifest.mjs                ← НОВИЙ generic helper (Cargo.toml resolver)
└── tests/
    ├── resolve-js-root.test.mjs
    └── resolve-cargo-manifest.test.mjs

npm/rules/test/
├── test.mdc                                  ← MODIFIED: alwaysApply: false, нові globs, секція mutation-config
├── js/
│   ├── location.mjs                          ← без змін
│   ├── stryker_config.mjs                    ← НОВИЙ концерн
│   ├── cargo_mutants_config.mjs              ← НОВИЙ концерн
│   ├── data/
│   │   ├── stryker_config/
│   │   │   └── stryker.config.baseline.mjs   ← baseline для копіювання
│   │   └── cargo_mutants_config/
│   │       └── mutants.toml.baseline         ← baseline для копіювання
│   └── tests/
│       ├── location.test.mjs                  ← без змін
│       ├── stryker_config.test.mjs            ← НОВЕ
│       └── cargo_mutants_config.test.mjs      ← НОВЕ
└── (fix.mjs, coverage/, policy/ — без змін)

npm/rules/js-lint/coverage/
├── coverage.mjs                              ← MODIFIED: import resolveJsRoot з utils; hint update
└── tests/coverage.test.mjs                   ← MODIFIED: підстроїти shared resolver

npm/rules/rust/coverage/
├── coverage.mjs                              ← MODIFIED: import resolveCargoManifest з utils
└── tests/coverage.test.mjs                   ← MODIFIED: підстроїти shared resolver
```

### Спільні резолвери (`npm/scripts/utils/`)

**`resolve-js-root.mjs`:**

```js
/**
 * Резолвить корінь JS-коду в проєкті: для workspace-projects — перший workspace
 * (наприклад `app/` у mlmail), для single-package — корінь cwd. Використовується
 * coverage-провайдером js-lint і концерном test/stryker_config.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь проєкту (де `.n-cursor.json` і кореневий package.json)
 * @returns {Promise<string|null>} абсолютний шлях до JS-root або null без package.json
 */
export async function resolveJsRoot(cwd) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) return null
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (workspaces.length > 0) {
    const wsPath = join(cwd, workspaces[0])
    if (existsSync(join(wsPath, 'package.json'))) return wsPath
  }
  return cwd
}
```

**`resolve-cargo-manifest.mjs`:**

```js
/**
 * Резолвить шлях до Cargo.toml у проєкті: cwd/Cargo.toml або в одному з
 * workspace-підкаталогів (з підтримкою Tauri-патерну `<workspace>/src-tauri/`).
 * Використовується coverage-провайдером rust і концерном test/cargo_mutants_config.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string|null>} абсолютний шлях до Cargo.toml або null
 */
export async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      const tauri = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauri)) return tauri
      const flat = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flat)) return flat
    }
  }
  return null
}
```

Контракт `null` (замість throw) — щоб концерни test-правила могли gracefully skip-нути, а не падати при відсутності manifest.

### Концерн `test/js/stryker_config.mjs`

**Алгоритм `check()`:**

1. `config = await readNCursorConfigLite(process.cwd())`.
2. **Self-gate:** якщо `js-lint` ∉ `config.rules` АБО `js-lint` ∈ `config.disableRules` → `return reporter.getExitCode()` (0, без output).
3. `jsRoot = await resolveJsRoot(process.cwd())`. Якщо `null` → `fail('test: js-lint enabled, але package.json не знайдено')`.
4. `target = join(jsRoot, 'stryker.config.mjs')`. Якщо існує → `pass('stryker.config.mjs існує')`.
5. Якщо не існує → `copyFile(STRYKER_BASELINE_PATH, target)` → `pass('stryker.config.mjs створено з canonical baseline у <relative-path>')`.
6. Не валідуємо вміст наявного файлу — це side-effect-baseline, не canonical-strict (як `knip.json` у `js-lint`).

**Baseline (`test/js/data/stryker_config/stryker.config.baseline.mjs`):**

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

`mutate` патерни не задаємо — Stryker має робочі defaults (`src/**/*.{js,mjs,ts,jsx,tsx,cjs}`, виключає `*.test.*`). Проєкт додає custom `mutate` після першого прогону, якщо потрібно.

### Концерн `test/js/cargo_mutants_config.mjs`

**Алгоритм `check()`:**

1. `config = await readNCursorConfigLite(process.cwd())`.
2. **Self-gate:** якщо `rust` ∉ `config.rules` АБО `rust` ∈ `config.disableRules` → `return reporter.getExitCode()` (0).
3. `manifestPath = await resolveCargoManifest(process.cwd())`. Якщо `null` → silently skip (cargo не використовується). Не fail, бо `rust` може бути увімкнено для майбутніх Cargo.toml.
4. `cargoDir = dirname(manifestPath)` (наприклад `app/src-tauri/`). `target = join(cargoDir, '.cargo', 'mutants.toml')`.
5. Якщо `target` існує → `pass('.cargo/mutants.toml існує')`.
6. Якщо `.cargo/` не існує — створити (`mkdir { recursive: true }`).
7. `copyFile(MUTANTS_BASELINE_PATH, target)` → `pass('.cargo/mutants.toml створено з canonical baseline')`.

**Baseline (`test/js/data/cargo_mutants_config/mutants.toml.baseline`):**

```toml
# .cargo/mutants.toml — конфігурація cargo-mutants (опційно).
# cargo-mutants має робочі defaults; цей файл — стартова точка для customization.
# Документація: https://mutants.rs/
# Канон постачає правило `test` (@nitra/cursor).
```

Файл порожній по факту (тільки коментарі) — це навмисно: cargo-mutants із defaults адекватно покриває код, а конкретні exclude/timeout-патерни залежать від проєкту.

### Контракт self-gating

Обидва концерни мають **silent skip** (exit 0 без output) коли gate-rule не enabled. Це означає:

- `npx @nitra/cursor fix test` у проєкті без `js-lint`/`rust` — концерн фігурує в discovery, але повідомлень не друкує.
- `pass`-повідомлення виводиться **лише** коли концерн реально щось перевіряв (existing file) або зробив (copied baseline).

Альтернатива — `pass('skipped: js-lint not in .n-cursor.json#rules')` — шумна, бо в типових single-language проєктах одна з двох mutation-tools завжди вимкнена.

### `test.mdc` зміни

**Frontmatter:**

```yaml
---
description: JS-тести (*.test.mjs) живуть у tests/. Правило `test` керує stryker.config.mjs (якщо js-lint enabled) і .cargo/mutants.toml (якщо rust enabled).
version: '2.0'
globs: '**/{.n-cursor.json,package.json,Cargo.toml,stryker.config.mjs,.cargo/mutants.toml},**/*.test.mjs'
alwaysApply: false
---
```

`alwaysApply: true → false` тому що:

- Нові концерни самі gating через `.n-cursor.json` — не потрібен глобальний alwaysApply.
- `location` концерн перевіряє `*.test.mjs` — глобально активувати правило тільки коли є тестові артефакти або config-файли.
- Globs включають все, що правило торкається: `.n-cursor.json` (читається), `package.json`/`Cargo.toml` (для резолверів), targets (`stryker.config.mjs`, `.cargo/mutants.toml`), `*.test.mjs` (location концерн).

**Нова секція в body (після поточної «Покриття + мутаційне тестування»):**

```markdown
## Налаштування mutation-testing

Якщо у `.n-cursor.json#rules` присутнє правило `js-lint` — правило `test` створює canonical baseline `stryker.config.mjs` у JS-root проєкту (workspaces[0] або корінь), якщо файлу немає.

Канон Stryker config (мінімум для роботи з `bun test`): [stryker.config.baseline.mjs](./js/data/stryker_config/stryker.config.baseline.mjs)

Аналогічно, якщо `rust` присутнє в `rules` — створюється `.cargo/mutants.toml` у каталозі Cargo.toml-маніфесту (з підтримкою Tauri-патерну `<workspace>/src-tauri/`):

Канон cargo-mutants config: [mutants.toml.baseline](./js/data/cargo_mutants_config/mutants.toml.baseline)

Customization (mutate patterns, exclude rules, timeout) — відповідальність проєкту-споживача; canon валідує лише наявність файлу як стартового baseline.
```

Markdown-links заінлайнються через `inlineTemplateLinks` під час `npx @nitra/cursor` sync.

### Coverage provider зміни

#### `npm/rules/js-lint/coverage/coverage.mjs`

1. Видалити локальну `resolveJsRoot`, заміна на:
   ```js
   import { resolveJsRoot } from '../../../scripts/utils/resolve-js-root.mjs'
   ```
2. Оновити hint у `collect()` при missing `mutation.json`:
   ```js
   throw new Error(
     'js-lint coverage: stryker не залишив mutation.json — ' +
       'запусти `npx @nitra/cursor fix test` для встановлення canonical stryker.config.mjs, ' +
       'або налаштуй його вручну'
   )
   ```
3. Тести в `tests/coverage.test.mjs` — без функціональних змін (`detect`/`collect` контракт незмінений), але імпорт може бути оновлений якщо тестовий fixture викликає `resolveJsRoot` напряму.

#### `npm/rules/rust/coverage/coverage.mjs`

1. Видалити локальну `resolveCargoManifest`, заміна на:
   ```js
   import { resolveCargoManifest } from '../../../scripts/utils/resolve-cargo-manifest.mjs'
   ```
2. Адаптувати поточний throw до `null`-return контракту:
   ```js
   const manifestPath = await resolveCargoManifest(cwd)
   if (manifestPath === null) throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
   ```
3. Hint про `cargo install cargo-mutants` — **без змін** (`.cargo/mutants.toml` опційний, тож test rule не вирішує цю помилку).

### CLI flow для користувача

**Сценарій:** mlmail-подібний проєкт з `js-lint` і `rust` у `.n-cursor.json#rules`, без mutation-tooling.

1. `npx @nitra/cursor fix test` (або `npx @nitra/cursor fix` для всіх правил):
   - `location` концерн перевіряє розміщення `*.test.mjs`.
   - `stryker_config` концерн: видить `js-lint` enabled → копіює `stryker.config.mjs` baseline у `app/`.
   - `cargo_mutants_config` концерн: видить `rust` enabled → копіює `.cargo/mutants.toml` baseline у `app/src-tauri/`.
2. Користувач може кастомізувати скопійовані файли (mutate patterns тощо).
3. `bun run coverage` (`= n-cursor coverage`):
   - JS provider знаходить `stryker.config.mjs` → запускає Stryker → парсить mutation.json.
   - Rust provider запускає `cargo mutants` (читає `.cargo/mutants.toml` якщо є).
   - COVERAGE.md записаний.

## Інтеграція з пакетом

### `npm/CHANGELOG.md` (нова секція `[1.18.0]`)

```markdown
## [1.18.0] - 2026-05-24

### Added

- Правило `test`: два нових концерни — `stryker_config` і `cargo_mutants_config`. Self-gating через `.n-cursor.json#rules`: концерн активний лише якщо відповідне залежне правило (`js-lint` / `rust`) enabled. При відсутності цільового файлу копіює canonical baseline:
  - `stryker.config.mjs` у JS-root (workspaces[0] або cwd) — мінімум для роботи з `bun test`.
  - `.cargo/mutants.toml` у dir-і Cargo.toml-маніфесту — комент-плейсхолдер; cargo-mutants має робочі defaults.
- Спільні резолвери `resolveJsRoot` і `resolveCargoManifest` у `npm/scripts/utils/`. Замінюють локальні копії в coverage-провайдерах js-lint і rust.

### Changed

- `test.mdc` 1.2 → 2.0 (major): `alwaysApply: true → false`; явні `globs` (`.n-cursor.json`, `package.json`, `Cargo.toml`, mutation-config-цілі, `*.test.mjs`). Нова секція «Налаштування mutation-testing» з посиланнями на baselines.
- `js-lint/coverage/coverage.mjs`: hint при missing `mutation.json` тепер вказує на `npx @nitra/cursor fix test`. `resolveJsRoot` витягнуто у спільний модуль.
- `rust/coverage/coverage.mjs`: `resolveCargoManifest` витягнуто у спільний модуль (контракт змінено: `null` замість throw для missing manifest).
```

### Версія

`npm/package.json#version`: `1.17.1 → 1.18.0`.

## Тестування

### Unit-тести спільних резолверів

`npm/scripts/utils/tests/resolve-js-root.test.mjs`:

- single-package (без `workspaces` у root) → повертає cwd.
- workspaces присутні + `workspaces[0]/package.json` існує → повертає `cwd/workspaces[0]`.
- workspaces присутні, але `workspaces[0]/package.json` відсутній → fallback на cwd.
- Кореневий `package.json` відсутній → `null`.

`npm/scripts/utils/tests/resolve-cargo-manifest.test.mjs`:

- `cwd/Cargo.toml` існує → повертає його.
- workspaces з `<workspace>/src-tauri/Cargo.toml` → повертає Tauri-патерн.
- workspaces з `<workspace>/Cargo.toml` → повертає flat-патерн.
- ні root, ні workspaces не мають Cargo.toml → `null`.
- кореневий `package.json` відсутній → `null`.

### Concerns тести

`npm/rules/test/js/tests/stryker_config.test.mjs` (5+ кейсів):

- `js-lint` НЕ в `rules` → silent skip (exit 0, без output).
- `js-lint` у `disable-rules` → silent skip.
- `js-lint` enabled, `stryker.config.mjs` існує → pass без копіювання.
- `js-lint` enabled, `stryker.config.mjs` відсутній → copy baseline → pass, file існує з content baseline.
- `js-lint` enabled, package.json відсутній → fail з конкретним повідомленням.

`npm/rules/test/js/tests/cargo_mutants_config.test.mjs` (5+ кейсів):

- Аналогічно, але з `rust` rule і `.cargo/mutants.toml`.
- Додатковий кейс: `.cargo/` дир не існує — створюється рекурсивно.
- `rust` enabled але Cargo.toml відсутній → silent skip (не fail).

### Adapter тести в coverage-провайдерах

`npm/rules/js-lint/coverage/tests/coverage.test.mjs`:

- Існуючі тести `detect()`/`collect()` мають продовжувати пасити після refactor (заміна локальної `resolveJsRoot` на shared).
- Перевірка нової hint-message при missing `mutation.json`.

`npm/rules/rust/coverage/tests/coverage.test.mjs`:

- Існуючі тести після refactor.
- Edge case: `resolveCargoManifest` повертає `null` → throw з тим самим повідомленням (контракт зберігся з callsite-вʼю).

## Non-goals

- **Strict-content validation Stryker config / mutants.toml.** Baseline копіюється раз, далі вміст не валідується (як `knip.json` у `js-lint`). Це side-effect-onboarding, не canonical-strict-policy.
- **mutate patterns у Stryker baseline.** Залежить від проєкту, не canonicalize.
- **Інших mutation tools (mutmut для Python, infer для Java).** Якщо/коли з'являться правила `python`/`java` — окремі концерни.
- **Auto-detection «потрібен mutation testing чи ні».** Користувач явно опт-інить через `js-lint`/`rust` у `.n-cursor.json#rules`. Якщо js-lint enabled, але mutation для проєкту нерелевантне — користувач видаляє створений `stryker.config.mjs` (concern після цього не створює знову? — створює, бо це baseline-onboarding; тож альтернатива — додати `disable-rules: ['test']` або згодом окремий opt-out для concern, але це за межами цього скоупу).
- **`alwaysApply: true` повернення.** Перехід на `false` з globs — постійна зміна activation semantics test rule.

## Послідовність реалізації (для writing-plans)

1. **Спільні резолвери:** створити `npm/scripts/utils/resolve-js-root.mjs` + `resolve-cargo-manifest.mjs` з тестами в `tests/`. TDD: контракти `null`-return для missing fixtures.

2. **Refactor js-lint provider:** замінити локальну `resolveJsRoot` на імпорт зі спільного модуля. Тести після рефактору мають пасити.

3. **Refactor rust provider:** замінити локальну `resolveCargoManifest` на імпорт. Адаптувати throw-логіку (manifestPath === null → throw з тим самим повідомленням).

4. **Концерн `stryker_config`:** створити `test/js/stryker_config.mjs` + `tests/stryker_config.test.mjs` + `data/stryker_config/stryker.config.baseline.mjs`. TDD з гейтингом і side-effect copy.

5. **Концерн `cargo_mutants_config`:** аналогічно, з підтримкою `.cargo/` mkdir.

6. **`test.mdc`:** `alwaysApply: true → false`, нові globs, версія 1.2 → 2.0, нова секція «Налаштування mutation-testing» з markdown-links.

7. **Coverage hint update:** оновити error message в `js-lint/coverage/coverage.mjs` при missing `mutation.json`.

8. **Тести:** `bun test` зелено; `bun n-cursor lint-rego` зелено.

9. **Self-perевірка:** `npx @nitra/cursor fix test` на самому пакеті `@nitra/cursor`:
   - `js-lint` enabled → має створитися `npm/stryker.config.mjs` (бо workspaces[0] = 'npm') — або корінь, якщо ми решилимо jsRoot як cwd? **Деталь для уточнення при імплементації:** для `@nitra/cursor` mono-repo `workspaces=['npm', 'demo']`, jsRoot = `npm/` — це коректно.
   - `rust` НЕ в `@nitra/cursor`'s `.n-cursor.json#rules` (бо немає Cargo.toml) — `cargo_mutants_config` silently skips.

10. **`bun run coverage` смок:** після scaffold має згенерувати COVERAGE.md (потенційно з 0/0 mutation, бо `npm/` не має src/ layout для Stryker — це окремий issue, не блокує дизайн).

11. **Завершення:** bump `npm/package.json` 1.17.1 → 1.18.0 → CHANGELOG `[1.18.0]` → `npx @nitra/cursor fix changelog` зелено.
