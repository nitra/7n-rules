---
type: JS Module
title: fix-lint_rust_yml.mjs
resource: npm/rules/rust/lint_rust_yml/fix-lint_rust_yml.mjs
docgen:
  crc: f9900918
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Функція `patterns` описує правила для вибірки шляхів і логів, пов’язаних із Rust lint-конфігурацією, зокрема для `lint-rust.yml` та `workflow path filter`. Вона свідомо не охоплює `.github` і `.git`, щоб не зачіпати службові та внутрішні шляхи. Поведінка read-only: лише читає дані й формує результат без запису у ФС чи БД.

## Поведінка

1. `patterns` формує набір правил для автоматичного виправлення lint-конфігурації Rust.
2. `patterns` цільово охоплює workflow-файл `.github/workflows/lint-rust.yml`, щоб підтримувати його в узгодженому стані.
3. `patterns` працює read-only щодо сховища: не змінює ФС чи БД, а лише описує, що саме треба виправити.
4. `patterns` свідомо не зачіпає `.github` і `.git` як окремі шляхи поза визначеним цільовим файлом.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
