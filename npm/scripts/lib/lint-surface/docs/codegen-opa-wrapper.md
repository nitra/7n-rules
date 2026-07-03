---
type: JS Module
title: codegen-opa-wrapper.mjs
resource: npm/scripts/lib/lint-surface/codegen-opa-wrapper.mjs
docgen:
  crc: 10226c5a
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Хелпери відрізняють застарілий згенерований `main.mjs` від ручного escape-hatch-файлу та визначають, чи `concern.json` містить конкретні файлові цілі для прямої оцінки policy-concern-а. Файл існує, щоб підтримати перехід policy-concern-ів на оцінку напряму з `concern.json` без обов’язкового generated `main.mjs`.

## Поведінка

- `isGeneratedFile` визначає, чи є файл застарілим згенерованим артефактом, щоб відрізняти його від ручного `main.mjs` для custom-detector-ів.
- `hasResolvableFiles` визначає, чи опис файлів у `concern.json` вказує на конкретні цілі для прямої оцінки policy-concern-а.

## Публічний API

- isGeneratedFile — розпізнає файли, створені автоматично, щоб не оцінювати їх як ручний код; спирається на `concern.json`.
- hasResolvableFiles — визначає, чи `policy.files` у concern можна звести до конкретних цілей через одиночний файл або glob-обхід; concern без таких цілей має виконуватись через parent-концерн або вважатись неповним для прямої оцінки.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
