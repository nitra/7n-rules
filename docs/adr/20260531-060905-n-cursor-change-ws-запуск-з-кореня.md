# `n-cursor change --ws` запускати тільки з кореня репозиторію

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

При виконанні `npx @nitra/cursor change --ws npm` з каталогу `npm/` CLI розв'язував `--ws` як шлях відносно `cwd`, що призводило до створення change-файлу у `npm/npm/.changes/` замість очікуваного `npm/.changes/`. Подальші CI-кроки не знаходили файл і реліз не відбувався.

## Considered Options

* Запускати `npx @nitra/cursor change --ws <workspace>` лише з кореня репозиторію.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Запускати лише з кореня репозиторію", because `--ws` — шлях відносно поточного `cwd`, а не відносно git root; запуск з кореня гарантує правильне розміщення `<ws>/.changes/<timestamp>.md`.

### Consequences

* Good, because change-файл потрапляє в коректний workspace і CI підхоплює його для bump + CHANGELOG.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Помилковий каталог `npm/npm/` видалено вручну (`rm -rf`). Правильна команда: `cd <repo-root> && npx @nitra/cursor change --bump patch --section Fixed --message "..." --ws npm`. Коміт `49cbe54` (change-файл `1780157537703-7bc123.md`), CI-реліз `1.35.2` — коміт `3f3ac2a`.
