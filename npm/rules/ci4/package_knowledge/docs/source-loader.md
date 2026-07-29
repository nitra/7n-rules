---
type: JS Module
title: source-loader.mjs
resource: npm/rules/ci4/package_knowledge/source-loader.mjs
docgen:
  crc: 17d03f94
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Завантажує source inputs рівно одного package knowledge domain.

Loader використовує manifest boundary та exclusions nested domains, поважає
gitignore і не переходить через symlinks. Він повертає stable relative paths
і content, придатні для deterministic candidate pipeline.

## Поведінка

loadDomainSources викликає помилку, якщо вхідний домен не наданий, або якщо кореневий шлях домену не є абсолютним.

У разі успішної роботи, функція повертає об'єкт, що містить масив завантажених джерел, кожен з яких містить шлях і вміст у вигляді рядка.

При виникненні помилок, зокрема, якщо не пройшов валідацію розширень, або при проблемах з доступом до файлів, повертається об'єкт з масивом діагностичних повідомлень.

Свідомо ігноруються шляхи до `.git` та `.worktrees`, а також директорії `node_modules`.

## Публічний API

- loadDomainSources — Завантажує всі source files одного domain без source nested packages.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/source-loader.test.mjs` (loadDomainSources) — loads stable source order and excludes nested package/build trees; does not follow a symlink outside the domain; rejects invalid roots and extension contracts

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
