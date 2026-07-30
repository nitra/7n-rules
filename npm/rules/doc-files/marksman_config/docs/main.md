---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/marksman_config/main.mjs
docgen:
  crc: ca3ded50
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`MARKSMAN_BASELINE_PATH` і `MARKSMAN_TARGET_FILENAME` задають опорний baseline та цільовий файл для marksman-перевірки. `lint` перевіряє, чи відповідає поточний стан цим опорним даним, і повертає результат для подальшого контролю якості.

## Поведінка

MARKSMAN_BASELINE_PATH задає канонічне джерело для перевірки, чи доступний baseline-конфіг marksman, і використовується як опорна точка перед будь-якою оцінкою стану репозиторію.

MARKSMAN_TARGET_FILENAME позначає очікуваний файл конфігурації в корені репозиторію; саме його наявність визначає, чи вважається перевірка успішною.

lint спочатку звіряє доступність канонічного baseline, а тоді перевіряє наявність цільового файлу в поточному робочому каталозі. Якщо baseline відсутній, перевірка завершується помилкою з підказкою про перевстановлення пакета правил; якщо цільовий файл є, результат успішний; якщо ні — повертається failure з маркером повідомлення з doc-files.mdc і вказівкою на відсутність `.marksman.toml`, щоб відновити його з canonical baseline.

## Публічний API

- MARKSMAN_BASELINE_PATH — Абсолютний шлях до канонічного baseline-конфігу marksman, що постачається разом із пакетом правил.
- MARKSMAN_TARGET_FILENAME — Імʼя конфіг-файлу marksman, який має лежати в корені репозиторію.
- lint — Перевіряє наявність `.marksman.toml` у корені; сигналить копіювання canonical baseline.

## Сценарії використання

- `npm/rules/doc-files/marksman_config/tests/marksman_config.test.mjs` (lint doc-files.marksman_config; T0 fix doc-files.marksman_config) — violation коли .marksman.toml відсутній; чисто коли .marksman.toml існує; копіює baseline; після T0 lint повертає 0 violations

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати
