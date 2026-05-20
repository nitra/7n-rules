---
session: 9df5af85-ba57-41e3-9b88-4e31c33fdc38
captured: 2026-05-20T09:47:49+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/9df5af85-ba57-41e3-9b88-4e31c33fdc38/9df5af85-ba57-41e3-9b88-4e31c33fdc38.jsonl
---

## ADR Нові воркспейси не вимагають version bump у `check changelog`

## Context and Problem Statement

`demo/` з'явився як новий воркспейс на гілці `main` — на merge-base з `dev` файл `demo/package.json` відсутній. Правило `check changelog` (check.mjs) трактувало `Vbase === null` так само, як «version не змінено», і видавало fail з вимогою bump до `0.0.1`, хоча пакет щойно створений і мав початкову версію `0.0.0`.

## Considered Options

* Вважати `Vbase === null` рівнозначним «version не змінено» → вимагати bump (попередня поведінка)
* Для нового воркспейсу (`Vbase === null`) перевіряти лише наявність CHANGELOG-запису для поточної `version`, без вимоги bump

## Decision Outcome

Chosen option: "Для нового воркспейсу перевіряти лише наявність CHANGELOG-запису без bump", because новий пакет не має попередньої версії, від якої відраховується bump; достатньо, щоб `CHANGELOG.md` містив запис для стартової `version` (наприклад `0.0.0`).

### Consequences

* Good, because `check changelog` проходить на `main` після появи `demo/` без помилкового fail: `✅ demo: новий воркспейс — перевіряємо CHANGELOG для 0.0.0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `npm/rules/changelog/fix/consistency/check.test.mjs`
- Функція `checkLocalOnlyChangedWorkspace` у `check.mjs` — місце виправлення гілки `Vbase === null`
- Новий тест: `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'`
- Перевірено командами: `bun test rules/changelog/fix/consistency/check.test.mjs` та `bun ./npm/bin/n-cursor.js check changelog`
- Bump `demo` не виконувався; запис до `npm/CHANGELOG.md` для версії `1.13.63` додано у тій самій сесії
