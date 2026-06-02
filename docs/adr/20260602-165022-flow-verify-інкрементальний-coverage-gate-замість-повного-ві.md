---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T16:50:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

---

Транскрипт закінчено. Ось документація рішення.

---

## ADR flow verify: інкрементальний coverage-gate замість повного відключення

## Context and Problem Statement
`flow verify` (Quality Gate) запускав повний coverage-прогін (vitest + Stryker) на кожному `verify`-виклику у worktree, що було надто повільним і нестабільним. Паралельно у спільному `main`-дереві лишився незавершений merge гілки `feat/coverage-changed-gate`, який утримував маркери конфлікту у `reviewer.mjs` і валив `flow` CLI з `Unexpected token '==='`.

## Considered Options
* **HEAD (main)**: прибрати coverage із `verify` зовсім — `DEFAULT_GATES = [lint]`
* **feat/coverage-changed-gate**: залишити coverage, але інкрементально — `DEFAULT_GATES = [lint, coverage --changed]` (scoped до змінених файлів)

## Decision Outcome
Chosen option: **feat/coverage-changed-gate (інкрементальний `--changed`)**, because при резолюції merge-конфлікту в `reviewer.mjs` і `flow.mdc` було обрано бік `feat`: він зберігає safety net для coverage при оптимальній швидкості через scoping до diff від `base_commit`.

### Consequences
* Good, because coverage лишається частиною turnstile і знаходить регресії у змінених файлах, не розширюючи час verify на весь репозиторій.
* Bad, because стабільність `coverage --changed` залежить від наявності `base_commit` у стані flow та від Stryker env (transcript фіксує повторні проблеми із плагіном `vitest-runner` навіть після цього рішення).

## More Information
Файли зведення конфліктів: `npm/scripts/dispatcher/lib/reviewer.mjs`, `npm/rules/flow/flow.mdc`, `npm/rules/rust/coverage/coverage.mjs`. `rust/coverage/coverage.mjs` → взято бік HEAD (новіший, має `diffPath`/`--in-diff`/`baseline skip`). Коміт: `c091708`.

---

## ADR flow release: авто-інференс `--ws` із git-diff

## Context and Problem Statement
`flow release` виклик `n-cursor change` без явного `--ws` клав change-файл у корінь монорепо, тоді як змінені файли належали підпакету (`npm/`). Беклог #9.

## Considered Options
* Залишити поточну поведінку: `change` defaultується на `.` (корінь)
* Інферувати `--ws` зі змін від `base_commit`: якщо один subworkspace має змінені файли → авто-додати `--ws <ws>`; кілька → exit 1 (амбігуйно)

## Decision Outcome
Chosen option: **Інферувати `--ws` зі змін від `base_commit`**, because користувач описав #9 як явний баг і обрав варіант з інференсом; fail-soft при недоступному git (помилка інференсу → `change` запускається без `--ws`).

