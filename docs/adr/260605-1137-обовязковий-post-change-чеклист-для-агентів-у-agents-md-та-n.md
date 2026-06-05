---
session: a98b9a39-809d-4e29-8612-a6afc270999b
captured: 2026-06-05T11:37:12+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/a98b9a39-809d-4e29-8612-a6afc270999b.jsonl
---

## ADR Обовʼязковий post-change чеклист для агентів у AGENTS.md та n-changelog

## Context and Problem Statement

Агенти могли завершувати задачу, не виконавши перевірку changelog: правило `n-changelog.mdc` (з `alwaysApply: true`) не сприймалось як "relevant" після тематичних змін (Vue, Tauri, JS), а фраза "read the relevant rule files" давала агенту простір його ігнорувати. Потрібно зробити так, щоб агент механічно не міг завершити задачу без post-change checklist.

## Considered Options

* Додати до `npm/AGENTS.template.md` явні секції: матрицю відповідності правил, зобовʼязання після зміни файлів (`git status → .changes → fix changelog`), рядок `Validation` у фінальній відповіді.
* Посилити `npm/rules/changelog/changelog.mdc`: додати "Agent final-response checklist" як окремий операційний блок.
* Автоматизувати через окрему команду `npx @nitra/cursor final-check`.

## Decision Outcome

Chosen option: "Посилення `AGENTS.template.md` + `changelog.mdc` з обовʼязковим операційним чеклистом", because user-задача вимагала трирівневого enforcement (інструкція → tooling → поведінка), і два перші варіанти є взаємодоповнювальними та не потребують нового CLI-артефакту; третій варіант (`final-check`) залишено як можливе майбутнє розширення, але не реалізовано.

### Consequences

* Good, because `AGENTS.md` тепер містить чіткий перелік правил, активованих після кожного типу змін, а агент не може обійти зобовʼязання, трактуючи `n-changelog` як "нерелевантне".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли-джерела: `npm/AGENTS.template.md`, `npm/rules/changelog/changelog.mdc` (version bump `3.3` → `3.4`).
Дзеркала оновлено через `node npm/bin/n-cursor.js`: `AGENTS.md`, `.cursor/rules/n-changelog.mdc`.
Change-файл: `npm/.changes/260605-1135.md` (bump: minor, секція Changed).
Перевірка: `node npm/bin/n-cursor.js fix changelog` → exit 0.
Новий шаблонний рядок у фінальній відповіді агента: `Validation: Tests / Build / Changelog: npx @nitra/cursor fix changelog ✅`.
