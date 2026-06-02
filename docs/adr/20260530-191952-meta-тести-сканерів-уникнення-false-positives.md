# Meta-тести сканерів: уникнення false positives через конкатенацію та Identifier-аргументи

**Status:** Accepted
**Date:** 2026-05-30

## Context and Problem Statement

Тести перевірочних модулів `no-process-chdir.mjs` та `no-relative-fs-path.mjs` самі містили рядкові літерали (`process.chdir(` та відносні шляхи), які відповідні сканери шукають у `*.test.{js,mjs}`-файлах. Це спричиняло false positives: `npx @nitra/cursor fix` прапорував власні meta-тести як порушення правил.

## Considered Options

* Конкатенація рядків (`'process.chd' + 'ir'`) та передача шляху через змінну (Identifier), щоб AST/regex-сканер не знаходив точний патерн у source-файлі.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "конкатенація рядків і Identifier-аргументи", because це дозволяє meta-тестам перевіряти функцію сканера (передаючи заборонений рядок динамічно), не потрапляючи самим під цей же сканер.

### Consequences

* Good, because `npx @nitra/cursor fix` проходить без жодних ❌ після виправлення — всі 1/1 правил без зауважень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файли змінено: `npm/rules/test/js/tests/no-process-chdir.test.mjs`, `npm/scripts/tests/test-helpers.test.mjs`.
- Патерн у `no-process-chdir.test.mjs`: `const CHDIR = 'process.chd' + 'ir'` — змінна збирається через `+`, щоб у source-файлі не зустрічався точний рядок `process.chdir(`.
- Change-файл `npm/.changes/1780157537703-7bc123.md` (bump: patch, section: Fixed) — згенеровано командою `npx @nitra/cursor change --bump patch --section Fixed --message "..." --ws npm` з кореня репозиторію (не з `npm/`); запуск з підкаталогу призводив до вкладеного шляху `npm/npm/.changes/`.
- CI (github-actions[bot]) підхопив change-файл і зробив реліз `@nitra/cursor@1.35.2`.
