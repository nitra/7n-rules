---
type: ADR
title: "AGENTS.md та n-changelog: обов'язковий post-change чеклист"
---

# AGENTS.md та n-changelog: обов'язковий post-change чеклист

**Status:** Accepted
**Date:** 2026-06-05

## Context and Problem Statement

Агенти могли завершувати задачу, не виконавши перевірку changelog: правило `n-changelog.mdc` (з `alwaysApply: true`) не сприймалось як «relevant» після тематичних змін (Vue, Tauri, JS), а фраза «read the relevant rule files» давала агенту простір ігнорувати його. Потрібно зробити так, щоб агент механічно не міг завершити задачу без post-change checklist.

## Considered Options

- Додати до `npm/AGENTS.template.md` повну матрицю відповідності правил, зобов'язання після зміни файлів (`git status → .changes → fix changelog`), рядок `Validation` у фінальній відповіді.
- Посилити `npm/rules/changelog/changelog.mdc`: додати «Agent final-response checklist» як окремий операційний блок.
- Автоматизувати через нову команду `npx @nitra/cursor final-check`.
- Тонкий prompt-інваріант у `AGENTS.md` + операційний абзац у `n-changelog.mdc`.

## Decision Outcome

Chosen option: "Тонкий prompt-інваріант у `AGENTS.md` + операційний абзац у `n-changelog.mdc`", because реальний механічний замок уже існує (hk pre-commit autofix + CI `check changelog`); повна матриця changed→rules дублює glob-attachment механізм frontmatter Cursor-правил і дрейфуватиме; збільшення кількості prompt-блоків порушує DRY-принцип репо.

### Consequences

- Good, because `AGENTS.md` тепер містить один короткий блок `## Інваріант після змін`; агент не може обійти зобов'язання, трактуючи `n-changelog` як «нерелевантне»; мінімальний blast radius на всі репо-споживачі `@nitra/cursor`.
- Bad, because prompt-директива не є механічним guardrail — агент технічно може її проігнорувати; правильний шлях до «механічно неможливо» — Stop-hook у Claude harness або CLI `final-check`, залишено відкритим для окремого тикету.
- Neutral, because фінальна відповідь агента тепер містить шаблонний рядок: `Validation: Tests / Build / Changelog: npx @nitra/cursor fix changelog ✅`.

## More Information

- Змінені файли-джерела: `npm/AGENTS.template.md`, `npm/rules/changelog/changelog.mdc` (version `3.3` → `3.4`)
- Дзеркала оновлено через `node npm/bin/n-cursor.js`: `AGENTS.md`, `.cursor/rules/n-changelog.mdc`
- Change-файл: `npm/.changes/260605-1135.md` (bump: minor, секція Changed)
- Перевірка: `node npm/bin/n-cursor.js fix changelog` → exit 0

## Update 2026-06-05

**Уточнення рішення**: Повний набір prompt-гардів (матриця changed→rules) відхилено — він дублює glob-attachment frontmatter Cursor-правил і дрейфуватиме. Механічний замок уже є через hk pre-commit + CI; prompt-директива є шаром зручності, а не єдиним захистом. Варіант `final-check` CLI залишено відкритим для окремого тикету. Change-файл batch: bump patch.

**Доказова критика в scripts.mdc (та сама сесія)**: Додано поведінкову директиву у `.cursor/rules/scripts.mdc` (версія `1.13` → `1.14`): агент зобов'язаний критикувати user-промпт **доказово** (посилання `file:line`, наявні механізми, git-історія), а не суб'єктивно. Файл локальний для цього репо (не під `npm/rules/`), синк `node npm/bin/n-cursor.js` його не перезаписує. Change-файл для `.cursor/rules/` не створювався (exempt від changelog-перевірки). Зафіксовано семантичну невідповідність: директива краще пасує до `n-feedback.mdc`, але розміщена в `scripts.mdc` за вказівкою користувача — ризик видалення як «чужорідної» залишається відкритим.
