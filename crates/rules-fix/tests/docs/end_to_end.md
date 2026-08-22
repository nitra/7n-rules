---
type: Rust Module
title: end_to_end.rs
resource: crates/rules-fix/tests/end_to_end.rs
docgen:
  crc: 8ac77c62
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

Наскрізний прогін петлі `fix` на РЕАЛЬНОМУ детекторі `rules-core` (`text/forbidden-prettier` — тривіальний у налаштуванні NATIVE_CONCERNS-запис, пряме читання cwd, ніякого зовнішнього стану) з інʼєктованим ФЕЙКОВИМ attempt-виконавцем — без мережі й моделі, як і вимагає задача.  Навмисно НЕ через `rules_fix::fix_concern` (він завжди підключає бойовий `attempt::build_attempt_fn` — реальний `llm_lib::fix::runner::run_attempt`, тобто реальну мережу): тест іде через ту саму пару `detect`/`violation_map`, що й `fix_concern`, але з власним, детермінованим `attempt`.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
