# Автодетект правила `rego` у `auto-rules.mjs`

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

Правило `rego` існувало у `npm/mdc/rego.mdc` і було задокументовано в `npm/bin/auto-rules.md`, але не реалізовано у `npm/scripts/auto-rules.mjs`. Через це CLI не активував його автоматично навіть у проєктах з `.rego`-файлами.

## Рішення/Процедура/Факт

До `auto-rules.mjs` додано:

- `'rego'` у масив `AUTO_RULE_ORDER` між `'php'` і `'style-lint'`;
- константу `REGO_RE = /\.rego$/iu`;
- прапор `hasRegoFile` у тип `facts` в JSDoc-анотаціях функцій `updateFileFacts`, `processFileEntry`, `collectAutoRuleFacts`;
- виявлення `.rego`-файлів у `updateFileFacts` через `REGO_RE.test(relPath)`;
- запис `{ enabled: facts.hasRegoFile, id: 'rego' }` у масив `autoRuleChecks`.

Правило активується за наявності хоча б одного `.rego`-файлу в проєкті.

## Обґрунтування

Специфікація в `auto-rules.md` вимагала автодетекту `rego` за умовою «є хоч один `.rego`-файл», але реалізацію пропустили при введенні правила. Виправлення відтворює наявний паттерн (аналогічно до `hasDockerfile`, `hasVueFile` тощо) без нових абстракцій.

## Розглянуті альтернативи

Альтернативи не розглядалися: умова вже описана у специфікації, реалізація є прямим відтворенням існуючого паттерну.

## Зачіпає

`npm/scripts/auto-rules.mjs` — константи `REGO_RE`, `AUTO_RULE_ORDER`; JSDoc-тип `facts`; функції `updateFileFacts`, `collectAutoRuleFacts`; масив `autoRuleChecks`.
