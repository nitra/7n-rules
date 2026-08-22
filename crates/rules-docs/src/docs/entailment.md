---
type: Rust Module
title: entailment.rs
resource: crates/rules-docs/src/entailment.rs
docgen:
  crc: 19383c42
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
---

## Огляд

Верифікатор evidence-entailment — порт `entailment.mjs`.  Гейт нічого не синтезує й не переписує: він або пропускає канонічний граф далі, або повертає блокувальні діагностики. Кожен claim шару `implemented`/`expected` мусить випливати з ТОЧНОГО локального тексту свого evidence; усе, що модель не підтвердила однозначно, лишається блокером, а не «майже пройшло».

## Публічний API

- Diagnostic — Блокувальна діагностика гейта — стабільна форма `{code, message, claimId}`.
- EntailmentOutcome — Результат гейта: або незмінені claims, або блокери. Кеш повертається в обох гілках — його наповнення корисне навіть коли прогін заблоковано.
- EntailmentInput — Вхід верифікатора.
- create_entailment_cache_key — Cache-ключ одного claim-а — порт `createEntailmentCacheKey`: канонічний claim, fingerprint ТЕКСТУ evidence і версії політики.
- parse_entailment_result — Парсить строгу відповідь верифікатора — порт `parseEntailmentResult`.  Жодного поблажливого coercion: зайвий ключ, чужий `claimId`, дублікат у `unsupportedFields` — усе це відхилення форми, а не «майже те саме». Прийнятною є РІВНО одна відповідь: `entails: true` з порожнім `unsupportedFields`.  # Errors Причина відмови машинним кодом — вона ж потрапляє в діагностику.
- verify_evidence_entailment — Верифікує claims графа проти точного локального evidence — порт `verifyEvidenceEntailment`.  Точка інтеграції runner-а: після claims плюс Expected overlay і ДО gap/render; продовжувати лише на [`EntailmentOutcome::Verified`].  # Errors Помилка вводу-виводу кешу — fail-closed (див. [`load_versioned_cache`]).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
