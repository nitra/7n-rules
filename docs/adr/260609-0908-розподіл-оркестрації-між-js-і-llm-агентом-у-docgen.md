---
type: ADR
title: Розподіл оркестрації між JS і LLM-агентом у docgen
description: Scanner docgen лишається детермінованим JS-шаром, а overwrite/skip і генерація документації виконуються скілом через LLM-агентів.
---

**Status:** Accepted
**Date:** 2026-06-09

## Context and Problem Statement

Скіл `n-docgen` має обходити проєкт, знаходити кодові файли і генерувати для кожного md-документацію. Потрібно було визначити межу між детермінованою логікою, як-от scan, ignore і побудова шляхів, та LLM-частиною, яка генерує текст документації.

## Considered Options

- Вся логіка в JS: scan, ignore, overwrite/skip і генерація документації через API-виклики в одному скрипті.
- Гібридний підхід: JS відповідає лише за детермінований JSON-listing файлів, а рішення про overwrite/skip і запуск LLM лишаються в скілі.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Гібридний підхід", because коментар у `docgen-scan.mjs` фіксує, що scanner лише лістить файли і ставить прапор `exists`, а рішення про overwrite/skip і LLM-генерацію документації приймає скіл.

### Consequences

- Good, because JS-шар `docgen-scan.mjs` і `docgen-ignore.mjs` лишається детермінованим і тестованим без залежності від моделі.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because LLM/мережеву генерацію документації виконує скіл, який dispatch-ить субагентів.

## More Information

- `npm/skills/docgen/js/docgen-scan.mjs` — scanner виводить JSON `{sourcePath, docPath, exists}`.
- `npm/skills/docgen/js/docgen-ignore.mjs` — glob-список ігнорування через `picomatch`.
- `npm/bin/n-cursor.js:1728–1732` — CLI dispatcher `n-cursor docgen scan|modules`.
- `npm/skills/docgen/SKILL.md` — скіл запускає окремий субагент на кожен файл зі списку.
- `npm/skills/docgen/meta.json` — metadata скілу, включно з `worktree: true`.
