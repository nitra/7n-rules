---
session: c36913c0-6eb4-48b6-a51f-151304613de1
captured: 2026-06-09T09:08:10+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c36913c0-6eb4-48b6-a51f-151304613de1.jsonl
---

## ADR Розподіл оркестрації між JS і LLM-агентом у скілі `docgen`

## Context and Problem Statement
Скіл `n-docgen` має обійти проєкт, знайти кодові файли і згенерувати для кожного md-документацію. Питання: де провести межу між детермінованою логікою (обхід директорій, фільтрація, визначення шляхів) і LLM-викликами (власне генерація тексту).

## Considered Options
* Вся логіка — в JS: scan + ignore + вирішення overwrite/skip + генерація документації через API-виклики в одному скрипті.
* Гібридний підхід: JS відповідає лише за детермінований JSON-лістинг файлів; рішення про overwrite/skip і запуск LLM — в скілі (Claude-агент).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Гібридний підхід", because коментар у `docgen-scan.mjs` явно фіксує: «Рішення про overwrite/skip приймає скіл — scanner лише лістить і ставить прапор `exists`. LLM/мер[...] генерацію доки робить скіл, диспатчачи субагентів» (`npm/bin/n-cursor.js:1729–1732`).

### Consequences
* Good, because JS-шар (`docgen-scan.mjs`, `docgen-ignore.mjs`) залишається детермінованим і тестованим (є `docgen-scan.test.mjs`) без залежності від моделі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/docgen/js/docgen-scan.mjs` — scanner: виводить JSON `{sourcePath, docPath, exists}`
- `npm/skills/docgen/js/docgen-ignore.mjs` — glob-список ігнорування через `picomatch`
- `npm/bin/n-cursor.js:1728–1732` — CLI-диспетчер `n-cursor docgen scan|modules`
- `npm/skills/docgen/SKILL.md` — скіл запускає окремий субагент на кожен файл зі списку
- `npm/skills/docgen/meta.json` — метадані скілу (включно з `worktree: true`)
