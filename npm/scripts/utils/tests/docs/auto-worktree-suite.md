---
type: JS Module
title: auto-worktree-suite.mjs
resource: npm/scripts/utils/tests/auto-worktree-suite.mjs
docgen:
  crc: c4a9480d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
---

## Огляд

Спільний vitest-набір для мосту auto-worktree: той самий поведінковий
контракт `bringChangesBackToOriginal`/`removeAutoCreatedWorktree`
перевіряється і на прямому імпорті з `scripts/lib/auto-worktree.mjs`
(auto-worktree.test.mjs), і на реекспорті зі `skills/taze/js/orchestrate.mjs`
(orchestrate.test.mjs) — тіла тестів існують в одному місці.

## Поведінка

describeAutoWorktreeBridge визначає поведінковий контракт для синхронізації змін між worktree та оригінальним репозиторієм, включаючи сценарії успішного копіювання та обробки помилок.

При використанні контракту при поверненні змін, якщо `git status` не вдається, функція повертає `failed: true` та порожній масив `brought`, а також логує попередження.

При поверненні змін, якщо під час копіювання одного файлу виникає помилка, процес продовжується для інших файлів, але загальний результат позначається як `failed: true`.

describeAutoWorktreeBridge також охоплює контракт `removeAutoCreatedWorktree`, який викликає функцію `native.worktreeRemove`, ігноруючи помилки виконання цієї функції, але логуючи попередження.

## Публічний API

- describeAutoWorktreeBridge — Реєструє describe-блоки контракту повернення змін з worktree в оригінал.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
