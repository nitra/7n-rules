---
type: JS Module
title: ci-artifact-descriptor-tests.mjs
resource: npm/scripts/utils/tests/ci-artifact-descriptor-tests.mjs
docgen:
  crc: 95676339
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 60
---

## Огляд

Спільний тестовий канон `ci.artifact@1` дескрипторів мовних плагінів (`@7n/rules-lang-php`,
`@7n/rules-lang-js`, …): кожен `slots/ci/*.json` має пройти canonical payload-контракт
(`validateCiArtifactPayload`) і його `template` резолвиться (`resolveArtifactTemplatePath`) у
реальний файл на диску — без broker/discovery, лише форма й containment, той самий контракт,
що читають `@7n/rules-ci-github`/`@7n/rules-ci-azure`.

Винесено сюди (не дубльовано в кожному мовному плагіні) — обидва плагіни повторюють
ідентичний тестовий канон для власних дескрипторів (jscpd: `minLines: 25` фіксував
дослівний клон `describe.each`-блоку раніше, ніж з'явився цей спільний модуль).

## Публічний API

- describeCiArtifactDescriptors — Реєструє `describe.each`-тести canonical payload-контракту й template-резолву для списку
`ci.artifact@1` дескрипторів одного пакета. Викликається на верхньому рівні тестового файлу
(як звичайний `describe(...)`) — не всередині `test`/`beforeEach`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
