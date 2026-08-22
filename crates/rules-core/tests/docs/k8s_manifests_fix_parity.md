---
type: Rust Module
title: k8s_manifests_fix_parity.rs
resource: crates/rules-core/tests/k8s_manifests_fix_parity.rs
docgen:
  crc: d6c7d26d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Cross-language parity фікс-поверхні `k8s/manifests`.  Фікстура знята з ЖИВОГО `fix-manifests.mjs`: кожен трансформер прогнано в Node на тих самих входах, і збережено дослівний вихід (`null` — no-op). Тобто звіряється фактичний канон, а не переказ його логіки.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
