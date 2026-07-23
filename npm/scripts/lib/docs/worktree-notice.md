---
type: JS Module
title: worktree-notice.mjs
resource: npm/scripts/lib/worktree-notice.mjs
docgen:
  crc: 4feb8b6c
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min-retry
  score: 100
---

## Огляд

Цей файл містить інструкції для вбудовування вказівки про використання worktree-гілки в синкнутий текст `SKILL.md`. Він забезпечує ідемпотентне заміщення або видалення цього блоку залежно від значення `main.json.worktree`, забезпечуючи зв'язок з інструкціями щодо роботи з окремими Git-репозиторіями та інструментами для управління залежностями та бінарними викликами.

## Behavior
Транслітерує кирилицю в ASCII для короткого suffix
@param {string} value вхідний текст
@returns {string} транслітерований текст

### deriveSuffix
Робить короткий безпечний suffix для worktree-гілки з назви скіла
@param {string} content вміст `SKILL.md`
@returns {string} suffix до 10 символів
викликає: transliterate

### buildNoticeBody
Тіло worktree-інструкції з конкретним суфіксом, щоб агент не питав назву гілки
@param {string} suffix короткий suffix задачі
@returns {string} markdown-блок без маркерів

### buildBlock
Канонічний блок worktree-інструкції
@param {string} content вміст `SKILL.md`
@returns {string} текст блоку від START до END
викликає: buildNoticeBody

### injectWorktreeNotice
Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`
@param {string} content вміст `SKILL.md`
@param {boolean} enabled чи має бути блок значення `main.json.worktree`
@returns {string} оновлений вміст ідемпотентно

## Поведінка

Транслітерує кирилицю в ASCII для короткого suffix
@param {string} value вхідний текст
@returns {string} транслітерований текст

### deriveSuffix
Робить короткий безпечний suffix для worktree-гілки з назви скіла
@param {string} content вміст `SKILL.md`
@returns {string} suffix до 10 символів
викликає: transliterate

### buildNoticeBody
Тіло worktree-інструкції з конкретним суфіксом, щоб агент не питав назву гілки
@param {string} suffix короткий suffix задачі
@returns {string} markdown-блок без маркерів

### buildBlock
Канонічний блок worktree-інструкції
@param {string} content вміст `SKILL.md`
@returns {string} текст блоку від START до END
викликає: buildNoticeBody, deriveSuffix

### injectWorktreeNotice
Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`
@param {string} content вміст `SKILL.md`
@param {boolean} enabled чи має бути блок значення `main.json.worktree`
@returns {string} оновлений вміст ідемпотентно
викликає: buildBlock

## Публічний API

- WORKTREE_START — Маркер початку worktree-блоку (стабільний, не залежить від тексту всередині).
- WORKTREE_END — Маркер кінця worktree-блоку.
- injectWorktreeNotice — Вставляє / оновлює / видаляє worktree-блок у вмісті `SKILL.md`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
