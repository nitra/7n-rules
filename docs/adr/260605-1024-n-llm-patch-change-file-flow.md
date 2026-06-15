# n-llm-patch: change-file flow замість ручного CHANGELOG.md / version bump

**Status:** Accepted
**Date:** 2026-06-05

## Context and Problem Statement

Скіл `n-llm-patch` генерував промпти для зовнішніх агентів, де як приклад фігурувала застаріла інструкція: «додати запис у `CHANGELOG.md`; bump `version` (minor)». Це суперечить прийнятому release flow, де `CHANGELOG.md` і `version` керуються виключно CI через `.changes`-файли та команду `npx @nitra/cursor fix changelog`. Ручний bump призводить до «брудного» npm/-дерева, що фейлить integration-repo-checks.

## Considered Options

- Замінити застарілий приклад на `npx @nitra/cursor change ...` + `npx @nitra/cursor fix changelog`
- Залишити ручний `CHANGELOG.md` / version bump у промптах `n-llm-patch`

## Decision Outcome

Chosen option: "Замінити застарілий приклад на `npx @nitra/cursor change ...` + `npx @nitra/cursor fix changelog`", because ручний bump несумісний із канонічним кроком `Release (bump + CHANGELOG + tag)` у `.github/workflows/npm-publish.yml` та явно заборонений правилом `n-changelog.mdc`.

### Consequences

- Good, because згенеровані промпти більше не містять стару інструкцію; `npx @nitra/cursor fix changelog` проходить після доданого change-файлу; всі 30 тестів проходять.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

- Змінені файли: `npm/skills/llm-patch/SKILL.md`, `.cursor/skills/n-llm-patch/SKILL.md` (ідентична копія)
- Доданий change-файл: `npm/.changes/260605-1023.md` (`bump: minor`, `section: Changed`)
- Канонічний крок у `.github/workflows/npm-publish.yml`: `run: npx changelogen --bump --push`
- Шаблон: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`, рядки 39–40
- Верифікація: `node npm/bin/n-cursor.js fix changelog` (exit 0), `npx vitest run npm/scripts/tests/auto-skills.test.mjs` (30/30 passed)
- Source синхронізовано через `cp npm/skills/llm-patch/SKILL.md .cursor/skills/n-llm-patch/SKILL.md`

## Update 2026-06-05

Додаткова мотивація, зафіксована в паралельній сесії: ручний bump призводить до «брудного» npm/-дерева та несумісний із канонічним кроком `Release (bump + CHANGELOG + tag)` у `.github/workflows/npm-publish.yml` (`run: npx changelogen --bump --push`). Локальна перевірка `node npm/bin/n-cursor.js fix npm-module` лише підтверджує наявність файлу; глибоку структурну валідацію делегує в `npx @nitra/cursor fix`. Change-файл: `npm/.changes/260605-1023.md` (bump: minor).
