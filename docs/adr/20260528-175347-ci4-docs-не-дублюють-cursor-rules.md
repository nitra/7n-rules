---
type: ADR
title: "Документація `ci4` не дублює `.cursor/rules`, лише посилається"
---

# Документація `ci4` не дублює `.cursor/rules`, лише посилається

**Status:** Accepted
**Date:** 2026-05-28

## Context and Problem Statement

Правило `npm/rules/ci4/ci4.mdc` регулює архітектурну документацію продукту (arc42 + Diátaxis + ADR). Виникла потреба зафіксувати, що документи у `docs/` не повинні повторювати зміст правил із `.cursor/rules/*.mdc`, оскільки дублікати розходяться з оригіналом і порушують `npx @nitra/cursor fix`/`check`.

## Considered Options

- Дозволити `docs/` повторювати зміст `.cursor/rules` (дублювання)
- Заборонити дублювання; посилатися на правила за іменем у бектиках

## Decision Outcome

Chosen option: "Заборонити дублювання; посилатися на правила за іменем у бектиках", because дублікати неминуче розходяться з оригіналом і порушують `npx @nitra/cursor fix`/`check`; посилання виду `changelog` (у бектиках) зберігають актуальність без ризику розбіжності.

### Consequences

- Good, because `docs/` залишається синхронізованою з правилами без ризику розбіжностей — підтверджено в transcript.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінений файл: `npm/rules/ci4/ci4.mdc` version 2.0 → 2.1 — додано секцію «Зв'язок із `.cursor/rules`»
- Верифікація: `npx @nitra/cursor check changelog` — ✅ 1/1
- Версія пакета: `npm/package.json` 1.28.2 → 1.28.3
- `npm/CHANGELOG.md` — відповідний запис додано
- Додаткової інформації в transcript не зафіксовано.
