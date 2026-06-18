---
type: ADR
title: "auto-skills: розщеплення автодетекту скілів від правил"
---

# auto-skills: розщеплення автодетекту скілів від правил

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

Логіка автодетекту skills була вмішана разом із правилами в `auto-rules.md`, `auto-rules.mjs` та функцію `detectAutoRulesAndSkills`. Зі зростанням кількості skills (зʼявились `publish-telegram` і `taze`) і різними умовами їхнього увімкнення стало зрозуміло, що skills і rules мають відмінні джерела залежностей: rules залежать від файлів/структури проєкту, а skills — від уже виявлених rules.

## Рішення/Процедура/Факт

Створено `npm/bin/auto-skills.md` — людиночитабельний опис умов для skills (вилучено з `auto-rules.md`). Створено `npm/scripts/auto-skills.mjs` з функцією `detectAutoSkills({ detectedRules })` — на вхід отримує список уже виявлених rules, а не сирі файли проєкту. З `npm/scripts/auto-rules.mjs` видалено `AUTO_SKILL_ORDER` і skill-логіку; функцію перейменовано `detectAutoRulesAndSkills` → `detectAutoRules`. В `npm/bin/n-cursor.js` оновлено імпорти та виклики: спочатку `detectAutoRules`, потім `detectAutoSkills`. Додано `npm/tests/auto-skills.test.mjs`; `auto-rules.test.mjs` очищено від skill-тестів.

Умови для skills: `publish-telegram` — завжди; `taze` — якщо `n-bun` активний; `abie-kustomize`, `fix`, `lint` — збережено з попередньої логіки. Версія підвищена до `1.8.211`.

## Обґрунтування

Skills залежать від виявлених rules, а не безпосередньо від файлів проєкту, тому їхня логіка детекції принципово відрізняється від логіки rules. Розщеплення усуває дублювання умов, дає можливість додавати нові skills без ускладнення `auto-rules.mjs`, і відображає реальну семантику залежності.

## Розглянуті альтернативи

Варіант «залишити в `auto-rules.md`» — відхилено через дублювання умов. Варіант «додати `check-skill-*.mjs`-скрипти валідації» — відкладено як окрема задача. Обрано варіант «окремі файли для skills» з детекцією на основі вже знайдених rules.

## Зачіпає

`npm/bin/auto-rules.md`, `npm/bin/auto-skills.md` (новий), `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-skills.mjs` (новий), `npm/bin/n-cursor.js`, `npm/tests/auto-rules.test.mjs`, `npm/tests/auto-skills.test.mjs` (новий), `npm/package.json`, `npm/CHANGELOG.md`.
