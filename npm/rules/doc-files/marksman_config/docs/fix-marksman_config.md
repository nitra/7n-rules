---
type: JS Module
title: fix-marksman_config.mjs
resource: npm/rules/doc-files/marksman_config/fix-marksman_config.mjs
docgen:
  crc: 7c52fcff
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` копіює canonical baseline `.marksman.toml` без LLM, щоб забезпечити стандартний вміст `doc-files/marksman_config` у разі відсутності базової конфігурації.

## Поведінка

1. `patterns` задає єдиний T0-сценарій автопоправки для відсутньої конфігурації Marksman: якщо перевірка фіксує нестачу базового файлу, змінюється цільовий файл у робочій теці.
2. Під час спрацювання записується факт зміни цільового шляху, після чого у нього копіюється canonical baseline без залучення LLM.
3. Результат для оператора — поява стандартної конфігурації замість пропуску, з повідомленням про створення файлу згідно з правилами `doc-files.mdc`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
