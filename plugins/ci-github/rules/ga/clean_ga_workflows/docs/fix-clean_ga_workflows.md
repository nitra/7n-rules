---
type: JS Module
title: fix-clean_ga_workflows.mjs
resource: plugins/ci-github/rules/ga/clean_ga_workflows/fix-clean_ga_workflows.mjs
docgen:
  crc: e10fb666
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує канонічне виправлення workflow `.github/workflows/clean-ga-workflows.yml` для консюмер-репозиторіїв за шаблоном концерну `clean_ga_workflows`. Він потрібен, щоб визначити обовʼязковий сценарій очищення застарілих GitHub Actions workflow-ів.

Публічна точка входу — `patterns`.

## Поведінка

1. `patterns` задає єдиний канонічний сценарій виправлення для workflow очищення застарілих GitHub Actions workflow-ів у консюмер-репозиторії.
2. Сценарій приводить файл `.github/workflows/clean-ga-workflows.yml` до шаблону концерну `clean_ga_workflows`: додає відсутні обовʼязкові частини та надає пріоритет канонічним значенням.
3. Якщо цільового workflow ще немає, сценарій забезпечує його створення з канонічного шаблону.
4. Наявні коментарі та додаткові ключі поза шаблоном зберігаються, щоб не втрачати локальний контекст репозиторію.

## Публічний API

- patterns — Один детермінований патерн: deep-merge канонічного snippet-а концерну в
`.github/workflows/clean-ga-workflows.yml` консюмер-репо — відсутні ключі
додаються, канонічні значення мають пріоритет, коментарі й ключі поза
шаблоном не чіпаються; якщо файлу немає — створюється зі snippet-а.

## Гарантії поведінки
