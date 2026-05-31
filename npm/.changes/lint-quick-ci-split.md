---
bump: minor
section: Added
---
lint: розділення на `n-cursor lint` (quick, по змінених файлах) і `n-cursor lint-ci` (повний, по всьому репо) — data-driven за полем `meta.json.lint` (quick/ci); виконавець кроку — `js/lint.mjs` правила; jscpd+knip винесено в нове правило `js-lint-ci` (фаза ci)
