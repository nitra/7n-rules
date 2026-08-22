---
type: Rust Module
title: planner.rs
resource: crates/rules-docs/src/planner.rs
docgen:
  crc: 5a587184
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
---

## Огляд

Планувальник bounded semantic chunks і хвиль залежностей — порт `chunk-planner.mjs`.  Планер не викликає модель і нічого не публікує: його результат — ДЕТЕРМІНОВАНИЙ план виконання для map/reduce ([`crate::claims`]). Він працює лише з уже нормалізованим графом і ТОЧНИМИ UTF-8 byte-span-ами, і радше блокує прогін, ніж обрізає джерело під бюджет: обрізаний контекст дав би claim, який неможливо звірити з кодом.

## Публічний API

- Diagnostic — Блокувальна діагностика планера.
- SourceText — Текст одного джерела.
- Span — Половинно-відкритий UTF-8 byte-span.
- UnitSlice — Зріз джерела під один вузол.
- EvidenceSlice — Зріз джерела під одне evidence.
- EdgeEvidence — Provenance одного ребра.
- Chunk — Один map-chunk плану.
- PlanWave — Одна хвиля плану.
- Coverage — Покриття плану.
- ReduceGroup — Група одного рівня reduce-дерева.
- ReduceLevel — Рівень reduce-дерева.
- ReducePlan — Reduce-дерево плану.
- CachePolicy — Політика, від якої залежить кеш map-стадії.
- Plan — Готовий план виконання.
- PlanOutcome — Результат планування.
- PlannerInput — Вхід планера.
- plan_semantic_chunks — Планує нормалізовані вузли й ребра у bounded map-chunk-и та хвилі залежностей — порт `planSemanticChunks`.  Типово обовʼязкові вузли — усі `code-unit`. Непрозорі cross-domain цілі не є AST-вузлами, але їхні вхідні ребра лишаються обовʼязковими і покриваються evidence-зрізом свого локального викликача.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
