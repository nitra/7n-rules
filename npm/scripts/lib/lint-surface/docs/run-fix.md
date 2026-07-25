---
type: JS Module
title: run-fix.mjs
resource: npm/scripts/lib/lint-surface/run-fix.mjs
docgen:
  crc: 7f20adb7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 50
  issues: no-overview,short-behavior,anchor-miss:.mt.json,best-of-2:retry-lost
---

## Публічний API

- fixConcern — Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
- runFixPipeline — Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
