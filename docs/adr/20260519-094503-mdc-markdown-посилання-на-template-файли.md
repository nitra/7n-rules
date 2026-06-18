---
type: ADR
title: "Канонічні `.mdc`-файли правил зобов'язані мати markdown-посилання на template-файли"
---

# Канонічні `.mdc`-файли правил зобов'язані мати markdown-посилання на template-файли

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

`npx @nitra/cursor check` фіксував помилку `❌ js-bun-db.mdc: відсутнє markdown-посилання на template-файл policy/package_json/template/package.json.deny.json`. Правила `js-bun-db` та `js-bun-redis` мали відповідні файли у `policy/package_json/template/`, але жодного markdown-посилання на них у відповідних `.mdc`-файлах. Утиліта `check-mdc-template-refs.mjs` реалізовувала цю перевірку і зупиняла `run-rule.mjs` з помилкою.

## Considered Options

* Додати markdown-посилання на `./policy/package_json/template/package.json.deny.json` безпосередньо в тіло `.mdc`-файлу для кожного правила.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати markdown-посилання на template-файл у тіло `.mdc`", because `check-mdc-template-refs.mjs` (викликаний з `run-rule.mjs`) вимагає, щоб кожен template-файл у `policy/*/template/` був явно згаданий у відповідному `<id>.mdc` як markdown-link; прецедент вже існував у `image-compress.mdc` та `js-run.mdc`.

### Consequences

* Good, because `npx @nitra/cursor check` переходить у стан `✨ Результат: 16/17 правил без зауважень` — перевірка на missing template refs більше не спрацьовує.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінені файли: `npm/rules/js-bun-db/js-bun-db.mdc` (version `1.7` → `1.8`), `npm/rules/js-bun-redis/js-bun-redis.mdc` (version `1.1` → `1.2`), `npm/package.json` (`1.13.46` → `1.13.47`), `npm/CHANGELOG.md`.
- Template-файли: `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json`, `npm/rules/js-bun-redis/policy/package_json/template/package.json.deny.json`.
- Утиліта перевірки: `npm/scripts/utils/check-mdc-template-refs.mjs`, викликана з `npm/scripts/utils/run-rule.mjs`.
- Прецедент наявного посилання: `image-compress.mdc` рядок 15 та `js-run.mdc` рядок 33.