### Consequences
* Good, because change-файл автоматично потрапляє у правильний підпакет без ручного `--ws`.
* Bad, because transcript фіксує необхідність узгодження з `effectiveCwd` (#1) при злитті — конфлікт у `commands.mjs` між двома PR-гілками.

## More Information
Нова функція `matchChangedWorkspaces` (ін'єктовні `listWorkspaces`, `changedFilesSince`) та `resolveChangeWsArgs` у `npm/scripts/dispatcher/lib/commands.mjs`. Явна форма `--ws=value` детектується через `rest.some(a => a === '--ws' || a.startsWith('--ws='))`. Вкладені воркспейси — відношення до найглибшого через `toSorted` за спаданням глибини. Коміт: `282332c` (гілка `flow-release-infer-ws`).

---

## ADR flow review: рецензент верифікує cross-file твердження через Read

## Context and Problem Statement
Рецензент `flow review` видавав findings типу «з diff не видно» і не міг верифікувати їх через referenced-файли, що породжувало нефальсифіковні зауваження. Беклог #7. Subagent уже мав `allowedTools: ['Read', ...]`, але промпт не давав дозволу й не вимагав дочитувати.

## Considered Options
* Залишити промпт «читай лише diff»
* Дозволити й зобов'язати рецензента використовувати `Read` для верифікації cross-file тверджень перед репортом

## Decision Outcome
Chosen option: **Дозволити й зобов'язати читання через Read**, because це усуває клас нефальсифіковних findings, не розширюючи scope (scope обмежено: репортувати лише дефекти, інтродуковані diff-ом, а не pre-existing).

### Consequences
* Good, because рецензент перевіряє spec/контракт перед твердженням «порушено контракт», зменшуючи хибно-позитивні findings.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено `reviewerPrompt` у `npm/scripts/dispatcher/lib/review.mjs`; додано тест на присутність інструкції `Read` у промпті. Коміт: `b0308d4` (гілка `flow-review-read-access`).

---

## ADR coverage-gate: Stryker запускається через локальний core-bin, не npx

## Context and Problem Statement
`runStryker` у `npm/rules/js-lint/coverage/coverage.mjs` запускав `@stryker-mutator/core` через `npx`, що завантажувало core у власний кеш без `@stryker-mutator/vitest-runner` поряд. Plugin-discovery (відносний glob навколо core) не знаходив плагін → `Cannot find TestRunner plugin "vitest"` → `flow verify` coverage-gate незмінно падав.

## Considered Options
* `npx @stryker-mutator/core` (попередня поведінка)
* `bunx @stryker-mutator/core` — завжди встановлює у тимчасову теку без плагіна
* Резолвити локально встановлений core через `package.json` → поле `bin`, запускати bin напряму (його `#!/usr/bin/env node` shebang → завжди node, незалежно від bun/node батька)

## Decision Outcome
Chosen option: **Локальний core-bin через прямий запуск**, because `exports` пакета не відкриває `./bin/stryker.js` (помилка `ERR_PACKAGE_PATH_NOT_EXPORTED` при `require.resolve`), тому резолв іде через `package.json` → поле `bin`; прямий запуск виконавчого файлу використовує shebang-node незалежно від рантайму батька.

### Consequences
* Good, because coverage-gate `flow verify` проходить end-to-end: `vitest test runner` завантажується, 34 тести зелені.
* Bad, because якщо `@stryker-mutator/core` не встановлено локально, `resolveLocalStrykerBin` поверне `null` і відбудеться fallback — transcript фіксує, що fallback логіка не реалізована (помилка вже інша).

## More Information
Функція `resolveLocalStrykerBin()` у `npm/rules/js-lint/coverage/coverage.mjs`: `createRequire(import.meta.url).resolve('@stryker-mutator/core/package.json')` → `dirname` → `join(dir, pkg.bin.stryker)`. `spawnSync(strykerBin, args, { cwd })` замість `spawnSync('npx', ['@stryker-mutator/core', ...], ...)`. Коміт: `373ce42` (гілка `flow-coverage-stryker-local`).

---

## ADR detectLevel: complexity guards запобігають хибному L0

## Context and Problem Statement
`detectLevel` у `npm/scripts/dispatcher/lib/level.mjs` мав пріоритет `L3 > L0 > L2 > L1`. Будь-який підрядок `fix`/`typo`/`bump` у описі задачі давав L0 (тривіальне), навіть якщо опис містив явні сигнали складності (mdc, checker, кілька правил тощо). Беклог #2. Догфуд: `flow init "detectLevel не має... mdc/checker/кілька правил"` → level 0.

## Considered Options
* Залишити поточний пріоритет без змін
* Додати `COMPLEXITY_GUARD_KEYS` — підрядки, присутність яких скасовує зниження до L0 (нові пріоритети: `L3 > (L0 якщо немає guard, інакше fallthrough) > L2 > L1`)

## Decision Outcome
Chosen option: **COMPLEXITY_GUARD_KEYS**, because підхід мінімально інвазивний (один рядок зміни у `detectLevel`), не порушує існуючі L0/L3 тести та покриває ключові engineering-контексти (mdc, rego, policy, checker, rules, spec, суперечн, conflict, violation тощо).

### Consequences
* Good, because `flow init "fix mdc checker"` тепер дає L1, а не L0; тести перевіряють 6 guard-категорій.
* Bad, because `правил` як підрядок теоретично матчить `правильно`/`правильний` (false positive L0→L1); `spec` замінено на `' spec'` (з пробілом) щоб уникнути `specific`/`aspect`, але це не ловить `spec` на початку рядка. Transcript не фіксує реальних випадків хибного підйому.

## More Information
`COMPLEXITY_GUARD_KEYS` у `npm/scripts/dispatcher/lib/level.mjs`: `['mdc', 'rego', 'policy', 'правил', 'rules', 'checker', 'check-', ' spec', 'інваріант', 'invariant', 'кілька файлів', 'декілька', 'multiple files', 'суперечн', 'конфлікт', 'conflict', 'порушен', 'violation']`. Ключ `rule` видалено (дублікат `rules`, false positive `ruler`). Коміт: `489d3e0` (гілка `flow-level-classifier-fix`).
