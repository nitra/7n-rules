---
session: 15f93d8b-b256-49af-9878-61db3b6f96e7
captured: 2026-06-05T14:21:16+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/15f93d8b-b256-49af-9878-61db3b6f96e7.jsonl
---

Функція ще **не реалізована** — ні `augmentVueStrykerConfig`, ні відповідних тест-кейсів у файлі немає. Завдання актуальне.

---

Ось ADR для архітектурного рішення з транскрипту:

---

## ADR Гібридна стратегія augment існуючого `stryker.config.mjs` для Vue SFC

## Context and Problem Statement

Vue workspaces, що мали `stryker.config.mjs` ще до `@nitra/cursor@3.x`, після апгрейду лишаються без `plugins`/`ignorers` для `vue-macros` ignorer-плагіна. `ensureBaselineFile` пропускає запис коли файл уже існує (idempotent skip), тому `bun run coverage` падає з `defineProps()` error — плагін фізично є, але не зареєстрований у конфізі.

## Considered Options

* **Full AST roundtrip** — парсинг через `oxc-parser`, модифікація AST, серіалізація назад у рядок (oxc serializer).
* **Hybrid AST-analysis + string-splice** — `oxc-parser` лише для аналізу (знаходження positions/offsets об'єктних properties), точкові `splice`-и в оригінальному рядку без переформатування.
* **Manual / regex edit** — пошук позицій через регулярні вирази без AST.

## Decision Outcome

Chosen option: "Hybrid AST-analysis + string-splice", because full AST roundtrip через oxc serializer перепише форматування та коментарі користувача у `stryker.config.mjs`, що суперечить вимозі "не перетирати ручні правки". Regex підхід ненадійний для складних JS-структур. `oxc-parser` уже присутній у `dependencies`, тому нових залежностей не додається.

### Consequences

* Good, because transcript фіксує очікувану користь: зберігаються коментарі та форматування в існуючому `stryker.config.mjs`; після запису виконується повторний `oxc parse` для валідації результату — при помилці відкат і `reporter.fail`.
* Bad, because splice-логіка чутлива до edge cases: computed expressions у `plugins`/`ignorers`, non-literal `export default` (factory/IIFE) — для цих випадків аугмент скіпається з явним `reporter.fail`.

## More Information

- Файл реалізації: `npm/rules/test/js/stryker_config.mjs`
- Тести: `npm/rules/test/js/tests/stryker_config.test.mjs` (7 нових кейсів через `withTmpDir`)
- Залежність для аналізу: `oxc-parser` (`^0.128.0`) — вже у `dependencies @nitra/cursor`
- Baseline-зразок target shape: `stryker.config.vue.baseline.mjs` (`plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']`, `ignorers: ['vue-macros']`)
- Патерн виклику: `wasMissing` зчитується **до** `ensureBaselineFile`; augment викликається лише якщо `!wasMissing && isVueRoot`
- Ціль: `CHANGELOG 3.23.0` (minor)
