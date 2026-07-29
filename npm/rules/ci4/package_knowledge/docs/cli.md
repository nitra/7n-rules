---
type: JS Module
title: cli.mjs
resource: npm/rules/ci4/package_knowledge/cli.mjs
docgen:
  crc: e7c91839
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Надає read-only CLI для package knowledge domains і committed manifests.

Команди не викликають LLM і не генерують документацію. Вони детерміновано
відкривають domain index/slice або валідують manifest v1, щоб agent міг
отримати малий impact context без broad repository search.

## Публічний API

- runDocsCli — Виконує `n-rules docs` read-only surface.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/cli.test.mjs` (runDocsCli) — lists portable package domains without absolute runtime roots; returns a compact index and validates the owning manifest; returns a slice without leaking private symbol IDs; fails explicitly for missing manifest and invalid command; does not mutate a committed manifest during any read command

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
