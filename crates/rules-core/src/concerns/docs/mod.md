---
type: Rust Module
title: mod.rs
resource: crates/rules-core/src/concerns/mod.rs
docgen:
  crc: fd11cfb7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Native-порти детермінованих lint-concern-ів + registry (E1 фази 5 `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).  Кожен підмодуль — 1:1 порт відповідного `main.mjs` з `npm/rules/<rule>/<concern>/` (три пілоти без зовнішніх tool-залежностей — обраний за спекою порядок «від чистих текстових/структурних перевірок»). Registry ([`NATIVE_CONCERNS`], [`run_concern`]) — точка диспатчу для `rules-napi`-binding-а: JS-оркестратор перевіряє належність `ruleId/concernId`-ключа до [`NATIVE_CONCERNS`] і, якщо так, викликає native замість `import(main.mjs)` (співіснування, не fallback — секція «Фаза 5» спеки).

## Публічний API

- run_concern — Запускає native-порт concern-а за ключем `ruleId/concernId`.  - `cwd` — абсолютний корінь consumer-репо (дзеркало `LintContext.cwd`). - `files` — posix-relative файли для per-file concern-ів (дзеркало `LintContext.files`); ігнорується whole-repo концернами (`forbidden-prettier`, `sample_secret`) — так само, як їхні JS-версії не читають `ctx.files` узагалі.  Невідомий ключ → [`RulesError::Concern`] (JS-loader має звіряти приналежність до [`NATIVE_CONCERNS`] ДО виклику — це остання лінія захисту, не основний контракт).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
