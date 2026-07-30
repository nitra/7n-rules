---
type: JS Module
title: main.mjs
resource: npm/rules/rego/opa_check/main.mjs
docgen:
  crc: 1e626461
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня rego/opa_check: read-only detector (`opa check --strict`). Per-file: приймає
`ctx.files` (конкретні `.rego`), інакше `npm/rules` (весь policy-корінь, якщо існує) —
контракт як у інших per-file detector-ів. Виділено з колишнього bundled `rego/check` (spec
docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
`opa check` синтаксично/стилістично per-file-безпечний (не потребує сусідніх файлів).

## Публічний API

- lint — Detector rego/opa_check (read-only).

## Сценарії використання

- `npm/rules/rego/opa_check/tests/main.test.mjs` (lint rego/opa_check) — returns no violations (skip) when no rego targets exist in cwd; detects rego files under npm/rules/* and fails on broken syntax; кидає коли opa відсутній у PATH і авто-install відключено (ensureTool hard-fail); passes on a well-formed rego under npm/rules/*/policy/

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
