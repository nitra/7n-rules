---
type: ADR
title: Додати `lib/` до поля `files` у `npm/package.json`
description: Пакет `@nitra/cursor` має публікувати директорію `lib/`, бо runtime-файли імпортують модулі з неї.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Пакет `@nitra/cursor` при публікації через `npm publish` не включав директорію `lib/`. Водночас `skills/fix/js/llm-worker.mjs`, `scripts/coverage-fix.mjs` та `scripts/coverage-classify/index.mjs` імпортували `../lib/models.mjs`.

Поле `files` у `npm/package.json` містило лише `"scripts"` та `"skills"`, але не містило `"lib"`, тому `npm/lib/models.mjs` був у source-репо, але не потрапляв до опублікованого пакета.

## Considered Options

- Додати `"lib"` до масиву `files` у `npm/package.json`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `\"lib\"` до масиву `files` у `npm/package.json`", because `lib/models.mjs` уже існував у source-репо, а пропуск `lib` у полі `files` був зафіксованою причиною відсутності файлу в опублікованому пакеті.

### Consequences

- Good, because `npm pack --dry-run` підтвердив появу `lib/models.mjs` у пакеті після правки.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because зміна вимагає change-файл для patch-релізу.

## More Information

- Змінений файл: `npm/package.json`.
- Зміна: у масив `files` додано рядок `"lib"` перед `"scripts"`.
- Перевірка: `cd npm && npm pack --dry-run 2>&1 | grep 'lib/'` показала `lib/models.mjs`.
- Change-файл: `.changes/260607-0645.md`.
- Команда change-файлу: `npx @nitra/cursor change --bump patch --section Fixed --message "add lib/ to package files — npm publish was missing top-level lib/"`.
- Після зміни виконано: `npx @nitra/cursor fix changelog`.
