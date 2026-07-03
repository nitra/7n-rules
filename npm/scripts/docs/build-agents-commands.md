---
type: JS Module
title: build-agents-commands.mjs
resource: npm/scripts/build-agents-commands.mjs
docgen:
  crc: 3c3a5acb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

File: `/Users/vitalii/www/nitra/cursor/docs/n-doc-files/SKILL.md`

Формує повний список команд для секції «Команди» у AGENTS.md. Джерело істини — `package.json` у корені цільового репозиторію, з поля `scripts` береться відомі ключі у стабільному порядку, додатково — усі `lint-*`, яких не було в основному списку. Наприкінці завжди додаються рядки про CLI `@nitra/cursor` (синхрон правил / programmatic check), на початку — рекомендована команда `bun i` за конвенціями monorepo.

## Поведінка

1. Викликається `buildAgentsCommandBulletItems` для формування переліку команд.
2. Функція зчитує розділ `scripts` з `package.json` у корені проекту.
3. Якщо `package.json` відсутній або має некоректний формат, функція повертає порожній набір даних.
4. Створюється базовий перелік команд, що починається з команди встановлення залежностей `bun i`.
5. Додаються команди зі стабільно визначеного списку ключових скриптів з `package.json` у порядку `test`, `lint`, `lint-js`, `lint-text`, `lint-ga`, `lint-k8s`, `lint-docker`, `start`, `dev`, `build`.
6. Подалі додаються всі інші ключі скриптів, які починаються з `lint-` та не були додані у попередньому кроці, відсортовані лексикографічно.
7. У кінці завжди додаються команди, пов'язані з CLI `@nitra/cursor` та `knip`.
8. Повертається список елементів, готовий для формування Markdown-секції «Команди».

## Публічний API

buildAgentsCommandBulletItems — створює список команд для розділу `commands` у `AGENTS.template.md`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
