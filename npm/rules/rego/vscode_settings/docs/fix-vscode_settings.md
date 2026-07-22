---
type: JS Module
title: fix-vscode_settings.mjs
resource: npm/rules/rego/vscode_settings/fix-vscode_settings.mjs
docgen:
  crc: 8007f6a6
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` описує fix-правило для `.vscode/settings.json`, яке приводить файл до канону через deep-merge шаблону правила. Це потрібно, щоб застосувати налаштування канону й водночас не зачепити локальні налаштування користувача.

## Поведінка

1. `patterns` оголошує fix-поведінку для приведення `.vscode/settings.json` до проєктного канону.
2. Правило додає або оновлює значення з шаблону, щоб середовище розробки мало узгоджені налаштування для всіх учасників.
3. Локальні користувацькі налаштування зберігаються, щоб автоматичне виправлення не перезаписувало індивідуальні параметри, які не конфліктують із каноном.

## Публічний API

- patterns — Fix-патерни концерну: один шаблонний deep-merge у `.vscode/settings.json`.

## Гарантії поведінки

- Файл експортує fix-патерни для `.vscode/settings.json` через шаблонний deep-merge.
