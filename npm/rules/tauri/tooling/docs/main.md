---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/tooling/main.mjs
docgen:
  crc: 4b6ecb02
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
  issues: anchor-miss:(tauri.mdc),judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Потрібен код файлу для написання поведінкової документації. Названий пакет, конфігурації, на які посилається код, включають `package.json`, `tauri.conf.json` та `extensions.json`. Основна публічна функція — `main`. У поведінці враховуються маркери повідомлень, визначені у `tauri.mdc`.

## Поведінка

Поведінка:

1. Визначає, чи використовує проєкт (або будь-який з його workspace-пакетів) Tauri, аналізуючи наявність маркерів, таких як папка `src-tauri`, файли `tauri.conf.json` або залежності `@tauri-apps/*` у `package.json`.
2. Якщо маркер Tauri відсутній, інформує про це та припиняє роботу.
3. Якщо маркер Tauri присутній, перевіряє на відповідність файлу `.vscode/extensions.json` рекомендаціям, визначеним у `tauri/vscode_extensions` (rego).
4. Якщо `.vscode/extensions.json` відсутній, виводить повідомлення про необхідність його створення з рекомендаціями від `tauri.mdc`.
5. Якщо `.vscode/extensions.json` знайдено, виконує перевірку його вмісту, порівнюючи з політикою `tauri.vscode_extensions`.
6. Повертає код виходу: 0, якщо всі перевірки пройшли успішно, або 1, якщо виявлено проблеми.

## Публічний API

main — Контролює дотримання проєкту специфікацій, визначених у tauri.mdc.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
