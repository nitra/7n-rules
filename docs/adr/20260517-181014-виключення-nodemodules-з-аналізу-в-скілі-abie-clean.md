---
session: ff20937b-ad59-46cd-a67a-61e8342e5f2e
captured: 2026-05-17T18:10:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ff20937b-ad59-46cd-a67a-61e8342e5f2e.jsonl
---

## ADR Виключення `node_modules` з аналізу в скілі `abie-clean`

## Context and Problem Statement
Скіл `npm/skills/abie-clean/SKILL.md` виконує очистку проєкту від ru-середовища: видаляє директорії, файли та записи у конфігах. Без явного виключення `node_modules` команди `find` та `git grep` могли б аналізувати й модифікувати встановлені залежності, що є генерованим кодом і не підлягає ручному редагуванню.

## Considered Options
* Додати явне виключення `node_modules` (та аналогічних директорій `dist/`, `build/`, `.next/` тощо) в усі `find`-команди та рекомендацію `git grep` у тілі скілу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати явне виключення `node_modules`", because користувач безпосередньо вимагав, щоб `/node_modules` не аналізувався та не змінювався під час очистки.

### Consequences
* Good, because `find`-команди у секціях 1 і 2 скілу отримали прапор `-prune` для `node_modules` і `.git`, що виключає залежності з видалення.
* Good, because `git grep` за замовчуванням пропускає невідстежувані шляхи (зокрема `node_modules/` у `.gitignore`), — це зафіксовано явно у секції 6 скілу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено файл: `npm/skills/abie-clean/SKILL.md`
Додано секцію **0. Що НЕ чіпати** із повним переліком виключених директорій: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `.output/`, `coverage/`.
Усі `find`-команди скілу використовують шаблон:
```bash
find . -type d \( -name node_modules -o -name .git \) -prune -o ...
```
