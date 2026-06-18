---
type: JS Module
title: skill_meta.mjs
resource: npm/rules/npm-module/js/skill_meta.mjs
docgen:
  crc: a069397b
  score: 100
---

Перевірка стану конфігурації. Файл перевіряє відповідність між полями worktree та requireRoot. Перевірка спирається на конфіги meta.json.

## Поведінка

1. Перевірка поля worktree
2. Перевірка поля auto
3. Перевірка поля requireRoot
4. Перевірка суперечності between worktree та requireRoot

## Публічний API

check — Валідує всі `npm/skills/<id>/meta.json`.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
