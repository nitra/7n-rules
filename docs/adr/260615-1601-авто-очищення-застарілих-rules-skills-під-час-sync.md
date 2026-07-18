---
type: ADR
title: Авто-очищення застарілих rules і skills під час sync
description: Sync автоматично прибирає з `.n-cursor.json` rules і skills, яких більше немає у bundled-пакеті.
---

**Status:** Accepted

**Date:** 2026-06-15

## Context and Problem Statement

Під час `npx @nitra/cursor` записи у `rules` та `skills` в `.n-cursor.json`, яких більше немає в поточній версії bundled-пакету, спричиняли помилки на кшталт `EISDIR`, "Немає каталогу в пакеті" або "Немає файлу … Оновіть @nitra/cursor або приберіть…". Через це користувач мусив вручну редагувати `.n-cursor.json` після оновлень, у яких rules або skills були видалені чи перейменовані.

## Considered Options

- Додати pruning-логіку в `mergeConfigWithAutoDetected` у `scripts/auto-rules.mjs`, передаючи множини доступних bundled-назв.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати pruning-логіку в `mergeConfigWithAutoDetected`", because ця функція вже є єдиним місцем злиття конфігу й автодетекту, exported і покрита тестами, тому розширення її підписом `availableRules`/`availableSkills` не потребує нового шару в bin.

### Consequences

- Good, because sync більше не падає на відсутніх entries і може мовчки видаляти застарілі rules та skills.
- Good, because transcript фіксує 51 пройдений тест після змін і ESLint без помилок.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because CRC документації довелося перерахувати після зміни source-файлів.

## More Information

Змінені файли: `scripts/auto-rules.mjs`, `bin/n-cursor.js`, `scripts/tests/auto-rules.test.mjs`, `scripts/docs/auto-rules.md`, `bin/docs/n-cursor.md`.

`mergeConfigWithAutoDetected` отримав дані про `availableRules` і `availableSkills`; `bin/n-cursor.js` передає ці множини та логує pruned entries. CRC перераховувався через `rules/doc-files/js/docgen-crc.mjs` для `scripts/auto-rules.mjs`. Тести запускались командою `npx vitest run scripts/tests/auto-rules.test.mjs`.
