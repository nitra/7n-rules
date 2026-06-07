---
session: 6193c1be-5102-4a19-b6e7-ab3935b721e1
captured: 2026-06-07T05:36:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/6193c1be-5102-4a19-b6e7-ab3935b721e1.jsonl
---

## ADR Бамп major-версії через change-файл, а не пряме редагування

## Context and Problem Statement
В монорепо `@nitra/cursor` (поточна версія `3.28.0`) потрібно підняти версію до `4.0.0`. Є два шляхи: безпосередньо відредагувати `npm/package.json`, або створити change-файл і делегувати bump у CI.

## Considered Options
* Пряме редагування `npm/package.json` → `4.0.0`
* Створення change-файлу через `n-cursor change --bump major` — CI виконує фактичний bump

## Decision Outcome
Chosen option: "Створення change-файлу через `n-cursor change --bump major`", because проєктне правило забороняє ручний bump version/CHANGELOG — він відбувається виключно через CI-flow.

### Consequences
* Good, because версія та CHANGELOG залишаються консистентними й бампаються в одній точці (CI), що виключає ручні помилки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `n-cursor change --bump major --section Changed --message "major version bump to 4.0.0" --ws npm`
- Створений файл: `npm/.changes/260607-0535.md`
- Цільовий пакет: `/Users/vitaliytv/www/nitra/cursor/npm/package.json` (`@nitra/cursor`, версія `3.28.0` → `4.0.0`)
