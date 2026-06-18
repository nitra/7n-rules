---
type: ADR
title: "Augment існуючого `stryker.config.mjs` для Vue-roots через string-splice за AST-аналізом"
---

# Augment існуючого `stryker.config.mjs` для Vue-roots через string-splice за AST-аналізом

**Status:** Accepted
**Date:** 2026-06-05

## Context and Problem Statement

Концерн `stryker_config` (`rules/test/js/stryker_config.mjs`) копіює vue-варіант baseline (`plugins`/`ignorers` з локальним `vue-macros` ignorer-плагіном) лише коли `stryker.config.mjs` у Vue JS-root **відсутній** — `ensureBaselineFile` idempotent-skip-ить наявний файл. Проєкти, які мали non-vue `stryker.config.mjs` ще до 3.x Vue-підтримки, після апгрейду отримують фізичний файл плагіна (`stryker-vue-macros-ignorer.mjs` встановлюється окремим `ensureBaselineFile`), але **без реєстрації** його у конфізі. Через цей drift-hole `bun run coverage` падає у Stryker dry-run з `defineProps() in <script setup> cannot reference locally declared variables`. Користувач мусить вручну копіювати vue-baseline поверх свого конфіга, втрачаючи власні поля/коментарі.

Треба автоматично дореєстровувати `plugins`/`ignorers` у вже-існуючому конфізі, не чіпаючи інших полів і ручних правок.

## Considered Options

- **Full AST roundtrip** — розпарсити oxc-parser-ом, додати вузли, серіалізувати назад. oxc serializer переформатовує файл і **не зберігає коментарі**; користувач втрачає коментарі про `perTest`/`incremental` тощо.
- **Manual edit (статус-кво)** — лишити drift-hole, документувати, що користувач сам копіює vue-baseline. Не масштабується й руйнує цінність idempotency для решти полів.
- **String-splice за AST-аналізом** — oxc-parser лише для аналізу (де у source-тексті default-export object, які properties/offsets уже є), а зміни — точкові `splice`-вставки відсутніх рядкових літералів/properties у вихідний текст. Решта файлу (форматування, коментарі) лишається байт-у-байт.

## Decision Outcome

Обрано **string-splice за AST-аналізом** (`augmentVueStrykerConfig`). oxc-parser знаходить `ExportDefaultDeclaration → ObjectExpression`, `analyzeArrayProperty` визначає стан `plugins`/`ignorers` (відсутній / порожній / непорожній масив рядкових літералів / динамічний), а `arrayAppendEdit`/`newPropertyEdit` будують мінімальні точкові вставки, які застосовуються справа-наліво (`applyEdits`), щоб offsets лишались валідними. Викликається у `check()`-loop лише для Vue-root, де файл існував **до** `ensureBaselineFile` (`wasMissing` зчитується перед копіюванням).

Деградація:

- `export default` — не object-literal (factory/функція/змінна) → `reporter.fail`, файл не чіпається.
- `plugins`/`ignorers` — динамічний вираз (spread/computed/non-string element) → skip із `reporter.fail`, без злиття динамічних масивів.
- syntax error у конфізі → `reporter.fail` з oxc-повідомленням.
- усі цільові entries уже присутні → no-op `reporter.pass` (byte-identical, idempotency).

### Consequences

- Добре: коментарі й форматування користувача зберігаються; idempotent (повторний `fix test` не дублює entries); зворотна сумісність із не-Vue workspaces (augment навіть не викликається).
- Безпека: перед записом — повторний oxc parse результату splice; якщо новий текст не компілюється → відкат, `fail` (користувач не лишається зі зламаним конфігом).
- Компроміс: string-splice крихкіший за повний AST-rewrite до екзотичних layout-ів, тож динамічні/non-literal випадки навмисно скіпаються, а не зливаються.
- Нова рантайм-залежність відсутня: `oxc-parser` уже у `dependencies` (спільні AST-сканери в `scripts/utils/ast-scan-utils.mjs`).

## More Information

Зачіпає: `npm/rules/test/js/stryker_config.mjs`, `npm/rules/test/js/tests/stryker_config.test.mjs`, `npm/rules/test/test.mdc`, `npm/CHANGELOG.md`. Канон цільової форми — `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs`.

## Update 2026-06-05

Реалізацію завершено. Функція `augmentVueStrykerConfig` у `npm/rules/test/js/stryker_config.mjs`; helper-и: `arrayAppendEdit`, `propInsertEdit`, `applyEdits`, `detectIndent`, `ensureTrailingComma`, `quote`. Інтеграція у `check()` loop: `wasMissing` читається до `ensureBaselineFile`; якщо `!wasMissing && isVueRoot` → `augmentVueStrykerConfig`. Канонічні константи: `VITEST_RUNNER_PLUGIN = '@stryker-mutator/vitest-runner'`, `VUE_MACROS_PLUGIN = './stryker-vue-macros-ignorer.mjs'`, `VUE_MACROS_IGNORER = 'vue-macros'`. 7 нових кейсів у `npm/rules/test/js/tests/stryker_config.test.mjs` через `withTmpDir` (vue-root зі старим конфігом, вже-vue no-op, частково правильний конфіг, non-vue workspace, idempotency двічі, non-literal export default, syntax error). Документація оновлена у `npm/rules/test/test.mdc` секція «Vue SFC». `flow verify` + `flow gate`: PASS (score 100), lint — 0 порушень. Change-файл: `npm/.changes/260605-1442.md` (bump: minor, section: Added).
