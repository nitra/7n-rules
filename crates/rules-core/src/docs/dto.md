---
type: Rust Module
title: dto.rs
resource: crates/rules-core/src/dto.rs
docgen:
  crc: 83df2557
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Versioned JSON DTO-межа між `rules-core` і `rules-napi` (рішення Р10 спеки `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).  Усі структури, якими крейт обмінюється з JS-шаром через N-API, живуть у цьому модулі й серіалізуються через `serde_json`. [`CONTRACT_VERSION`] росте при будь-якій несумісній зміні форми DTO; JS-loader звіряє його при завантаженні аддона (enforcement-точка за зразком `requiresPluginApi`) — так парність JS ⇄ native не мовчки розходиться між релізами.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
