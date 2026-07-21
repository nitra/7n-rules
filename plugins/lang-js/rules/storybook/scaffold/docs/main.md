---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/scaffold/main.mjs
docgen:
  crc: 0505810e
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл підтримує Storybook-скафолд для Vue-пакетів і орієнтується на `package.json`, щоб узгодити сценарій запуску з проєктним конфігом. Експортована константа-рядок `STORYBOOK_SCRIPT="storybook dev -p 6006 --no-open"` задає стандартний Storybook-запуск без відкриття браузера. `detectStoriesGlob` визначає межі пошуку stories для пакета. `lint` перевіряє наявність очікуваних файлів і канонічних маркерів та підказує `npx @7n/rules fix storybook` у разі проблем.

## Поведінка

- STORYBOOK_SCRIPT — канонічне значення `package.json#scripts.storybook`: `storybook dev -p 6006 --no-open`.
- detectStoriesGlob — визначає glob для Storybook stories залежно від структури пакета: для `src/components/` звужує пошук до цієї теки, інакше бере ширший glob по `src/`; шлях формується відносно `.storybook/`.
- lint — перевіряє для всіх Vue-пакетів у скоупі канонічний Storybook-скафолд: `.storybook/main.js`, `.storybook/preview.js` і `package.json#scripts.storybook`; якщо файлу або потрібних маркерів бракує, повідомляє порушення з підказкою на `npx @7n/rules fix storybook`.

Changelog: pending

## Публічний API

- STORYBOOK_SCRIPT — Канонічне значення `package.json#scripts.storybook` (storybook.mdc).
- detectStoriesGlob — Layout-детекція для stories-glob (ADR Кластер 2): `src/components/` присутній → glob
звужується до нього; пласка структура (`src/` без `components/`) — ширший glob по `src/`.
Шлях відносний до `.storybook/` (де лежить сам `main.js`), тому з префіксом `../`.
- lint — Перевіряє канонічний Storybook-скафолд (`.storybook/main.js`, `.storybook/preview.js`,
`package.json#scripts.storybook`) для всіх пакетів у скоупі (`scope/main.mjs`).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
