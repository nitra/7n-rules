---
session: 15f93d8b-b256-49af-9878-61db3b6f96e7
captured: 2026-06-05T14:44:38+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/15f93d8b-b256-49af-9878-61db3b6f96e7.jsonl
---

the session transcript ends here. Please emit the MADR block(s) for the architectural decisions captured above.

---

Виведи лише блоки ADR (як зазначено в інструкціях, без преамбули та завершального тексту).

## ADR Augment існуючого `stryker.config.mjs` для Vue-roots через string-splice за AST-аналізом

## Context and Problem Statement
Vue JS-roots, що мали `stryker.config.mjs` до впровадження Vue-підтримки у `@nitra/cursor` 3.x, після оновлення залишаються без `plugins`/`ignorers` для `vue-macros` ignorer-плагіна — `ensureBaselineFile` пропускає наявний файл (idempotent skip). Плагін фізично присутній (`stryker-vue-macros-ignorer.mjs`), але не зареєстрований у конфіг-файлі, через що `bun run coverage` падає з `defineProps()` error. Потрібен augment-крок, що точково дописує `plugins`/`ignorers` у існуючий конфіг без перетирання ручних правок і коментарів.

## Considered Options
* **String-splice за AST-аналізом** — використовувати `oxc-parser` лише для аналізу (знайти offsets properties у вихідному тексті), а зміни виконувати точковими `splice`-ами у вихідному рядку.
* **Full AST roundtrip** — парсити через `oxc-parser`, модифікувати AST та серіалізувати назад у текст.
* **Ручне редагування** — покластися на те, що користувач самостійно скопіює vue-baseline поверх свого конфіга.

## Decision Outcome
Chosen option: "String-splice за AST-аналізом", because full AST roundtrip через `oxc-parser` перезаписує форматування й коментарі користувача, а ручне редагування руйнує цінність idempotency і не масштабується. `oxc-parser` вже є у `dependencies` (`"oxc-parser": "^0.128.0"`), тому нова залежність не потрібна.

### Consequences
* Good, because коментарі й форматування існуючого `stryker.config.mjs` зберігаються 1-в-1 після augment.
* Good, because операція idempotent: повторний виклик `check()` дає byte-identical файл і `reporter.pass` "vue-macros ignorer уже зареєстровано".
* Good, because safety-perевірка — після string-splice повторний `parseSync` через `oxc-parser` перевіряє валідність результату; при невалідному JS — відкат без запису.
* Bad, because string-splice є крихкішим за повноцінний AST-roundtrip при екзотичних edge cases (computed properties, dynamic arrays, IIFE export default) — такі кейси явно пропускаються з `reporter.fail` і вимогою додати вручну.

## More Information
- Реалізація: `npm/rules/test/js/stryker_config.mjs` — функція `augmentVueStrykerConfig`, helper-и `arrayAppendEdit`, `propInsertEdit`, `applyEdits`, `detectIndent`, `ensureTrailingComma`, `quote`.
- Інтеграція у `check()` loop: `wasMissing` читається до `ensureBaselineFile`; якщо `!wasMissing && isVueRoot` — викликається `augmentVueStrykerConfig`.
- Канонічні entries: `VITEST_RUNNER_PLUGIN = '@stryker-mutator/vitest-runner'`, `VUE_MACROS_PLUGIN = './stryker-vue-macros-ignorer.mjs'`, `VUE_MACROS_IGNORER = 'vue-macros'` — статичні `const` на рівні модуля.
- Тести: 7 нових кейсів у `npm/rules/test/js/tests/stryker_config.test.mjs` через `withTmpDir` — vue-root зі старим конфігом, вже-vue конфіг (no-op), частково правильний, non-vue workspace, idempotency (двічі), non-literal export default, syntax error.
- Документація: `npm/rules/test/test.mdc` — оновлена секція "Vue SFC".
- ADR-файл: `docs/adr/augment-існуючого-stryker-config-для-vue-roots.md`.
- Change-файл: `npm/.changes/260605-1442.md` (bump: minor, section: Added).
- `flow verify` + `flow gate`: PASS (score 100), lint — 0 порушень, coverage — зелений.
