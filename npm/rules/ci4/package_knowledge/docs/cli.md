---
type: JS Module
title: cli.mjs
resource: npm/rules/ci4/package_knowledge/cli.mjs
docgen:
  crc: db5e9f87
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Надає read-only CLI для committed package knowledge та explicit build surface.

Read commands не викликають LLM і не генерують документацію. Explicit
`build` запускає generation runner у SHADOW за замовчуванням і публікує
artifacts лише з `--publish`; index/slice/validate лишаються read-only.

## Публічний API

- runDocsCli — Виконує `n-rules docs` read-only surface.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/cli.test.mjs` (runDocsCli) — build defaults to SHADOW and forwards publish only when explicit; lists portable package domains without absolute runtime roots; returns a compact index and validates the owning manifest; returns a slice without leaking private symbol IDs; fails explicitly for missing manifest and invalid command; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
