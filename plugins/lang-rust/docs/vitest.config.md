---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-rust/vitest.config.mjs
docgen:
  crc: d10d9920
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-rust: env-канон ядра + include лише тестів плагіна.

## Поведінка

Конфіг застосовується лише до тестів плагіна lang-rust і не охоплює `node_modules`.

Він задає спільний для ядра env-канон для запуску тестів: вимкнений `GIT_TRACE2_EVENT` і окремий файл trace у тимчасовому каталозі для LLM-trace.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
