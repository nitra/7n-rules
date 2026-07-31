---
type: JS Module
title: render.mjs
resource: npm/scripts/lib/lint-surface/render.mjs
docgen:
  crc: 51727542
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Єдиний renderer unified lint surface. Detector-и НЕ друкують основний violation-report —
вони повертають `LintResult`, а runner рендерить тут. Це гарантує однаковий вигляд
для всіх concern-ів і єдину точку форматування.

`renderViolations` — тонкий JS-фасад над native
`rules_core::lint_render::render_violations` (R1 фази 7, другий зріз
`docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4): точний
текстовий формат і insertion-order групування портовані в
`crates/rules-core/src/lint_render.rs`, doc-комент там-таки. JS-реалізацію
видалено після parity-гейту (диференційний тест
`tests/lint-render-native-parity.test.mjs`).

## Публічний API

- renderViolations — Рендерить порушення згруповані за concern-ом. Повертає текст (не друкує сам).
НЕ сортує (той самий контракт, що й видалена JS-версія) — викликачі
(`default-worker.mjs`/`run-fix.mjs`) передають вже вузькі, не глобально
відсортовані підмножини; глобальне сортування для `detectAll` рахує
окремий комбінований native-виклик `sortAndRenderViolations`
(`run-detectors.mjs`).
- renderDiagnostics — Рендерить diagnostics (тех. інфа) — лише у verbose.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/render.test.mjs` (renderViolations (фасад над native render_violations); renderDiagnostics) — порожній вхід → порожній рядок; групує за rule/concern і форматує error-порушення з file; warn-severity → інша марка, без file-сегмента; warn-рівень → ⚠, info-рівень → ℹ

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
