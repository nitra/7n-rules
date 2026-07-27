---
type: JS Module
title: main.mjs
resource: plugins/ci-github/rules/ci_artifact/consume/main.mjs
docgen:
  crc: 89ed27be
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічною точкою входу є `lint`, яка перевіряє відповідність знайденого внеску канонічному стану цільового файла й повертає результат без змін у репозиторії. Вона окремо фіксує, коли відсутній обов’язковий файл, і коли відсутність не є критичною.

## Поведінка

1. Збирає поточні правила для `ci:github` у межах робочого каталогу й використовує `package.json` як джерело пакування та публікації пов’язаних артефактів.
2. Перевіряє кожну релевантну contribution на відповідність канонічному стану цільового файлу та фіксує діагностику для всього набору знайдених артефактів.
3. Якщо для contribution не вдається отримати канонічний шаблон, позначає це як помилку шаблону й прив’язує її до цільового файлу.
4. Якщо цільовий файл відсутній, розрізняє два бізнес-випадки: для обов’язкового файла створення вважається порушенням, для інших сценаріїв відсутність мовчки пропускається.
5. Якщо файл існує, порівнює його фактичний вміст із канонічним станом і фіксує всі розбіжності як окремі порушення.
6. Повертає підсумок перевірки через `lint` без зміни файлів у репозиторії.

## Публічний API

- lint — Detector generic-consumer-а слоту `ci.artifact@1` для `ci:github` (spec §7.2, Фаза 3):
матеріалізує КОЖНУ активну contribution проти поточного стану consumer-репо — без жодного
PHP/lang-specific literal тут, уся domain-семантика приходить із payload-у contribution-а.

## Сценарії використання

- `plugins/ci-github/rules/ci_artifact/consume/tests/consume.test.mjs` (ci-github ci.artifact consumer) — required-file: файл відсутній → 1 violation, T0 створює canonical файл; deep-subset: відсутній canonical крок → violation, T0 idempotent-фікс; set-union scalar-масивів: consumer-specific шлях у on.push.paths не видаляється; step identity за id/uses/name: зайві поля кроку не викликають дублювання; patch-existing: target відсутній → 0 violations (файл належить іншому концерну); ще 3

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
