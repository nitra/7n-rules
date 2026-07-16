---
type: JS Module
title: native.mjs
resource: llm-lib/lib/internal/native.mjs
docgen:
  crc: 205418d5
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл знаходить і завантажує native-аддон `llm-cascade`, щоб JavaScript-код використовував Rust-ядро через napi-артефакт. `resolveNativeAddon` визначає шлях за єдиним порядком: явний override `N_LLM_LIB_NATIVE_ADDON`, platform-підпакет `@7n/llm-lib-<platform>-<arch>` з артефактом `llm-cascade-napi.<triple>.node`, dev-fallback у `target/release|debug/` після `cargo build -p llm-cascade-napi` або вивід у `llm-lib/crates/llm-cascade-napi/`. `loadNative` завантажує знайдений аддон через `process.dlopen` і кешує результат у межах процесу. На непідтриманих платформах запуск зупиняється зрозумілою помилкою без JS-fallback.

## Поведінка

- `resolveNativeAddon` визначає шлях до native-аддона `llm-cascade`: спершу бере явний override, далі шукає platform-підпакет, потім локальні dev-збірки; для непідтриманої або незібраної платформи завершується зрозумілою помилкою без JS-fallback.
- `loadNative` завантажує native-аддон один раз за процес і повертає закешовані exports для повторних викликів.

## Публічний API

- resolveNativeAddon — знаходить файл native addon `llm-cascade` для поточного середовища або тестових підмін.
- loadNative — повертає native addon із кешу, щоб завантажувати його лише один раз за час роботи процесу.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
