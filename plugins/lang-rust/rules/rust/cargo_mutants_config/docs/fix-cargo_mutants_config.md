---
type: JS Module
title: fix-cargo_mutants_config.mjs
resource: plugins/lang-rust/rules/rust/cargo_mutants_config/fix-cargo_mutants_config.mjs
docgen:
  crc: f1cbd78c
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-autofix концерну `rust/cargo_mutants_config`: детерміновано створює `<cargoDir>/.cargo/mutants.toml` з canonical neutral baseline у кожному каталозі з Cargo-маніфестом, де конфіга ще немає. Запис виконується лише тут (detector — read-only, звітує `mutants-config-missing`).

## Поведінка

1. Перевіряє, чи не виявлено порушення, пов'язане з відсутністю конфігураційного файлу для мутантів у Cargo-проекті.
2. Якщо конфігураційний файл не існує в каталозі з резервною копією, виконується наступне:
3. Збираються шляхи до всіх Cargo-маніфестів у робочому каталозі.
4. Для кожного знайденого Cargo-маніфеста визначається цільовий шлях до файлу `mutants.toml`.
5. Якщо цільовий файл не існує, система позначає його для запису.
6. Створюється директорія, якщо вона відсутня.
7. З резервної копії копіюється вміст конфігураційного файлу до цільового шляху.
8. Якщо жоден файл не було створено, операція завершується без змін.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
